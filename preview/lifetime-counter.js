/**
 * Lifetime-spots counter — drop into any page.
 *
 * Usage:
 *   <span data-lifetime-counter></span>             → "237 / 500"
 *   <span data-lifetime-counter="remaining"></span> → "237"
 *   <span data-lifetime-counter="sold"></span>      → "263"
 *   <span data-lifetime-counter="bar"></span>       → animated progress pill
 *
 * Single fetch on page load, populates all matching elements. Re-uses an
 * in-page sessionStorage cache (5 min) so navigating between pages doesn't
 * spam the backend.
 */
(function(){
  var API = (location.hostname==='localhost'||location.hostname==='127.0.0.1') ? 'http://localhost:3001' : '';
  var CACHE_KEY = 'tc-lifetime-spots-v1';
  var TTL = 5 * 60 * 1000;

  function paint(data){
    document.querySelectorAll('[data-lifetime-counter]').forEach(function(el){
      var mode = el.getAttribute('data-lifetime-counter') || 'pair';
      if (mode === 'remaining') el.textContent = String(data.remaining);
      else if (mode === 'sold') el.textContent = String(data.sold);
      else if (mode === 'total') el.textContent = String(data.total);
      else if (mode === 'bar') {
        var pct = Math.max(0, Math.min(100, (data.sold / data.total) * 100));
        el.innerHTML = '<span class="ltc-bar-track" style="display:inline-block;width:100%;height:6px;background:rgba(255,255,255,.08);border-radius:100px;overflow:hidden;vertical-align:middle;"><span class="ltc-bar-fill" style="display:block;height:100%;width:'+pct.toFixed(1)+'%;background:linear-gradient(90deg,#f59e0b,#fbbf24);border-radius:100px;"></span></span>';
      }
      else {
        // default 'pair' — "237 / 500"
        el.textContent = data.remaining + ' / ' + data.total;
      }
    });
  }

  function fromCache(){
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (Date.now() - c.ts > TTL) return null;
      return c.data;
    } catch(e){ return null; }
  }
  function toCache(data){
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ts: Date.now(), data})); } catch(e){}
  }

  function load(){
    var cached = fromCache();
    if (cached) paint(cached);
    fetch(API + '/api/lifetime-spots').then(function(r){return r.ok ? r.json() : null;}).then(function(d){
      if (d) { toCache(d); paint(d); }
    }).catch(function(){ /* swallow — leave any cached / fallback values */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
