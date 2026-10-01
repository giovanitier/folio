import test from 'node:test';
import assert from 'node:assert/strict';
import server, { configurationState } from '../server.mjs';
import { scopeInvestors, allocation, holdingRows, overlap, summarize, secLink, escapeHTML, holdingsCSV, amount, periods } from '../public/model.js';
import { dashboard, directory, makeManager } from './fixtures.mjs';

test('directory remains available without SEC configuration and contains no holdings', async () => {
  const r = await server.fetch(new Request('https://folio.test/api/investors'));
  const data = await r.json();
  assert.equal(r.status, 200); assert.equal(data.investors.length, 5); assert.equal(data.holdingsIncluded, false);
  assert.ok(!data.investors.some(i => i.positions));
});
test('configuration state distinguishes missing and invalid values', () => {
  assert.equal(configurationState(), 'missing');
  assert.equal(configurationState({ SEC_USER_AGENT: 'invalid' }), 'invalid');
  assert.equal(configurationState({ SEC_USER_AGENT: 'Test contact@example.invalid' }), 'configured');
});
test('workspace health checks expose no secret and do not claim live upstream verification', async () => {
  const secret = 'Test contact@example.invalid';
  const r = await server.fetch(new Request('https://folio.test/api/health'), { SEC_USER_AGENT: secret });
  const text = await r.text(); assert.ok(!text.includes(secret));
  assert.equal(JSON.parse(text).upstream, 'not_checked');
  assert.equal(r.headers.get('X-Folio-Version'), '0.3.0');
});
test('missing configuration retains an actionable error and makes no upstream request', async () => {
  const old = globalThis.fetch; let calls = 0; globalThis.fetch = () => { calls++; throw new Error('External request'); };
  try {
    const r = await server.fetch(new Request('https://folio.test/api/dashboard'));
    const data = await r.json(); assert.equal(r.status, 503); assert.equal(data.requiredBinding, 'SEC_USER_AGENT');
    assert.deepEqual(data.investors, []); assert.equal(calls, 0);
  } finally { globalThis.fetch = old; }
});
test('HEAD requests have no body and HTML receives security and cache headers', async () => {
  const env = { ASSETS: { fetch: () => new Response('<html>Test</html>', { headers: { 'Content-Type': 'text/html' } }) } };
  const r = await server.fetch(new Request('https://folio.test/', { method: 'HEAD' }), env);
  assert.equal(await r.text(), ''); assert.equal(r.headers.get('Cache-Control'), 'no-cache');
  assert.match(r.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
});
test('workspace rejects writes and keeps internal cache paths private', async () => {
  assert.equal((await server.fetch(new Request('https://folio.test/api/investors', { method: 'POST' }))).status, 405);
  assert.equal((await server.fetch(new Request('https://folio.test/__folio_cache__/v2/berkshire'))).status, 404);
});
test('scope never mixes quarters and follows are opt-in', () => {
  const data = { investors: [...dashboard.investors, makeManager({ ...directory[0], slug: 'older' }, 1, '2024-03-31', '2023-12-31')] };
  assert.equal(scopeInvestors(data).length, 3);
  assert.equal(scopeInvestors(data, { period: '2024-03-31' }).length, 1);
  assert.equal(scopeInvestors(data, { followingOnly: true, follows: [] }).length, 0);
  assert.equal(scopeInvestors(data, { followingOnly: true, follows: ['alpha'] }).length, 1);
  assert.deepEqual(periods(data), ['2024-06-30', '2024-03-31']);
});
test('allocation previous denominator includes exited positions exactly once', () => {
  const manager = dashboard.investors[0];
  const rows = holdingRows([manager]);
  const previousTotal = rows.reduce((sum, p) => sum + p.previousValue, 0);
  assert.equal(rows.filter(p => p.action === 'EXITED').length, 1);
  const bars = allocation([manager], 20);
  const largest = bars.find(p => p.cusip === '000000001');
  assert.equal(largest.previous, 5000 / previousTotal * 100);
  assert.ok(Math.abs(bars.reduce((s, p) => s + p.current, 0) - 100) < 1e-8);
  assert.ok(bars.reduce((s, p) => s + p.previous, 0) < 100);
});
test('allocation withholds mixed periods and never divides by zero', () => {
  assert.deepEqual(allocation([dashboard.investors[0], makeManager(directory[1], 1, '2024-03-31', '2023-12-31')]), []);
  const blank = { ...dashboard.investors[0], positions: [], changes: [], totalValue: 0 };
  assert.deepEqual(allocation([blank]), []); assert.equal(summarize([]).value, null); assert.equal(amount(null), '—');
});
test('holding search, action filters, and sorts preserve data', () => {
  assert.equal(holdingRows([dashboard.investors[0]], { search: '000000001' }).length, 1);
  assert.equal(holdingRows(dashboard.investors, { action: 'EXITED' }).length, 3);
  assert.ok(holdingRows(dashboard.investors, { action: 'changes' }).every(p => p.action !== 'UNCHANGED'));
  assert.equal(holdingRows(dashboard.investors, { search: 'NO SUCH FIXTURE' }).length, 0);
});
test('overlap excludes derivatives and counts a manager once per security', () => {
  const a = structuredClone(dashboard.investors[0]), b = structuredClone(dashboard.investors[1]);
  a.positions.push({ ...a.positions[0], putCall: 'PUT', weight: 90 });
  const rows = overlap([a, b]);
  assert.equal(rows[0].count, 2);
  const example = rows.find(p => p.cusip === '000000001');
  assert.equal(example.managers.alpha, a.positions[0].weight);
});
test('untrusted strings are escaped and source links are restricted to SEC HTTPS', () => {
  assert.equal(secLink('javascript:alert(1)'), ''); assert.equal(secLink('https://www.sec.gov.evil.invalid/a'), '');
  assert.ok(secLink('https://www.sec.gov/Archives/filing.txt'));
  assert.equal(escapeHTML('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
});
test('CSV protects formula-like names and preserves CUSIP strings', () => {
  const row = { ...holdingRows(dashboard.investors)[0], issuer: '=1+1', cusip: '000000001' };
  const csv = holdingsCSV([row]); assert.match(csv, /"'=1\+1"/); assert.match(csv, /"000000001"/);
});
