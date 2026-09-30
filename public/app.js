import { ACTIONS, ACTION_LABEL, escapeHTML as e, amount, count, percent, dateLabel, periodLabel, secLink, directoryLink, periods, scopeInvestors, holdingRows, summarize, allocation, overlap, holdingsCSV } from './model.js';

const $ = id => document.getElementById(id);
const views = {
  overview: ['Investor overview', 'Reported positions, quarter by quarter.'],
  investors: ['Investors', 'Follow the managers whose filings you want to understand.'],
  holdings: ['Holdings & changes', 'Search reported positions and inspect changes in share counts.'],
  overlap: ['Portfolio overlap', 'See which managers report the same securities in the same quarter.'],
  sources: ['Data & sources', 'Connection status, original filings, and how to read the numbers.']
};
const readStored = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const writeStored = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { $('announcer').textContent = 'Browser storage is unavailable. Changes will last for this session.'; } };
const storedFollows = readStored('folio.follows.v1', []);
const state = { directory: [], data: null, health: null, loading: true, error: null, manager: 'all', period: '', followingOnly: false, follows: Array.isArray(storedFollows) ? storedFollows.filter(x => typeof x === 'string') : [], search: '', action: 'all', sort: 'value', page: 1, view: 'overview' };
const selected = () => scopeInvestors(state.data, state);
const external = (href, label, extra = '') => href ? `<a href="${e(href)}" target="_blank" rel="noopener noreferrer" ${extra}>${label}</a>` : '—';
const actionMark = action => `<span class="state" data-action="${ACTIONS.includes(action) ? action : 'UNCHANGED'}"><i aria-hidden="true"></i>${e(ACTION_LABEL[action] || 'Unknown')}</span>`;
const instrument = row => [row.title, row.putCall, row.shareType === 'PRN' ? 'Principal units' : 'Shares'].filter(Boolean).join(' · ');
const empty = (title, text, actions = '') => `<section class="empty-state"><h2>${e(title)}</h2><p>${e(text)}</p>${actions ? `<div class="empty-actions">${actions}</div>` : ''}</section>`;

function syncTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('theme').setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
  $('theme').setAttribute('aria-pressed', String(theme === 'dark'));
}
syncTheme(readStored('folio.theme', 'light') === 'dark' ? 'dark' : 'light');

async function requestJSON(path) {
  const response = await fetch(path, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The API returned an unexpected response.');
  return { body: await response.json(), ok: response.ok, status: response.status };
}
async function load() {
  if (state.requesting) return;
  state.requesting = true;
  state.loading = !state.data;
  state.error = null;
  $('refresh').disabled = true;
  $('refresh').setAttribute('aria-label', 'Checking filing availability');
  render();
  try {
    const [directory, health] = await Promise.allSettled([requestJSON('/api/investors'), requestJSON('/api/health')]);
    if (directory.status === 'fulfilled' && Array.isArray(directory.value.body.investors)) state.directory = directory.value.body.investors;
    state.health = health.status === 'fulfilled' ? health.value.body : null;
    if (state.health?.secConfigured === false) {
      state.data = null;
      state.error = { code: 'SEC_NOT_CONFIGURED', configuration: state.health.configuration };
    } else {
      const result = await requestJSON('/api/dashboard');
      if (result.ok && Array.isArray(result.body.investors) && result.body.investors.length) {
        state.data = result.body;
        const available = periods(state.data);
        if (!available.includes(state.period)) state.period = available[0] || '';
        if (!state.directory.length) state.directory = result.body.investors;
      } else { state.data = null; state.error = result.body; }
    }
  } catch (error) {
    state.data = null;
    state.error = { code: 'CONNECTION_ERROR', error: error.name === 'TimeoutError' ? 'The filing request timed out.' : 'The filing API could not be reached.' };
  } finally {
    state.loading = false;
    state.requesting = false;
    $('refresh').disabled = false;
    $('refresh').setAttribute('aria-label', 'Refresh filing availability');
    render();
    $('announcer').textContent = state.data ? `Reports available for ${state.data.investors.length} managers.` : 'Filings are unavailable. Connection details are in Data and sources.';
  }
}
function renderChrome() {
  const ready = state.data?.investors.length || 0;
  const issue = state.error || state.data?.errors?.length;
  const status = state.requesting ? 'Checking connection' : state.error?.code === 'SEC_NOT_CONFIGURED' ? 'Contact required' : ready ? `${ready} reports available` : 'Data unavailable';
  $('connection').dataset.state = ready && !issue ? 'ready' : issue ? 'issue' : 'waiting';
  $('connection').innerHTML = `<i aria-hidden="true"></i>${e(status)}`;
  $('directory-count').textContent = state.directory.length || '—';
  const knownFollows = state.directory.filter(i => state.follows.includes(i.slug));
  $('follow-count').textContent = knownFollows.length;
  $('followed-nav').innerHTML = knownFollows.length ? knownFollows.map(i => `<button type="button" class="follow-nav" data-manager="${e(i.slug)}"><span class="mini-avatar">${e(i.initials)}</span><span>${e(i.entity)}</span></button>`).join('') : '<p class="sidebar-hint">Follow a manager to keep their reports close.</p>';
  document.querySelectorAll('[data-view]').forEach(a => { if (a.dataset.view === state.view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $('breadcrumb').textContent = state.view === 'sources' ? 'Data & sources' : state.view[0].toUpperCase() + state.view.slice(1);
  $('page-title').textContent = views[state.view][0];
  $('page-description').textContent = views[state.view][1];
  document.title = `${views[state.view][0]} — Folio`;
  $('scope-bar').hidden = ['investors', 'sources'].includes(state.view);
  $('manager').innerHTML = '<option value="all">All available managers</option>' + state.directory.map(i => `<option value="${e(i.slug)}">${e(i.entity)}</option>`).join('');
  $('manager').value = state.manager;
  const available = periods(state.data);
  $('period').innerHTML = available.length ? available.map(p => `<option value="${e(p)}">${e(periodLabel(p))}</option>`).join('') : '<option value="">Waiting for filings</option>';
  $('period').value = state.period;
  $('period').disabled = !available.length;
  $('following-only').checked = state.followingOnly;
  $('coverage').textContent = state.data ? `${selected().length} of ${state.directory.length || state.data.requestedInvestorCount} managers · ${dateLabel(state.period)}` : 'No reports loaded';
  const notice = $('notice');
  notice.hidden = !issue;
  if (state.error?.code === 'SEC_NOT_CONFIGURED') notice.innerHTML = '<div><strong>One connection setting is still needed.</strong><p>The app is deployed. SEC filings will load after the server contact is configured.</p></div><a href="#sources">Set up SEC access ↗</a>';
  else if (state.error) notice.innerHTML = `<div><strong>SEC filings are currently unavailable.</strong><p>${e(state.error.error || 'No tracked manager could be loaded. No substitute holdings are shown.')}</p></div><a href="#sources">Connection details ↗</a>`;
  else if (state.data?.errors?.length) notice.innerHTML = `<div><strong>Partial filing coverage.</strong><p>${state.data.investors.length} of ${state.data.requestedInvestorCount} managers loaded. Comparisons include only the selected, available reports.</p></div><a href="#sources">See unavailable sources ↗</a>`;
}
function investorTable(directory = state.directory) {
  if (!directory.length) return empty('The investor directory is unavailable', 'Refresh the connection to retrieve the tracked manager list.');
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="Investor directory, scroll for all columns"><table class="data-table"><caption class="sr-only">Tracked managers and the status of their latest loaded filing</caption><thead><tr><th scope="col">Manager</th><th scope="col">Report</th><th scope="col" class="numeric">Positions</th><th scope="col" class="numeric">Reported value</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${directory.map(i => {
    const loaded = state.data?.investors.find(p => p.slug === i.slug);
    const followed = state.follows.includes(i.slug);
    return `<tr><td><div class="manager-name"><span class="mini-avatar" aria-hidden="true">${e(i.initials)}</span><div><button type="button" class="text-button" data-manager="${e(i.slug)}">${e(i.entity)}</button><span class="secondary">${e(i.name)} · CIK ${e(i.cik)}</span></div></div></td><td>${loaded ? e(periodLabel(loaded.filing.reportDate)) : 'Awaiting data'}<span class="secondary">${loaded ? `Filed ${dateLabel(loaded.filing.filingDate)}` : 'SEC 13F-HR'}</span></td><td class="numeric">${loaded ? count(loaded.positionCount) : '—'}</td><td class="numeric">${loaded ? amount(loaded.totalValue) : '—'}</td><td><div class="row-link"><button type="button" class="button small" data-follow="${e(i.slug)}" aria-pressed="${followed}" aria-label="${followed ? 'Unfollow' : 'Follow'} ${e(i.name)}">${followed ? 'Following' : '+ Follow'}</button>${external(directoryLink(i.cik), '↗', `aria-label="Open SEC filings for ${e(i.entity)}"`)}</div></td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function allocationChart(investors) {
  const rows = allocation(investors);
  if (!rows.length) return '<div class="empty-chart"><span class="empty-rule"></span><p>Two comparable report periods are needed.</p></div>';
  const max = Math.max(5, Math.ceil(Math.max(...rows.flatMap(p => [p.current, p.previous])) / 5) * 5);
  const current = periodLabel(investors[0].filing.reportDate), previous = periodLabel(investors[0].filing.previousReportDate);
  return `<div class="chart-legend"><span><i class="legend-mark" aria-hidden="true"></i>${current}</span><span><i class="legend-mark previous" aria-hidden="true"></i>${previous}</span></div><figure aria-label="Top eight current allocations, compared with their previous quarter weights"><div class="allocation-plot">${rows.map(p => `<div class="allocation-row"><button type="button" class="text-button plot-name" data-security="${e(p.cusip)}" title="${e(p.issuer)} · ${e(instrument(p))}">${e(p.issuer)}<small>${e(p.cusip)}${p.putCall ? ` · ${e(p.putCall)}` : ''}</small></button><div class="paired-track" aria-hidden="true"><span class="plot-bar" style="width:${p.current / max * 100}%"></span><span class="plot-bar previous" style="width:${p.previous / max * 100}%"></span></div><div class="plot-values"><span class="sr-only">${current}: </span>${percent(p.current)}<small><span class="sr-only">${previous}: </span>${percent(p.previous)}</small></div></div>`).join('')}</div><div class="plot-axis" aria-hidden="true"><span></span><div>${[0,.25,.5,.75,1].map(n => `<span>${Number((n * max).toFixed(1))}%</span>`).join('')}</div><span></span></div><figcaption class="chart-footnote">Share of summed 13F reported value in the selected managers. Previous weights include positions since exited. Not investment returns.</figcaption></figure>`;
}
function distributionChart(investors) {
  const summary = summarize(investors), max = Math.max(1, ...Object.values(summary.states));
  return `<figure aria-label="Number of reported positions by change type"><div class="distribution">${ACTIONS.map(action => `<div class="distribution-row" data-action="${action}"><button type="button" class="text-button" data-action-filter="${action}">${ACTION_LABEL[action]}</button><div class="track" aria-hidden="true"><span style="width:${summary.states[action] / max * 100}%"></span></div><span class="value">${count(summary.states[action])}</span></div>`).join('')}</div><figcaption class="chart-footnote">Counts of manager–security positions. Based on unadjusted reported quantities, not inferred buy or sell orders. Select a type to inspect it.</figcaption></figure>`;
}
function scopedEmpty() {
  const hasReports = Boolean(state.data?.investors.length);
  return empty(hasReports ? 'No reports match this view' : 'Filings are not connected yet', hasReports ? 'Choose another manager or reporting period, or clear the following-only filter. Unavailable managers are not treated as empty portfolios.' : 'You can browse and follow the tracked managers now. Reported values and charts will appear when SEC access is ready.', hasReports ? '<button type="button" class="button" data-reset>Reset filters</button>' : '<a class="button primary" href="#sources">Check connection</a><a class="button ghost" href="#investors">Browse investors ↗</a>');
}
function overviewView() {
  const investors = selected();
  if (!investors.length) return `${scopedEmpty()}<section class="data-section"><div class="section-top"><div><h2>Tracked managers</h2><p>Fund filings, not personal investment accounts.</p></div><span class="tag">${state.directory.length} in the directory</span></div>${investorTable()}</section>`;
  const summary = summarize(investors);
  const changes = holdingRows(investors, { action: 'changes' }).slice(0, 8);
  return `<div class="metric-strip"><div class="metric"><span class="metric-label">Reports in view</span><strong>${count(summary.managers)}</strong><small>Same reporting quarter</small></div><div class="metric"><span class="metric-label">Reported value</span><strong>${amount(summary.value)}</strong><small>USD · Not total assets under management</small></div><div class="metric"><span class="metric-label">Reported positions</span><strong>${count(summary.positions)}</strong><small>Manager–security pairs</small></div><div class="metric"><span class="metric-label">Quantity changes</span><strong>${count(summary.changes)}</strong><small>Compared with the previous report</small></div></div><div class="chart-grid"><section class="chart-section"><div class="section-top"><div><h2>Reported allocation</h2><p>Largest current positions · previous vs current</p></div><span class="tag">Weight %</span></div>${allocationChart(investors)}</section><section class="chart-section"><div class="section-top"><div><h2>What changed</h2><p>Across the selected managers</p></div><span class="tag">Positions</span></div>${distributionChart(investors)}</section></div><section class="data-section"><div class="section-top"><div><h2>Reported changes</h2><p>Largest current reported values first</p></div><button type="button" class="text-button text-link" data-action-filter="changes">View all changes ↗</button></div>${changes.length ? rowsTable(changes) : empty('No quantity changes reported', 'The compared filings contain the same reported quantities.')}</section>`;
}
function rowsTable(rows) {
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="Reported holdings, scroll for all columns"><table class="data-table"><caption class="sr-only">Reported holdings with quantities, values, changes and source filings</caption><thead><tr><th scope="col">Security / manager</th><th scope="col">Change</th><th scope="col" class="numeric">Quantity</th><th scope="col" class="numeric">Reported USD</th><th scope="col" class="numeric">Weight</th><th scope="col">Source</th></tr></thead><tbody>${rows.map(p => `<tr><td><span class="issuer-name" title="${e(p.issuer)}">${e(p.issuer)}</span><span class="secondary">${e(p.investorEntity)} · ${e(p.cusip)}</span><span class="secondary">${e(instrument(p))}</span></td><td>${actionMark(p.action)}<span class="secondary">${p.changePct === null ? 'First reported' : `${p.changePct > 0 ? '+' : ''}${percent(p.changePct)} qty`}</span></td><td class="numeric">${count(p.shares)}<span class="secondary">was ${count(p.previousShares)}</span></td><td class="numeric">${amount(p.value)}<span class="secondary">was ${amount(p.previousValue)}</span></td><td class="numeric">${percent(p.weight)}</td><td>${external(secLink(p.sourceUrl), 'Filing ↗', `class="text-link" aria-label="Open source for ${e(p.issuer)} reported by ${e(p.investorEntity)}"`)}<span class="secondary">${dateLabel(p.filingDate)}</span></td></tr>`).join('')}</tbody></table></div>`;
}
function holdingsResults() {
  const investors = selected();
  if (!investors.length) return scopedEmpty();
  const rows = holdingRows(investors, state), pageCount = Math.max(1, Math.ceil(rows.length / 40));
  state.page = Math.min(state.page, pageCount);
  if (!rows.length) return empty('No matching holdings', 'Try an issuer name, CUSIP, or manager name, or change the quantity filter.');
  const start = (state.page - 1) * 40;
  return `${rowsTable(rows.slice(start, start + 40))}<div class="pagination"><span>${start + 1}–${Math.min(start + 40, rows.length)} of ${count(rows.length)} positions</span><div><button type="button" class="button small" data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>Previous</button><button type="button" class="button small" data-page="${state.page + 1}" ${state.page === pageCount ? 'disabled' : ''}>Next</button></div></div>`;
}
function holdingsView() {
  return `<div class="toolbar"><div class="toolbar-left"><label class="search"><span aria-hidden="true">⌕</span><input id="holding-search" type="search" value="${e(state.search)}" placeholder="Issuer, CUSIP, or manager" aria-label="Search holdings"></label><select id="action-filter" class="compact-select" aria-label="Filter by quantity change">${[['all','All positions'],['changes','Changes only'],...ACTIONS.map(a => [a,ACTION_LABEL[a]])].map(([value,label]) => `<option value="${value}" ${state.action === value ? 'selected' : ''}>${label}</option>`).join('')}</select><select id="sort" class="compact-select" aria-label="Sort holdings">${[['value','Reported value'],['weight','Manager weight'],['issuer','Issuer A–Z'],['change','Quantity change %']].map(([value,label]) => `<option value="${value}" ${state.sort === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><button type="button" class="button" data-export ${selected().length ? '' : 'disabled'}>Export CSV ↓</button></div><div id="holdings-results">${holdingsResults()}</div>`;
}
function overlapView() {
  const investors = selected();
  if (!investors.length) return scopedEmpty();
  if (investors.length < 2) return empty('Choose at least two managers', 'Overlap compares holdings in the same reporting period. Select all available managers to compare their reports.', '<button type="button" class="button" data-reset>Show all managers</button>');
  const rows = overlap(investors);
  if (!rows.length) return empty('No shared securities in this view', 'No share positions appear in two or more selected managers for this reporting quarter. Options and principal-amount positions are excluded.');
  return `<section class="data-section"><div class="section-top"><div><h2>${count(rows.length)} shared securities</h2><p>Cell values are each manager’s reported 13F weight, not a recommendation.</p></div><span class="tag">${e(periodLabel(state.period))}</span></div><div class="table-scroll" tabindex="0" role="region" aria-label="Portfolio overlap matrix, scroll for all managers"><table class="data-table overlap-table"><caption class="sr-only">Shared securities and their reported portfolio weights by manager</caption><thead><tr><th scope="col">Security</th>${investors.map(i => `<th scope="col">${e(i.entity)}<span class="secondary">${e(i.initials)}</span></th>`).join('')}</tr></thead><tbody>${rows.map(p => `<tr><td><button type="button" class="text-button issuer-name" data-security="${e(p.cusip)}" title="${e(p.issuer)}">${e(p.issuer)}</button><span class="secondary">${e(p.cusip)} · ${p.count} managers</span></td>${investors.map(i => { const value = p.managers[i.slug]; return `<td><span class="overlap-cell ${value === undefined ? 'absent' : ''}" ${value === undefined ? '' : `style="--strength:${Math.min(40, 8 + value * 1.4)}%"`} title="${e(i.entity)}: ${value === undefined ? 'not reported in this filing' : percent(value)}">${value === undefined ? '—' : percent(value)}</span></td>`; }).join('')}</tr>`).join('')}</tbody></table></div><p class="chart-footnote">Darker cells indicate a larger reported weight. “—” means not reported in that available filing, not proof that the manager holds no exposure. Share positions only; options and principal amounts are excluded.</p></section>`;
}
function sourcesView() {
  const configured = state.health?.secConfigured === true, available = state.data?.investors.length || 0;
  const errors = state.data?.errors || state.error?.errors || [];
  return `<section class="connection-ledger" aria-label="Data connection diagnostics"><div class="ledger-row"><span class="check-mark ${state.health?.ok ? 'ready' : ''}" aria-hidden="true">${state.health?.ok ? '✓' : '1'}</span><strong>Application API</strong><p>${state.health?.ok ? `Responding · Folio ${e(state.health.version)}. This does not verify SEC access.` : 'Not verified. Refresh to check the application API.'}</p></div><div class="ledger-row"><span class="check-mark ${configured ? 'ready' : ''}" aria-hidden="true">${configured ? '✓' : '2'}</span><strong>SEC contact setting</strong><p>${configured ? 'Configured on the server. The contact value is never sent to this page.' : state.health?.configuration === 'invalid' ? 'The server setting is present but invalid. Use an app name and a real contact email on a single line.' : 'Missing or not verified. Add SEC_USER_AGENT to the Worker runtime, not its build environment.'}</p></div><div class="ledger-row"><span class="check-mark ${available ? 'ready' : ''}" aria-hidden="true">${available ? '✓' : '3'}</span><strong>Filing retrieval</strong><p>${available ? `${available} of ${state.directory.length || state.data.requestedInvestorCount} tracked managers available. The six-hour cache may serve a previously checked report.` : configured ? 'Contact is configured, but no filings have loaded. SEC may be unavailable or may reject requests; inspect the source errors below.' : 'Not yet verified. Reports are requested only after contact configuration is valid.'}</p></div></section>${!configured ? `<section class="setup-block"><h2>Connect SEC access</h2><ol><li>Open <strong>Cloudflare → Workers & Pages → folio → Settings → Variables and Secrets</strong>.</li><li>Add a <strong>runtime secret</strong> named <code>SEC_USER_AGENT</code>. Its value must identify the app and a monitored contact, for example <code>Folio/0.3 you@your-domain.com</code>. Replace the example address with a real one.</li><li>Save and deploy the secret, then check the connection here. Do not add the contact to Git or client-side code.</li></ol><div class="code-line"><code>npx wrangler secret put SEC_USER_AGENT</code><button type="button" class="button small" data-copy>Copy command</button></div><p class="chart-footnote">CLI alternative, run from the Folio repository after authenticating with Cloudflare. A valid setting permits a request; it does not guarantee upstream access.</p><div class="empty-actions"><button type="button" class="button primary" data-refresh>Check connection</button>${external('https://developers.cloudflare.com/workers/configuration/secrets/', 'Cloudflare guide ↗', 'class="text-link"')}</div></section>` : '<div class="empty-actions"><button type="button" class="button" data-refresh>Check connection</button></div>'}<section class="data-section"><div class="section-top"><div><h2>Source ledger</h2><p>Report period and filing date are separate. Neither is an execution timestamp.</p></div></div><div class="table-scroll" tabindex="0" role="region" aria-label="Source ledger"><table class="data-table"><thead><tr><th scope="col">Manager</th><th scope="col">Report period</th><th scope="col">Filed</th><th scope="col">Availability / source</th></tr></thead><tbody>${state.directory.map(i => { const report = state.data?.investors.find(p => p.slug === i.slug), error = errors.find(p => p.slug === i.slug); return `<tr><td>${e(i.entity)}</td><td>${report ? dateLabel(report.filing.reportDate) : '—'}</td><td>${report ? dateLabel(report.filing.filingDate) : '—'}</td><td>${report ? external(secLink(report.filing.sourceUrl), 'Original SEC filing ↗', 'class="text-link"') + `<span class="secondary">Checked ${e(report.checkedAt ? new Date(report.checkedAt).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC' : 'not recorded')}</span>` : `<span class="error-note">${e(error?.error || 'Awaiting first successful retrieval')}</span>`}</td></tr>`; }).join('')}</tbody></table></div></section><section class="methodology"><div><h3>What the reports include</h3><p>Folio compares 13F-HR filings from investment managers, not a person’s private accounts. Dollar values are the amounts in the filing, not live quotes or total assets under management. Option lines are reported exposure, not option premiums.</p></div><div><h3>What a change means</h3><p>New, increased, reduced, and exited describe differences in reported quantities. Stock splits, transfers, confidential treatment, and other changes can affect these counts. They do not prove a trade occurred.</p></div><div><h3>Comparable periods only</h3><p>Views are scoped to one quarter. Comparisons with missing quarters or amended reports are withheld pending reconciliation. Earlier archived submission pages are not loaded in this version. Failed sources remain visible in the ledger.</p></div><div><h3>Reading the charts</h3><p>Allocation compares weights on one scale, including exited positions in the previous denominator. Overlap excludes options and principal amounts and counts a manager once per security. No chart estimates returns or recommends copying trades.</p></div><div><h3>Storage & privacy</h3><p>Following and theme preferences are saved in this browser only. Clearing site storage removes them. There is no brokerage connection or trading execution.</p></div><div><h3>Official documentation</h3><p>${external('https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data', 'SEC data access ↗')}<br>${external('https://www.sec.gov/divisions/investment/13ffaq', 'Form 13F guidance ↗')}<br>${external('https://github.com/giovanitier/folio/blob/main/docs/design-system.md', 'Syntari UI integration ↗')}</p></div></section>`;
}
function render() {
  renderChrome();
  $('view').setAttribute('aria-busy', String(state.loading));
  if (state.loading && !['investors', 'sources'].includes(state.view)) { $('view').innerHTML = '<div class="loading-state"><span class="loading-line"></span><p>Checking filing availability…</p></div>'; return; }
  $('view').innerHTML = state.view === 'overview' ? overviewView() : state.view === 'investors' ? `<div class="section-top"><p class="section-subtitle">${state.directory.length} tracked managers · Following is saved in this browser</p></div>${investorTable()}` : state.view === 'holdings' ? holdingsView() : state.view === 'overlap' ? overlapView() : sourcesView();
}
function navigate() {
  const hash = location.hash.slice(1);
  if (hash === 'content') return;
  state.view = Object.hasOwn(views, hash) ? hash : 'overview';
  closeMenu();
  render();
  if (matchMedia('(max-width:700px)').matches) $('content').focus();
}
function closeMenu() { $('shell').dataset.open = 'false'; $('open-menu').setAttribute('aria-expanded', 'false'); }
$('open-menu').addEventListener('click', () => { $('shell').dataset.open = 'true'; $('open-menu').setAttribute('aria-expanded', 'true'); $('close-menu').focus(); });
$('close-menu').addEventListener('click', () => { closeMenu(); $('open-menu').focus(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('shell').dataset.open === 'true') { closeMenu(); $('open-menu').focus(); } });
$('theme').addEventListener('click', () => { const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; syncTheme(theme); writeStored('folio.theme', theme); });
$('refresh').addEventListener('click', load);
$('manager').addEventListener('change', event => { state.manager = event.target.value; state.page = 1; render(); });
$('period').addEventListener('change', event => { state.period = event.target.value; state.page = 1; render(); });
$('following-only').addEventListener('change', event => { state.followingOnly = event.target.checked; state.page = 1; render(); });
window.addEventListener('hashchange', navigate);
document.addEventListener('input', event => {
  if (event.target.id === 'holding-search') { state.search = event.target.value; state.page = 1; $('holdings-results').innerHTML = holdingsResults(); }
});
document.addEventListener('change', event => {
  if (event.target.id === 'action-filter' || event.target.id === 'sort') { state[event.target.id === 'sort' ? 'sort' : 'action'] = event.target.value; state.page = 1; $('holdings-results').innerHTML = holdingsResults(); }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-follow')) {
    const slug = button.dataset.follow;
    if (!state.directory.some(i => i.slug === slug)) return;
    state.follows = state.follows.includes(slug) ? state.follows.filter(i => i !== slug) : [...state.follows, slug];
    writeStored('folio.follows.v1', state.follows);
    render();
    document.querySelector(`[data-follow="${CSS.escape(slug)}"]`)?.focus();
  } else if (button.hasAttribute('data-manager')) {
    state.manager = button.dataset.manager; state.followingOnly = false; state.search = ''; state.action = 'all'; state.page = 1; location.hash = 'holdings'; navigate();
  } else if (button.hasAttribute('data-security')) {
    state.search = button.dataset.security; state.action = 'all'; state.page = 1; location.hash = 'holdings'; navigate();
  } else if (button.hasAttribute('data-action-filter')) {
    state.action = button.dataset.actionFilter; state.search = ''; state.page = 1; location.hash = 'holdings'; navigate();
  } else if (button.hasAttribute('data-reset')) {
    state.manager = 'all'; state.followingOnly = false; state.search = ''; state.action = 'all'; state.period = periods(state.data)[0] || ''; state.page = 1; render();
  } else if (button.hasAttribute('data-page')) {
    state.page = Number(button.dataset.page); $('holdings-results').innerHTML = holdingsResults(); $('content').focus();
  } else if (button.hasAttribute('data-export')) {
    const rows = holdingRows(selected(), state); if (!rows.length) return;
    const url = URL.createObjectURL(new Blob([holdingsCSV(rows)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `folio-holdings-${state.period}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('announcer').textContent = `Exported ${rows.length} reported positions.`;
  } else if (button.hasAttribute('data-refresh')) {
    await load();
  } else if (button.hasAttribute('data-copy')) {
    try { await navigator.clipboard.writeText('npx wrangler secret put SEC_USER_AGENT'); button.textContent = 'Copied'; }
    catch { button.textContent = 'Select command to copy'; }
  }
});
navigate();
load();
