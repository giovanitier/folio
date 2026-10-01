// Synthetic reports used only by tests; never imported by the deployed Worker.
import { compareHoldings } from '../worker.mjs';
const row = (cusip, issuer, shares, value, extra = {}) => ({ cusip, issuer, shares, value, title: 'COM', putCall: '', shareType: 'SH', ...extra });
const previous = [row('000000001', 'EXAMPLE INDUSTRIES', 100, 5000), row('000000002', 'SAMPLE SOFTWARE', 100, 2400), row('000000003', 'TEST HEALTHCARE', 100, 1700), row('000000004', 'SYNTHETIC HOLDINGS', 100, 1300), row('000000005', 'EXAMPLE ENERGY', 100, 900), row('000000006', 'SAMPLE RESEARCH', 100, 800), row('000000007', 'TEST UTILITIES', 100, 600), row('000000008', 'SYNTHETIC RETAIL', 100, 400), row('000000009', 'EXIT FIXTURE', 50, 1900)];
const current = previous.filter(r => r.cusip !== '000000009').map((r, i) => ({ ...r, shares: i % 3 === 0 ? 120 : i % 3 === 1 ? 70 : 100, value: r.value * (i % 3 === 0 ? 1.4 : i % 3 === 1 ? .75 : 1.1) }));
current.push(row('000000010', 'NEW POSITION FIXTURE', 70, 1800));
export const directory = [
  { slug: 'alpha', name: 'Alpha Research', entity: 'Alpha Test Fund', cik: '0000000001', initials: 'AR' },
  { slug: 'beta', name: 'Beta Research', entity: 'Beta Test Fund', cik: '0000000002', initials: 'BR' },
  { slug: 'gamma', name: 'Gamma Research', entity: 'Gamma Test Fund', cik: '0000000003', initials: 'GR' }
];
export const makeManager = (identity, factor = 1, period = '2024-06-30', prior = '2024-03-31') => {
  const result = compareHoldings(current.map(r => ({ ...r, value: r.value * factor })), previous.map(r => ({ ...r, value: r.value * factor })));
  const positions = result.positions.filter(p => p.action !== 'EXITED'), changes = result.positions.filter(p => p.action !== 'UNCHANGED');
  return { ...identity, totalValue: result.totalValue, positions, changes, positionCount: positions.length, changeCount: changes.length, checkedAt: '2024-08-15T12:00:00Z', filing: { reportDate: period, previousReportDate: prior, filingDate: '2024-08-14', sourceUrl: 'https://www.sec.gov/Archives/test-fixture-index.html' } };
};
export const dashboard = { investors: [makeManager(directory[0]), makeManager(directory[1], .65), makeManager(directory[2], .35)], errors: [], requestedInvestorCount: 3, currency: 'USD', source: 'Synthetic test fixture', generatedAt: '2024-08-15T12:00:00Z' };
