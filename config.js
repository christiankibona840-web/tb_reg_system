// Global runtime configuration for the static pages.
// - API_BASE: leave '' to use same-origin (recommended for deployment).
//   Example: 'https://your-backend.onrender.com' (no trailing slash)
// - Supabase values are used by the Node backend (`server.js`) via env vars.
//   The anon key is safe to expose, but never expose the service-role key in frontend.
window.APP_CONFIG = window.APP_CONFIG || {};

window.APP_CONFIG.API_BASE =
  window.APP_CONFIG.API_BASE ??
  ''; // same-origin by default

window.APP_CONFIG.SUPABASE_URL =
  window.APP_CONFIG.SUPABASE_URL ??
  'https://mfkvwcryiclehbrkqthu.supabase.co';

// NOTE: anon key is public; still prefer setting it via hosting env when possible.
window.APP_CONFIG.SUPABASE_ANON_KEY =
  window.APP_CONFIG.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ma3Z3Y3J5aWNsZWhicmtxdGh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDMxMTksImV4cCI6MjA5NTQxOTExOX0.Sj3i_J5TvGCEm-imsmDreXwuOld3NZcuvsCukgcCe7o';

