// src/main.jsx
import { StrictMode, Component } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

// Global error boundary — catches any React render crash and shows
// a readable message instead of a blank page
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      const msg = this.state.error?.message || "Unknown error";
      return (
        <div style={{
          fontFamily:"monospace", background:"#040710", color:"#c0d0da",
          minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center",
        }}>
          <div style={{
            background:"#06090d", border:"1px solid #ff4560", borderRadius:8,
            padding:40, maxWidth:560, textAlign:"center",
          }}>
            <div style={{fontSize:28, marginBottom:16}}>❌</div>
            <div style={{fontSize:14, color:"#ff4560", marginBottom:12, fontWeight:700}}>
              App crashed — see details below
            </div>
            <div style={{
              fontSize:11, color:"#8090a0", marginBottom:20,
              background:"#030608", padding:"12px 16px", borderRadius:4,
              textAlign:"left", wordBreak:"break-word", lineHeight:1.6,
            }}>
              {msg}
            </div>
            <div style={{fontSize:10, color:"#506070", marginBottom:20, lineHeight:1.7}}>
              <strong style={{color:"#c0d0da"}}>Common fixes:</strong><br/>
              1. Is the server running?{" "}
              <span style={{color:"#00e87a"}}>node server/index.js</span><br/>
              2. Did you run <span style={{color:"#00e87a"}}>npm install</span>?<br/>
              3. Open DevTools (Cmd+Option+I) → Console for full stack trace
            </div>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              style={{
                fontFamily:"monospace", fontSize:11, padding:"8px 24px",
                background:"rgba(0,232,122,.1)", color:"#00e87a",
                border:"1px solid rgba(0,232,122,.3)", borderRadius:4, cursor:"pointer",
              }}
            >
              ↺ Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
