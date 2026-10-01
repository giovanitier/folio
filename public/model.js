/** Pure transforms for reported filings. No market-price or return estimates. */
export const ACTIONS = ['NEW', 'INCREASED', 'REDUCED', 'EXITED', 'UNCHANGED'];
export const ACTION_LABEL = { NEW: 'New', INCREASED: 'Increased', REDUCED: 'Reduced', EXITED: 'Exited', UNCHANGED: 'Unchanged' };
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const instrumentKey = row => `${row.cusip}|${String(row.title || '').trim().toUpperCase()}|${row.putCall || ''}|${row.shareType}`;
export const amount = (value, compact = true) => Number.isFinite(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 2 : 0 }).format(value) : '—';
export const count = value => Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value) : '—';
export const percent = value => Number.isFinite(value) ? `${value.toFixed(2)}%` : '—';
export const dateLabel = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) ? new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Not available';
export const periodLabel = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? `Q${Math.ceil(Number(value.slice(5, 7)) / 3)} ${value.slice(0, 4)}` : 'No report';
export function secLink(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && ['www.sec.gov', 'sec.gov', 'data.sec.gov'].includes(url.hostname) ? url.href : ''; }
  catch { return ''; }
}
export const directoryLink = cik => /^\d{10}$/.test(cik || '') ? `https://www.sec.gov/edgar/browse/?CIK=${cik}&owner=exclude` : '';
export function periods(data) {
  return [...new Set((data?.investors || []).map(i => i.filing.reportDate))].sort().reverse();
}
export function scopeInvestors(data, { manager = 'all', period = '', followingOnly = false, follows = [] } = {}) {
  const selectedPeriod = period || periods(data)[0];
  return (data?.investors || []).filter(i => i.filing.reportDate === selectedPeriod && (manager === 'all' || i.slug === manager) && (!followingOnly || follows.includes(i.slug)));
}
export function holdingRows(investors, { search = '', action = 'all', sort = 'value' } = {}) {
  const needle = search.trim().toLowerCase();
  return investors.flatMap(i => [...i.positions, ...i.changes.filter(p => p.action === 'EXITED')].map(p => ({
    ...p, investorSlug: i.slug, investorName: i.name, investorEntity: i.entity,
    filingDate: i.filing.filingDate, reportDate: i.filing.reportDate, sourceUrl: i.filing.sourceUrl
  }))).filter(p => (action === 'all' || action === 'changes' ? action !== 'changes' || p.action !== 'UNCHANGED' : p.action === action)
    && (!needle || [p.issuer, p.cusip, p.title, p.investorName, p.investorEntity, p.putCall].join(' ').toLowerCase().includes(needle)))
    .sort((a, b) => sort === 'issuer' ? a.issuer.localeCompare(b.issuer) : sort === 'weight' ? b.weight - a.weight : sort === 'change' ? Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0) : b.value - a.value || b.previousValue - a.previousValue);
}
export function summarize(investors) {
  const rows = holdingRows(investors);
  const states = Object.fromEntries(ACTIONS.map(action => [action, rows.filter(p => p.action === action).length]));
  return {
    managers: investors.length,
    value: investors.length ? investors.reduce((sum, i) => sum + i.totalValue, 0) : null,
    positions: investors.length ? investors.reduce((sum, i) => sum + i.positions.length, 0) : null,
    changes: investors.length ? rows.filter(p => p.action !== 'UNCHANGED').length : null,
    states
  };
}
export function allocation(investors, limit = 8) {
  const periodSet = new Set(investors.map(i => i.filing.reportDate));
  const previousSet = new Set(investors.map(i => i.filing.previousReportDate));
  if (!investors.length || periodSet.size !== 1 || previousSet.size !== 1 || previousSet.has(undefined)) return [];
  const map = new Map();
  for (const row of holdingRows(investors)) {
    const key = instrumentKey(row);
    const item = map.get(key) || { key, issuer: row.issuer, cusip: row.cusip, title: row.title, putCall: row.putCall, shareType: row.shareType, value: 0, previousValue: 0 };
    item.value += row.value;
    item.previousValue += row.previousValue;
    map.set(key, item);
  }
  const rows = [...map.values()];
  const currentTotal = rows.reduce((sum, p) => sum + p.value, 0);
  const previousTotal = rows.reduce((sum, p) => sum + p.previousValue, 0);
  return rows.filter(p => p.value > 0).sort((a, b) => b.value - a.value).slice(0, limit).map(p => ({ ...p, current: currentTotal ? p.value / currentTotal * 100 : 0, previous: previousTotal ? p.previousValue / previousTotal * 100 : 0 }));
}
export function overlap(investors) {
  const map = new Map();
  for (const manager of investors) {
    for (const row of manager.positions) {
      if (row.putCall || row.shareType !== 'SH' || row.shares <= 0) continue;
      const id = `${manager.filing.reportDate}|${row.cusip}`;
      const entry = map.get(id) || { cusip: row.cusip, issuer: row.issuer, reportDate: manager.filing.reportDate, managers: {}, count: 0 };
      entry.managers[manager.slug] = (entry.managers[manager.slug] || 0) + row.weight;
      entry.count = Object.keys(entry.managers).length;
      map.set(id, entry);
    }
  }
  return [...map.values()].filter(p => p.count >= 2).sort((a, b) => b.count - a.count || a.issuer.localeCompare(b.issuer));
}
export function holdingsCSV(rows) {
  // Prevent spreadsheet formula injection, including imported issuer names.
  const cell = value => { let text = String(value ?? ''); if (/^[\s]*[=+@-]/.test(text) && typeof value !== 'number') text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; };
  const head = ['Manager', 'Issuer', 'CUSIP', 'Class', 'Option', 'Quantity unit', 'Quantity', 'Previous quantity', 'Reported USD', 'Weight %', 'Change', 'Report period', 'Filed', 'Source'];
  return '\uFEFF' + [head, ...rows.map(p => [p.investorEntity, p.issuer, p.cusip, p.title, p.putCall, p.shareType, p.shares, p.previousShares, p.value, p.weight, p.action, p.reportDate, p.filingDate, secLink(p.sourceUrl)])].map(row => row.map(cell).join(',')).join('\r\n');
}
