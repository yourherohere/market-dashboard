// src/constants/gics.js — GICS sector/ETF registry
export const GICS = {
  "Technology": {
    code:"45", color:"#00b4d8", etf:"XLK", etfFull:"Technology Select Sector SPDR",
    subEtfs:[
      { sym:"SOXX", name:"iShares Semiconductor ETF",            focus:"Semiconductors",  industries:["Semiconductors","Semiconductor Equipment & Materials"] },
      { sym:"SMH",  name:"VanEck Semiconductor ETF",             focus:"Semiconductors",  industries:["Semiconductors"] },
      { sym:"XSD",  name:"SPDR S&P Semiconductor ETF",           focus:"Semis Equal-Wt", industries:["Semiconductors"] },
      { sym:"IGV",  name:"iShares Expanded Tech-Software ETF",   focus:"Software",        industries:["Software—Application","Software—Infrastructure"] },
      { sym:"CLOU", name:"Global X Cloud Computing ETF",         focus:"Cloud Computing", industries:["Software—Application","IT Services"] },
      { sym:"FDN",  name:"First Trust Dow Jones Internet ETF",   focus:"Internet",        industries:["Internet Content & Information"] },
      { sym:"CIBR", name:"First Trust Cybersecurity ETF",        focus:"Cybersecurity",   industries:["Software—Infrastructure","IT Services"] },
      { sym:"BOTZ", name:"Global X Robotics & AI ETF",           focus:"Robotics / AI",   industries:["Electronic Equipment & Components"] },
      { sym:"ESPO", name:"VanEck Video Gaming & eSports ETF",    focus:"Gaming / eSports",industries:["Electronic Gaming & Multimedia"] },
    ],
    industries:["Semiconductors","Semiconductor Equipment & Materials","Software—Application","Software—Infrastructure","IT Services","Electronic Equipment & Components"],
    syms:["AAPL","MSFT","NVDA","AVGO","ORCL","TXN","QCOM","AMD","MU","AMAT"],
  },
  "Healthcare": {
    code:"35", color:"#90be6d", etf:"XLV", etfFull:"Health Care Select Sector SPDR",
    subEtfs:[
      { sym:"IBB", name:"iShares Biotechnology ETF",             focus:"Biotech",          industries:["Biotechnology"] },
      { sym:"XBI", name:"SPDR S&P Biotech ETF",                  focus:"Biotech Equal-Wt",industries:["Biotechnology"] },
      { sym:"IHI", name:"iShares Medical Devices ETF",           focus:"Med Devices",      industries:["Medical Devices","Medical Instruments & Supplies"] },
      { sym:"IHF", name:"iShares U.S. Healthcare Providers",     focus:"Managed Care",     industries:["Healthcare Plans"] },
      { sym:"XHE", name:"SPDR S&P Health Care Equipment ETF",    focus:"HC Equipment",     industries:["Medical Instruments & Supplies"] },
      { sym:"XHS", name:"SPDR S&P Health Care Services ETF",     focus:"HC Services",      industries:["Healthcare Plans","Medical Care Facilities"] },
      { sym:"PJP", name:"Invesco Pharmaceuticals ETF",           focus:"Pharmaceuticals",  industries:["Drug Manufacturers—General"] },
    ],
    industries:["Biotechnology","Drug Manufacturers—General","Medical Devices","Medical Instruments & Supplies","Healthcare Plans","Medical Care Facilities"],
    syms:["UNH","JNJ","LLY","ABBV","MRK","TMO","ABT","DHR","ISRG","VRTX"],
  },
  "Financials": {
    code:"40", color:"#f9c74f", etf:"XLF", etfFull:"Financial Select Sector SPDR",
    subEtfs:[
      { sym:"KBE", name:"SPDR S&P Bank ETF",                     focus:"Banks",           industries:["Banks—Diversified","Banks—Regional"] },
      { sym:"KRE", name:"SPDR S&P Regional Banking ETF",         focus:"Regional Banks",  industries:["Banks—Regional"] },
      { sym:"KCE", name:"SPDR S&P Capital Markets ETF",          focus:"Capital Markets", industries:["Capital Markets","Asset Management"] },
      { sym:"KIE", name:"SPDR S&P Insurance ETF",                focus:"Insurance",       industries:["Insurance—Property & Casualty"] },
      { sym:"IAI", name:"iShares U.S. Broker-Dealers ETF",       focus:"Brokers",         industries:["Capital Markets"] },
    ],
    industries:["Banks—Diversified","Banks—Regional","Capital Markets","Asset Management","Insurance—Property & Casualty","Credit Services"],
    syms:["JPM","BAC","GS","MS","WFC","BLK","SCHW","AXP","V","MA"],
  },
  "Consumer Discret.": {
    code:"25", color:"#f94144", etf:"XLY", etfFull:"Consumer Discretionary Select Sector SPDR",
    subEtfs:[
      { sym:"XRT", name:"SPDR S&P Retail ETF",                   focus:"Retail",          industries:["Internet Retail","Specialty Retail","Department Stores"] },
      { sym:"XHB", name:"SPDR S&P Homebuilders ETF",             focus:"Homebuilders",    industries:["Homebuilding"] },
      { sym:"ITB", name:"iShares U.S. Home Construction ETF",    focus:"Home Const",      industries:["Homebuilding","Building Products & Equipment"] },
      { sym:"PEJ", name:"Invesco Dynamic Leisure & Entmt ETF",   focus:"Leisure / Entmt", industries:["Restaurants","Hotels & Motels","Entertainment"] },
    ],
    industries:["Internet Retail","Specialty Retail","Homebuilding","Restaurants","Hotels & Motels","Auto Manufacturers"],
    syms:["AMZN","TSLA","HD","MCD","NKE","TGT","SBUX","LOW","BKNG","GM"],
  },
  "Consumer Staples": {
    code:"30", color:"#43aa8b", etf:"XLP", etfFull:"Consumer Staples Select Sector SPDR",
    subEtfs:[],
    industries:["Discount Stores","Household & Personal Products","Food Distribution","Beverages—Non-Alcoholic"],
    syms:["WMT","COST","PG","KO","PEP","PM","MO","CL","MDLZ","KHC"],
  },
  "Energy": {
    code:"10", color:"#f8961e", etf:"XLE", etfFull:"Energy Select Sector SPDR",
    subEtfs:[
      { sym:"XOP",  name:"SPDR S&P Oil & Gas E&P ETF",           focus:"E&P",             industries:["Oil & Gas E&P"] },
      { sym:"OIH",  name:"VanEck Oil Services ETF",              focus:"Oil Services",    industries:["Oil & Gas Equipment & Services"] },
      { sym:"AMLP", name:"Alerian MLP ETF",                      focus:"Midstream / MLP", industries:["Oil & Gas Midstream"] },
      { sym:"FCG",  name:"First Trust Natural Gas ETF",          focus:"Natural Gas",     industries:["Oil & Gas Midstream","Oil & Gas E&P"] },
      { sym:"TAN",  name:"Invesco Solar ETF",                    focus:"Solar",           industries:["Solar"] },
      { sym:"URA",  name:"Global X Uranium ETF",                 focus:"Uranium",         industries:["Uranium"] },
    ],
    industries:["Oil & Gas E&P","Oil & Gas Midstream","Oil & Gas Equipment & Services","Oil & Gas Integrated","Solar","Uranium"],
    syms:["XOM","CVX","COP","SLB","PSX","EOG","MPC","VLO","OXY","HAL"],
  },
  "Materials": {
    code:"15", color:"#8ecae6", etf:"XLB", etfFull:"Materials Select Sector SPDR",
    subEtfs:[
      { sym:"GDX",  name:"VanEck Gold Miners ETF",               focus:"Gold Miners",     industries:["Gold"] },
      { sym:"GDXJ", name:"VanEck Junior Gold Miners ETF",        focus:"Jr Gold Miners",  industries:["Gold"] },
      { sym:"SIL",  name:"Global X Silver Miners ETF",           focus:"Silver Miners",   industries:["Silver"] },
      { sym:"XME",  name:"SPDR S&P Metals & Mining ETF",         focus:"Metals & Mining", industries:["Gold","Silver","Copper","Steel"] },
      { sym:"COPX", name:"Global X Copper Miners ETF",           focus:"Copper Miners",   industries:["Copper"] },
      { sym:"LIT",  name:"Global X Lithium & Battery Tech ETF",  focus:"Lithium",         industries:["Other Industrial Metals & Mining"] },
    ],
    industries:["Gold","Silver","Copper","Steel","Specialty Chemicals","Other Industrial Metals & Mining"],
    syms:["LIN","APD","FCX","NEM","NUE","VMC","MLM","ALB","STLD","CE"],
  },
  "Industrials": {
    code:"20", color:"#4d908e", etf:"XLI", etfFull:"Industrial Select Sector SPDR",
    subEtfs:[
      { sym:"ITA",  name:"iShares U.S. Aerospace & Defense ETF", focus:"Aerospace / Def", industries:["Aerospace & Defense"] },
      { sym:"JETS", name:"U.S. Global Jets ETF",                 focus:"Airlines",        industries:["Airlines"] },
      { sym:"IYT",  name:"iShares U.S. Transportation ETF",      focus:"Transportation",  industries:["Trucking","Railroads","Air Freight & Logistics"] },
      { sym:"PAVE", name:"Global X U.S. Infrastructure Dev ETF", focus:"Infrastructure",  industries:["Building Products & Equipment","Engineering & Construction"] },
    ],
    industries:["Aerospace & Defense","Airlines","Trucking","Railroads","Air Freight & Logistics","Specialty Industrial Machinery"],
    syms:["GE","HON","CAT","DE","UPS","RTX","BA","LMT","NOC","FDX"],
  },
  "Utilities": {
    code:"55", color:"#277da1", etf:"XLU", etfFull:"Utilities Select Sector SPDR",
    subEtfs:[],
    industries:["Utilities—Regulated Electric","Utilities—Diversified","Utilities—Renewable"],
    syms:["NEE","DUK","SO","D","AEP","EXC","XEL","PCG","SRE","PPL"],
  },
  "Real Estate": {
    code:"60", color:"#f3722c", etf:"XLRE", etfFull:"Real Estate Select Sector SPDR",
    subEtfs:[
      { sym:"VNQ",  name:"Vanguard Real Estate ETF",             focus:"REITs",           industries:["REIT—Diversified","REIT—Retail","REIT—Residential"] },
      { sym:"SCHH", name:"Schwab U.S. REIT ETF",                 focus:"REITs (Schwab)",  industries:["REIT—Diversified"] },
    ],
    industries:["REIT—Diversified","REIT—Retail","REIT—Residential","REIT—Industrial","REIT—Office"],
    syms:["PLD","AMT","EQIX","WELL","SPG","PSA","O","VICI","DLR","REG"],
  },
  "Comm Services": {
    code:"50", color:"#ff70a6", etf:"XLC", etfFull:"Communication Services Select Sector SPDR",
    subEtfs:[
      { sym:"IYZ",  name:"iShares U.S. Telecommunications ETF",  focus:"Telecom",         industries:["Telecom Services"] },
      { sym:"ESPO", name:"VanEck Video Gaming & eSports ETF",    focus:"Gaming / eSports",industries:["Electronic Gaming & Multimedia"] },
    ],
    industries:["Telecom Services","Internet Content & Information","Entertainment","Electronic Gaming & Multimedia"],
    syms:["GOOGL","META","NFLX","DIS","CMCSA","T","VZ","SNAP","PINS","RBLX"],
  },
};

export const SECTORS       = Object.fromEntries(Object.entries(GICS).map(([nm,c])=>[nm,{...c,tickers:[]}]));
export const SECTOR_ETF_SYMS = Object.values(GICS).map(s=>s.etf);
export const SUB_ETF_SYMS    = [...new Set(Object.values(GICS).flatMap(s=>s.subEtfs.map(e=>e.sym)))];
export const ALL_ETF_SYMS    = [...new Set([...SECTOR_ETF_SYMS,...SUB_ETF_SYMS])];
export const ALL_SECTORS     = Object.keys(GICS);

export const SECTOR_INDUSTRY_MAP = Object.fromEntries(
  Object.entries(GICS).map(([nm,c])=>[nm,c.industries])
);

export const INDEX_SYMS = ["SPY","QQQ","IWM","DIA"];

// Sector color helper
const SEC_COLORS = Object.fromEntries(Object.entries(GICS).map(([nm,c])=>[nm,c.color]));
export const secCol = (sector) => SEC_COLORS[sector] || "#7a9aaa";
