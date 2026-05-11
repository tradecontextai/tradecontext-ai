/**
 * shared-nav.js
 * Injects the canonical TradeContext.ai nav + preview-bar onto every sub-page
 * (trading-concepts, backtest, fundamentals, technicals, …) so the chrome
 * matches the homepage one-for-one. Single source of truth — change here and
 * every educational page updates.
 *
 * To use: drop <script src="shared-nav.js"></script> at the END of <head>
 * (or before any other script that touches the DOM at top of body) and set
 *   <body data-page="trading-concepts">
 * so the matching nav link gets the .active class.
 */
(function(){
  // ── Active page mapping ─────────────────────────────────────────────
  var active = (document.body && document.body.dataset && document.body.dataset.page) || '';

  // ── Inline nav CSS (matches homepage exactly) ───────────────────────
  var css = `
/* ═══ shared nav + preview-bar ═══ */
.preview-bar{position:sticky;top:0;z-index:200;padding:10px 24px;background:linear-gradient(90deg,rgba(14,165,233,.12),rgba(139,92,246,.12));border-bottom:1px solid rgba(14,165,233,.3);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);text-align:center;font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:700;letter-spacing:.08em;}
.preview-bar > span{background:linear-gradient(135deg,#0ea5e9 0%,#8b5cf6 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}

.nav{position:sticky;top:38px;z-index:100;background:rgba(3,6,13,.7);backdrop-filter:blur(22px) saturate(1.4);-webkit-backdrop-filter:blur(22px) saturate(1.4);border-bottom:1px solid rgba(255,255,255,.05);}
.nav-inner{max-width:1280px;margin:0 auto;padding:14px 32px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:24px;position:relative;}
.brand{display:inline-flex;align-items:center;gap:0;font-size:19px;font-weight:900;letter-spacing:-.03em;color:#e2eaf4;flex-shrink:0;transition:.18s cubic-bezier(.25,1,.5,1);text-decoration:none;line-height:1;}
.brand:hover{transform:translateY(-1px);}
.brand-mark{width:28px;height:28px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;background:linear-gradient(135deg,#0a1628,#0e1f3a);border:1px solid rgba(14,165,233,.32);box-shadow:0 4px 14px -4px rgba(14,165,233,.4),inset 0 1px 0 rgba(255,255,255,.06);position:relative;margin-right:8px;}
.brand-mark::before{content:'';position:absolute;inset:0;border-radius:7px;background:radial-gradient(circle at 70% 30%,rgba(14,165,233,.20),transparent 60%);pointer-events:none;}
.brand-mark svg{display:block;position:relative;z-index:1;}
.brand .word{display:inline-flex;align-items:baseline;letter-spacing:-.035em;}
.brand .ai{background:linear-gradient(135deg,#0ea5e9 0%,#8b5cf6 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:800;margin-left:0;}

.nav-links{display:flex;gap:2px;list-style:none;padding:0;margin:0;align-items:center;justify-content:center;}
.nav-links > li{position:relative;}
.nav-links > li > a{display:inline-flex;align-items:center;gap:5px;padding:8px 14px;font-size:13px;font-weight:500;color:#a5b8d0;border-radius:8px;transition:.18s cubic-bezier(.25,1,.5,1);cursor:pointer;text-decoration:none;}
.nav-links > li > a:hover,.nav-links > li:hover > a,.nav-links > li > a.active{color:#e2eaf4;background:rgba(255,255,255,.04);}
.nav-links > li > a.active{box-shadow:inset 0 -2px 0 rgba(14,165,233,.5);}
.nav-links > li > a .chev{font-size:9px;opacity:.55;transition:transform .2s cubic-bezier(.25,1,.5,1);}
.nav-links > li:hover > a .chev{transform:rotate(180deg);opacity:1;}

.dd-menu{position:absolute;top:calc(100% + 4px);left:50%;transform:translateX(-50%) translateY(-6px);min-width:264px;padding:8px;background:rgba(7,13,26,.92);backdrop-filter:blur(22px) saturate(1.4);-webkit-backdrop-filter:blur(22px) saturate(1.4);border:1px solid rgba(255,255,255,.08);border-radius:12px;box-shadow:0 22px 50px rgba(0,0,0,.55);opacity:0;pointer-events:none;transition:opacity .18s cubic-bezier(.25,1,.5,1),transform .22s cubic-bezier(.16,1,.3,1);transform-origin:top center;}
.nav-links > li:hover > .dd-menu{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto;}
.dd-menu::before{content:'';position:absolute;top:-12px;left:0;right:0;height:12px;}
.dd-item{display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:8px;font-family:'Inter',sans-serif;font-size:13px;font-weight:500;color:#a5b8d0;cursor:pointer;transition:background .15s,color .15s,transform .15s;text-decoration:none;}
.dd-item:hover{background:rgba(14,165,233,.10);color:#e2eaf4;transform:translateX(2px);}
.dd-item.primary{color:#0ea5e9;font-weight:700;}
.dd-item .ic{width:26px;height:26px;border-radius:7px;background:rgba(14,165,233,.10);border:1px solid rgba(14,165,233,.2);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;}
.dd-item.primary .ic{background:linear-gradient(135deg,rgba(14,165,233,.18),rgba(139,92,246,.12));border-color:rgba(14,165,233,.4);}
.dd-divider{height:1px;background:rgba(255,255,255,.06);margin:6px 8px;}

.nav-cta-row{display:flex;align-items:center;gap:10px;justify-content:flex-end;}
.live-pill{display:flex;align-items:center;gap:6px;padding:5px 10px;background:rgba(52,211,153,.10);border:1px solid rgba(52,211,153,.3);border-radius:100px;font-family:'JetBrains Mono',monospace;font-size:9.5px;color:#34d399;font-weight:700;letter-spacing:.1em;text-transform:uppercase;}
.live-pill .live-dot{width:6px;height:6px;border-radius:50%;background:#34d399;box-shadow:0 0 6px #34d399;animation:tcLivePulse 1.6s ease-in-out infinite;}
@keyframes tcLivePulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.55;transform:scale(.85);}}
.nav-signin{padding:8px 16px;font-size:12.5px;font-weight:600;color:#a5b8d0;border:1px solid #142035;border-radius:8px;transition:.18s;text-decoration:none;}
.nav-signin:hover{border-color:#1f2e4a;color:#e2eaf4;}
.nav-cta{padding:9px 18px;background:linear-gradient(135deg,#0ea5e9 0%,#8b5cf6 100%);color:#fff;font-weight:700;font-size:12.5px;border-radius:9px;box-shadow:0 6px 20px -8px rgba(14,165,233,.55),inset 0 1px 0 rgba(255,255,255,.18);transition:.22s cubic-bezier(.25,1,.5,1);text-decoration:none;}
.nav-cta:hover{transform:translateY(-2px);box-shadow:0 10px 26px -8px rgba(14,165,233,.7),inset 0 1px 0 rgba(255,255,255,.18);}

@media (max-width:880px){
  .nav-links{display:none;}
}
`;

  // ── Nav HTML (identical to homepage) ────────────────────────────────
  function navHTML(){
    // helper to inject an active flag — used on the standalone links
    function act(slug){ return active === slug ? ' class="active"' : ''; }
    return `
<div class="preview-bar">
  <span>✨ Premium redesign</span> · same layout as live · premium design + every new feature shown · <a href="https://www.tradecontext.ai" target="_blank" rel="noopener" style="margin-left:14px;color:#fff;text-decoration:underline;text-underline-offset:3px;">↗ compare with live</a>
</div>

<nav class="nav">
  <div class="nav-inner">
    <a href="homepage-redesigned.html" class="brand" aria-label="TradeContext.ai home">
      <span class="brand-mark">
        <svg width="18" height="18" viewBox="0 0 36 36" fill="none" aria-hidden="true">
          <polyline points="4,28 12,20 20,24 28,10" fill="none" stroke="url(#brandGrad)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="28" cy="10" r="3.8" fill="url(#brandGrad)"/>
          <circle cx="28" cy="10" r="1.7" fill="#fff"/>
          <defs>
            <linearGradient id="brandGrad" x1="0" y1="36" x2="36" y2="0">
              <stop offset="0%" stop-color="#0ea5e9"/>
              <stop offset="100%" stop-color="#8b5cf6"/>
            </linearGradient>
          </defs>
        </svg>
      </span>
      <span class="word">TradeContext<span class="ai">.ai</span></span>
    </a>
    <ul class="nav-links">
      <li>
        <a><span>Features</span> <span class="chev">▾</span></a>
        <div class="dd-menu">
          <a href="dashboard-redesigned.html" class="dd-item primary"><span class="ic">📊</span>Full Dashboard <em style="color:#f59e0b;font-style:normal;font-size:9px;letter-spacing:.06em;text-transform:uppercase;font-weight:800;margin-left:4px;">NEW</em></a>
          <a href="journal.html" class="dd-item primary"><span class="ic">📓</span>AI Trading Journal <em style="color:#f59e0b;font-style:normal;font-size:9px;letter-spacing:.06em;text-transform:uppercase;font-weight:800;margin-left:4px;">NEW</em></a>
          <a href="backtest.html" class="dd-item"><span class="ic">📈</span>Backtest Engine</a>
          <div class="dd-divider"></div>
          <a href="dashboard-redesigned.html" class="dd-item primary"><span class="ic">🚀</span>Open the desk →</a>
        </div>
      </li>
      <li><a href="homepage-redesigned.html#pricing"${act('pricing')}><span>Pricing</span></a></li>
      <li>
        <a><span>Resources</span> <span class="chev">▾</span></a>
        <div class="dd-menu">
          <a href="trading-concepts.html" class="dd-item primary"><span class="ic">📚</span>Trading Concepts Library</a>
          <a href="backtest.html" class="dd-item"><span class="ic">📈</span>Backtest Engine <em style="color:#f59e0b;font-style:normal;font-size:9px;letter-spacing:.06em;text-transform:uppercase;font-weight:800;margin-left:4px;">NEW</em></a>
          <a href="fundamentals.html" class="dd-item"><span class="ic">📰</span>Fundamental Analysis</a>
          <a href="technicals.html" class="dd-item"><span class="ic">📊</span>Technical Analysis</a>
          <div class="dd-divider"></div>
          <a href="blog.html" class="dd-item"><span class="ic">📝</span>Blog &amp; Insights</a>
          <a href="about.html" class="dd-item"><span class="ic">🏢</span>About Us</a>
          <a href="mailto:hello@tradecontext.ai" class="dd-item"><span class="ic">✉️</span>Contact Us</a>
          <div class="dd-divider"></div>
          <a href="risk.html" class="dd-item"><span class="ic">⚠️</span>Risk Disclaimer</a>
        </div>
      </li>
      <li><a href="homepage-redesigned.html#faq"${act('faq')}><span>FAQ</span></a></li>
    </ul>
    <div class="nav-cta-row">
      <div class="live-pill"><div class="live-dot"></div>Live</div>
      <a href="../signup.html?mode=signin" class="nav-signin">Sign in</a>
      <a href="dashboard-redesigned.html" class="nav-cta">Open the desk →</a>
    </div>
  </div>
</nav>
`;
  }

  // ── Inject as early as possible ─────────────────────────────────────
  function inject(){
    // Style tag at end of head
    var style = document.createElement('style');
    style.setAttribute('data-tc-shared-nav', '1');
    style.textContent = css;
    document.head.appendChild(style);
    // HTML at start of body
    document.body.insertAdjacentHTML('afterbegin', navHTML());
  }
  if (document.body) inject();
  else document.addEventListener('DOMContentLoaded', inject);
})();
