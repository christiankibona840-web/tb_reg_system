/**
 * Online smoke test for deployed service.
 *
 * Usage:
 *   node scripts/smoke-test.mjs https://your-domain.onrender.com
 */

const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!base || !/^https?:\/\//i.test(base)) {
  console.error('Usage: node scripts/smoke-test.mjs https://your-domain');
  process.exit(2);
}

async function getJson(path) {
  const url = `${base}${path}`;
  const r = await fetch(url, { headers: { 'accept': 'application/json' } });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: r.ok, status: r.status, url, json };
}

const checks = [
  '/api/health',
  '/api/status',
];

let failed = 0;
for (const p of checks) {
  try {
    const res = await getJson(p);
    if (!res.ok) {
      failed++;
      console.error(`[FAIL] ${res.status} ${res.url}`, res.json);
    } else {
      console.log(`[OK] ${res.status} ${res.url}`, res.json);
    }
  } catch (e) {
    failed++;
    console.error(`[ERR] ${base}${p}`, e?.message || e);
  }
}

if (failed) process.exit(1);
console.log('Smoke test passed.');

