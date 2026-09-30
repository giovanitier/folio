(() => {
  function getFollows() { try { const value=JSON.parse(localStorage.getItem('folio-following') || '["berkshire","pershing"]'); return Array.isArray(value)?value.filter(v=>typeof v==='string'):[]; } catch { return []; } }
  const state = {
    data: null,
    tab: 'feed',
    query: '',
    followingOnly: false,
    following: new Set(getFollows())
  };

  const $ = s => document.querySelector(s);
  const view = $('#view');
  const statusCard = $('#statusCard');
  const metrics = $('#metrics');
  const tabs = $('#tabs');
  const toolbar = $('#toolbar');
  const dialog = $('#investorDialog');
  const dialogContent = $('#dialogContent');

  function money(n) {
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n).toLocaleString();
  }

  function number(n) { return Math.round(n || 0).toLocaleString(); }
  function pct(n) { return n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`; }
  function escapeHtml(s='') { return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function saveFollows() { try { localStorage.setItem('folio-following', JSON.stringify([...state.following])); } catch { $('#dataNote').hidden=false; $('#dataNote').textContent='Browser storage is unavailable. Follows will last only for this session.'; } }

  function showStatus(title, detail, error=false) {
    statusCard.hidden = false;
    statusCard.innerHTML = `${error ? '' : '<div class="spinner"></div>'}<div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
  }

  async function load(force=false) {
    $('#refreshBtn').disabled = true;
    showStatus('Reading SEC filings', 'Official quarterly disclosures. Valid records are cached for six hours.');
    try {
      const response = await fetch('/api/dashboard', {signal:AbortSignal.timeout(60000)});
      const payload = await response.json();
      if (!response.ok || !payload.investors?.length) throw new Error(payload.errors?.map(e=>e.entity+': '+e.error).join(' · ') || payload.detail || payload.error || `Request failed (${response.status})`);
      state.data = payload;
      $('#dataNote').hidden=false;
      const checked=payload.investors.map(i=>i.checkedAt).filter(Boolean).sort()[0];
      $('#dataNote').innerHTML=`${payload.investors.length}/${payload.requestedInvestorCount} managers loaded · Reported USD values · Oldest source check: ${escapeHtml(checked ? new Date(checked).toLocaleString() : 'unavailable')}${payload.errors.length ? '<div class="filing-warning"><strong>Partial coverage</strong><br>'+payload.errors.map(e=>escapeHtml(e.entity+': '+e.error)).join('<br>')+'</div>' : ''}`;
      statusCard.hidden = true;
      tabs.hidden = false;
      toolbar.hidden = false;
      renderMetrics();
      render();
    } catch (error) {
      showStatus('Could not load live SEC data', error.message + (state.data ? ' Previously loaded records remain visible below; they were not refreshed.' : ' No sample holdings have been substituted.'), true);
    } finally {
      $('#refreshBtn').disabled = false;
    }
  }

  function renderMetrics() {
    const d = state.data;
    const changes = d.activity.length;
    const latestDate = d.investors.map(i => i.filing?.reportDate).sort().at(-1) || '—';
    metrics.hidden = false;
    metrics.innerHTML = `
      <div class="metric"><b>${d.investors.length}</b><span>Managers loaded</span></div>
      <div class="metric"><b>${changes}</b><span>Disclosed changes</span></div>
      <div class="metric"><b>${d.consensus.length}</b><span>Consensus names</span></div>
      <div class="metric"><b>${escapeHtml(latestDate)}</b><span>Latest report period</span></div>`;
  }

  function matchesQuery(...values) {
    const q = state.query.trim().toLowerCase();
    return !q || values.some(v => String(v || '').toLowerCase().includes(q));
  }

  function renderFeed() {
    const rows = state.data.activity.filter(a => {
      const followOk = !state.followingOnly || state.following.has(a.investorSlug);
      return followOk && matchesQuery(a.investorName, a.investorEntity, a.issuer, a.cusip, a.title);
    });
    view.innerHTML = `<div class="section-head"><div><h2>Latest disclosed changes</h2><p>Compared with the prior 13F quarter</p></div><p>${rows.length} signals</p></div>
      <div class="activity-list">${rows.length ? rows.map(a => `
        <article class="activity-row">
          <div class="avatar">${escapeHtml(a.investorInitials)}</div>
          <div class="activity-main">
            <div class="activity-who">${escapeHtml(a.investorName)} · ${escapeHtml(a.reportDate)}</div>
            <div class="activity-company">${escapeHtml(a.issuer)} ${a.putCall ? `<span class="action">${escapeHtml(a.putCall)}</span>` : ''}</div>
            <div class="activity-meta">${escapeHtml(a.title)} · CUSIP ${escapeHtml(a.cusip)} · ${number(a.shares)} ${a.shareType === 'PRN' ? 'principal units' : 'shares'} · <a href="${escapeHtml(a.sourceUrl)}" target="_blank" rel="noopener noreferrer">Filed ${escapeHtml(a.filingDate)} ↗</a></div>
          </div>
          <span class="action ${escapeHtml(a.action)}">${escapeHtml(a.action)}</span>
          <div class="activity-value"><b>${money(a.value)}</b><span>${pct(a.changePct)} shares</span></div>
        </article>`).join('') : '<div class="empty">No activity matches your filters.</div>'}</div>`;
  }

  function renderInvestors() {
    const rows = state.data.investors.filter(i => {
      const followOk = !state.followingOnly || state.following.has(i.slug);
      return followOk && matchesQuery(i.name, i.entity, ...(i.topPositions || []).map(h => h.issuer));
    });
    view.innerHTML = `<div class="section-head"><div><h2>Tracked investors</h2><p>Official manager filings, mapped to the people you follow</p></div><p>${rows.length} profiles</p></div>
      <div class="investor-grid">${rows.length ? rows.map(i => {
        const isFollowing = state.following.has(i.slug);
        return `<article class="investor-card">
          <div class="investor-top">
            <div class="avatar">${escapeHtml(i.initials)}</div>
            <div class="investor-title"><h3>${escapeHtml(i.name)}</h3><p>${escapeHtml(i.entity)}</p></div>
            <button class="follow ${isFollowing ? 'on' : ''}" data-follow="${escapeHtml(i.slug)}" type="button">${isFollowing ? 'Following' : 'Follow'}</button>
          </div>
          <div class="investor-stats">
            <div class="investor-stat"><b>${money(i.totalValue)}</b><span>Reported USD</span></div>
            <div class="investor-stat"><b>${i.positionCount}</b><span>Positions</span></div>
            <div class="investor-stat"><b>${i.changeCount}</b><span>Changes</span></div>
          </div>
          <div class="top-holdings">${i.topPositions.slice(0,4).map(h => `<span class="holding-chip">${escapeHtml(h.issuer)} · ${h.weight.toFixed(1)}%</span>`).join('')}</div>
          <button class="open-profile" data-open="${escapeHtml(i.slug)}" type="button">View portfolio →</button>
        </article>`;
      }).join('') : '<div class="empty">No investors match your filters.</div>'}</div>`;

    view.querySelectorAll('[data-follow]').forEach(btn => btn.addEventListener('click', () => {
      const slug = btn.dataset.follow;
      state.following.has(slug) ? state.following.delete(slug) : state.following.add(slug);
      saveFollows(); render();
    }));
    view.querySelectorAll('[data-open]').forEach(btn => btn.addEventListener('click', () => openInvestor(btn.dataset.open)));
  }

  function renderConsensus() {
    const scoped = state.data.investors.filter(i=>!state.followingOnly || state.following.has(i.slug));
    const rows = state.data.consensus.map(c=>{const names=c.investors.filter((_,i)=>!state.followingOnly || state.following.has(c.slugs[i]));return {...c,investors:names,count:names.length};}).filter(c=>c.count>=2 && matchesQuery(c.issuer,c.cusip,...c.investors));
    view.innerHTML = `<div class="section-head"><div><h2>Consensus radar</h2><p>Securities reported by at least two tracked managers</p></div><p>${rows.length} overlaps</p></div>
      <div class="consensus-list">${rows.length ? rows.map(c => `<article class="consensus-row"><div><h3>${escapeHtml(c.issuer)}</h3><p>${escapeHtml(c.title)} · CUSIP ${escapeHtml(c.cusip)} · ${escapeHtml(c.reportDate)}</p></div><div class="consensus-count">${c.count}/${scoped.filter(i=>i.filing.reportDate===c.reportDate).length}</div><div class="consensus-names">${c.investors.map(escapeHtml).join(' · ')}</div></article>`).join('') : '<div class="empty">No consensus positions match your search.</div>'}</div>`;
  }

  function render() {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === state.tab));
    if (!state.data) return;
    if (state.tab === 'feed') renderFeed();
    if (state.tab === 'investors') renderInvestors();
    if (state.tab === 'consensus') renderConsensus();
  }

  function openInvestor(slug) {
    const i = state.data.investors.find(x => x.slug === slug);
    if (!i) return;
    dialogContent.innerHTML = `<div class="dialog-inner">
      <h2>${escapeHtml(i.name)}</h2>
      <p class="dialog-sub">${escapeHtml(i.entity)} · ${i.positionCount} disclosed positions · ${money(i.totalValue)} reported value</p>
      <div class="filing-meta"><span>Report period ${escapeHtml(i.filing.reportDate)}</span><span>Filed ${escapeHtml(i.filing.filingDate)}</span><span>vs ${escapeHtml(i.filing.previousReportDate)}</span><a href="${escapeHtml(i.filing.sourceUrl)}" target="_blank" rel="noreferrer">Open SEC filing ↗</a></div>
      <div class="table-wrap"><table class="portfolio-table"><thead><tr><th>Position</th><th>13F weight</th><th>USD value</th><th>Change</th></tr></thead><tbody>
        ${i.positions.map(h => `<tr><td><strong>${escapeHtml(h.issuer)}</strong><br><span style="color:var(--muted)">${escapeHtml(h.title)} · ${escapeHtml(h.cusip)}</span></td><td>${h.weight.toFixed(2)}%</td><td>${money(h.value)}</td><td><span class="action ${escapeHtml(h.action)}">${escapeHtml(h.action)}</span></td></tr>`).join('')}
      </tbody></table></div>
    </div>`;
    dialog.showModal();
  }

  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => { state.tab = btn.dataset.tab; render(); }));
  $('#search').addEventListener('input', e => { state.query = e.target.value; render(); });
  $('#followingOnly').addEventListener('change', e => { state.followingOnly = e.target.checked; render(); });
  $('#refreshBtn').addEventListener('click', () => load(true));
  $('#closeDialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  load(false);
})();
