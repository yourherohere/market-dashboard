// server/routes/news.js — Finviz news + SEC EDGAR filings
import { Router } from "express";
import { cache }  from "../cache.js";
import { CACHE }  from "../config.js";
import { log } from "../logger.js";

export const newsRouter = Router();

newsRouter.get("/api/news/:symbol", async (req, res) => {
  const sym = (req.params.symbol || "").trim().toUpperCase();
  if (!sym || sym.length > 10) return res.status(400).json({ error: "invalid symbol" });
  const ck  = `news:${sym}`;
  const hit = cache.get(ck, CACHE.NEWS);
  if (hit) return res.json({ ...hit, cached: true });

  log.info(`/api/news/${sym}`);

  async function fetchFinvizNews(ticker) {
    try {
      const url  = `https://finviz.com/quote.ashx?t=${ticker}&ty=c&ta=1&p=d`;
      const resp = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://finviz.com/",
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (!resp.ok) throw new Error(`Finviz HTTP ${resp.status}`);
      const html = await resp.text();
      const news = [];

      // Primary regex
      const rowRe = /<tr[^>]*>[\s\S]*?<td[^>]*>([^<]{4,30})<\/td>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<span[^>]*>([^<]+)<\/span>[\s\S]*?<\/tr>/g;
      let m;
      while ((m = rowRe.exec(html)) !== null && news.length < 20) {
        const [, dateStr, url, headline, source] = m;
        if (headline?.length > 8 && url?.startsWith("http"))
          news.push({
            date: dateStr.trim(),
            headline: headline.trim().replace(/&#[0-9]+;/g, " ").replace(/&amp;/g, "&"),
            url: url.trim(), source: source.trim(), type: "news",
          });
      }

      // Fallback
      if (!news.length) {
        const simRe = /(\w{3}-\d{2}-\d{2}\s[\d:AMP]+)[^<]*<\/td>[\s\S]{0,200}href="(https?:\/\/[^"]+)"[^>]*>([^<]{8,140})<\/a>[\s\S]{0,100}<span[^>]*>([^<]+)<\/span>/g;
        while ((m = simRe.exec(html)) !== null && news.length < 20) {
          const [, dateStr, url, headline, source] = m;
          if (headline && url)
            news.push({ date: dateStr.trim(), headline: headline.trim().replace(/&amp;/g,"&"), url: url.trim(), source: source.trim(), type:"news" });
        }
      }

      const ef = (field) => {
        const re = new RegExp(`>${field}<\\/td>\\s*<td[^>]*>([^<]+)<\\/td>`, "i");
        const m  = html.match(re);
        return m ? m[1].trim() : null;
      };
      const fundamentals = {
        targetPrice: ef("Target Price"), analystRec: ef("Recom"),
        earnings:    ef("Earnings"),     shortFloat:  ef("Short Float"),
        shortRatio:  ef("Short Ratio"),  insiderOwn:  ef("Insider Own"),
        instOwn:     ef("Inst Own"),     peRatio:     ef("P/E"),
        eps:         ef("EPS (ttm)"),    perfWeek:    ef("Perf Week"),
        perfMonth:   ef("Perf Month"),   perfYTD:     ef("Perf YTD"),
        beta:        ef("Beta"),         avgVolume:   ef("Avg Volume"),
        relVolume:   ef("Rel Volume"),   epsNextY:    ef("EPS next Y"),
      };
      return { news, fundamentals };
    } catch(e) {
      log.warn(`Finviz news ${ticker}: ${e.message}`);
      return { news: [], fundamentals: {} };
    }
  }

  async function fetchSECFilings(ticker) {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7*86400_000).toISOString().split("T")[0];
      const today        = new Date().toISOString().split("T")[0];
      const url = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(ticker)}%22&dateRange=custom&startdt=${sevenDaysAgo}&enddt=${today}&forms=8-K,SC%2013G,SC%2013D,4`;
      const resp = await fetch(url, {
        headers: { "User-Agent": "MarketDashboard/2.0 research@marketdashboard.local", "Accept": "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) throw new Error(`SEC HTTP ${resp.status}`);
      const data = await resp.json();
      return (data.hits?.hits || []).slice(0, 8).map(hit => {
        const s = hit._source || {};
        return {
          date:     s.file_date || "",
          form:     s.form_type || "",
          headline: `SEC ${s.form_type}: ${s.entity_name || ticker}${s.period_of_report ? " ("+s.period_of_report+")" : ""}`,
          url:      `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(ticker)}&type=${encodeURIComponent(s.form_type||"8-K")}&dateb=&owner=include&count=5`,
          source:   "SEC EDGAR",
          type:     "sec",
          formType: s.form_type || "",
        };
      });
    } catch(e) {
      log.warn(`SEC filings ${ticker}: ${e.message}`);
      return [];
    }
  }

  try {
    const [finvizResult, secFilings] = await Promise.all([
      fetchFinvizNews(sym),
      fetchSECFilings(sym),
    ]);
    const allNews = [...secFilings, ...finvizResult.news].map((item, i) => ({ ...item, id: i }));
    const out = {
      symbol: sym,
      news:   allNews,
      fundamentals: finvizResult.fundamentals,
      sources: { finvizCount: finvizResult.news.length, secCount: secFilings.length },
      ts: new Date(),
    };
    cache.set(ck, out);
    log.ok(`news/${sym}: ${finvizResult.news.length} Finviz + ${secFilings.length} SEC`);
    res.json(out);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
