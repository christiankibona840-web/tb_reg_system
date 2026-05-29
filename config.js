/**
 * TBSS — API Configuration
 * Sets window.APP_CONFIG.API_BASE used by shudi.html and form5.html.
 * Deploy this file alongside your HTML files on Vercel.
 */
(function () {
  var hostname = window.location.hostname;

  var isLocal  = hostname === 'localhost'
              || hostname === '127.0.0.1'
              || hostname === ''
              || hostname.startsWith('192.168.');

  // ─── PRODUCTION URL ───────────────────────────────────────────
  // After deploying to Railway, paste your Railway URL here:
  var RAILWAY_URL = 'https://tabora-boys-backend.up.railway.app';
  // ─────────────────────────────────────────────────────────────

  var API_BASE = isLocal ? 'http://localhost:5000' : RAILWAY_URL;

  // This is what shudi.html and form5.html read:
  window.APP_CONFIG = { API_BASE: API_BASE };

  console.log('[TBSS] API_BASE:', API_BASE, isLocal ? '(local)' : '(production)');
})();
