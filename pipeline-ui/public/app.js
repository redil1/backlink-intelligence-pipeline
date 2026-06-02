const state = {
  runs: [],
  activeRunId: null,
  activeTab: 'opportunities',
  opportunities: [],
  latestJobId: null,
};

const el = {
  healthText: document.querySelector('#healthText'),
  healthDot: document.querySelector('#healthDot'),
  runForm: document.querySelector('#runForm'),
  runSelect: document.querySelector('#runSelect'),
  metrics: document.querySelector('#metrics'),
  activeRunTitle: document.querySelector('#activeRunTitle'),
  activeRunMeta: document.querySelector('#activeRunMeta'),
  opportunitiesTable: document.querySelector('#opportunitiesTable'),
  candidatesTable: document.querySelector('#candidatesTable'),
  browserTable: document.querySelector('#browserTable'),
  jobsList: document.querySelector('#jobsList'),
  jobLog: document.querySelector('#jobLog'),
  downloadCsv: document.querySelector('#downloadCsv'),
  downloadFilteredCsv: document.querySelector('#downloadFilteredCsv'),
  drawer: document.querySelector('#detailDrawer'),
  drawerTitle: document.querySelector('#drawerTitle'),
  drawerDomain: document.querySelector('#drawerDomain'),
  drawerBody: document.querySelector('#drawerBody'),
};

const filters = {
  q: document.querySelector('#searchFilter'),
  action: document.querySelector('#actionFilter'),
  tier: document.querySelector('#tierFilter'),
  strictDofollow: document.querySelector('#strictDofollowFilter'),
  type: document.querySelector('#typeFilter'),
  loginRequired: document.querySelector('#loginFilter'),
  browserStatus: document.querySelector('#browserFilter'),
  minScore: document.querySelector('#minScoreFilter'),
  minDofollow: document.querySelector('#minDofollowFilter'),
  minAcceptance: document.querySelector('#minAcceptanceFilter'),
  minSubmission: document.querySelector('#minSubmissionFilter'),
  maxRisk: document.querySelector('#maxRiskFilter'),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || response.statusText);
  }
  return response.json();
}

async function init() {
  bindEvents();
  await refreshHealth();
  await refreshRuns();
  await refreshJobs();
  window.setInterval(refreshJobs, 5000);
}

function bindEvents() {
  el.runForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const command = event.submitter?.dataset.command || 'run';
    const payload = formPayload(el.runForm);
    payload.command = command;
    try {
      const result = await api('/api/runs', { method: 'POST', body: JSON.stringify(payload) });
      state.activeRunId = result.runId;
      state.latestJobId = result.job.id;
      await refreshAll();
    } catch (error) {
      alert(error.message);
    }
  });

  el.runSelect.addEventListener('change', async () => {
    state.activeRunId = el.runSelect.value || null;
    await loadActiveRun();
  });

  document.querySelector('#refreshAll').addEventListener('click', refreshAll);
  document.querySelector('#refreshJobs').addEventListener('click', refreshJobs);
  document.querySelector('#resumeScrape').addEventListener('click', () => runAction('scrape'));
  document.querySelector('#resumeBrowser').addEventListener('click', () => runAction('browser-verify'));
  document.querySelector('#resumeExport').addEventListener('click', () => runAction('export'));
  document.querySelector('#closeDrawer').addEventListener('click', closeDrawer);

  for (const node of Object.values(filters)) {
    node.addEventListener('input', debounce(loadOpportunities, 250));
    node.addEventListener('change', loadOpportunities);
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      state.activeTab = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === tab));
      document.querySelector('#opportunitiesView').classList.toggle('hidden', state.activeTab !== 'opportunities');
      document.querySelector('#candidatesView').classList.toggle('hidden', state.activeTab !== 'candidates');
      document.querySelector('#browserView').classList.toggle('hidden', state.activeTab !== 'browser');
      document.querySelector('#logsView').classList.toggle('hidden', state.activeTab !== 'logs');
      document.querySelector('#opportunityFilters').classList.toggle('hidden', state.activeTab !== 'opportunities');
      if (state.activeTab === 'candidates') await loadCandidates();
      if (state.activeTab === 'browser') await loadBrowserVerifications();
      if (state.activeTab === 'logs') await loadLatestLog();
    });
  });
}

async function refreshAll() {
  await refreshHealth();
  await refreshRuns();
  await refreshJobs();
  await loadActiveRun();
}

async function refreshHealth() {
  try {
    const health = await api('/api/health');
    el.healthText.textContent = `UI ${health.ok ? 'online' : 'offline'}`;
    el.healthDot.classList.toggle('ok', Boolean(health.ok));
  } catch {
    el.healthText.textContent = 'UI offline';
    el.healthDot.classList.remove('ok');
  }
}

async function refreshRuns() {
  const { runs } = await api('/api/runs');
  state.runs = runs;
  if (!state.activeRunId && runs[0]) state.activeRunId = runs[0].runId;
  el.runSelect.innerHTML = runs.map((run) => `<option value="${escapeHtml(run.runId)}">${escapeHtml(run.runId)}</option>`).join('');
  if (state.activeRunId) el.runSelect.value = state.activeRunId;
  await loadActiveRun();
}

async function loadActiveRun() {
  if (!state.activeRunId) {
    renderEmptyRun();
    return;
  }
  const run = await api(`/api/runs/${encodeURIComponent(state.activeRunId)}`);
  renderRunSummary(run);
  await loadOpportunities();
  if (state.activeTab === 'candidates') await loadCandidates();
  if (state.activeTab === 'browser') await loadBrowserVerifications();
  if (state.activeTab === 'logs') await loadLatestLog();
}

function renderRunSummary(run) {
  const summary = run.summary || {};
  const counts = run.counts || {};
  el.activeRunTitle.textContent = run.runId;
  el.activeRunMeta.textContent = `${summary.niche || 'unknown'} · updated ${formatDate(summary.updatedAt)}`;
  el.metrics.innerHTML = [
    metric('Candidates', summary.discoveredCandidates ?? counts.candidates ?? 0),
    metric('Scraped', summary.scrapedCandidates ?? counts.scrapes ?? 0),
    metric('Opportunities', summary.opportunities ?? counts.opportunities ?? 0),
    metric('Browser OK', summary.browserVerified ?? 0),
    metric('Queries', counts.queries ?? 0),
  ].join('');
  el.downloadCsv.href = `/api/runs/${encodeURIComponent(run.runId)}/download/opportunities.csv`;
  el.downloadCsv.classList.remove('disabled');
  updateFilteredDownload();
}

function renderEmptyRun() {
  el.activeRunTitle.textContent = 'No Run Selected';
  el.activeRunMeta.textContent = 'Select a run or start a new one.';
  el.metrics.innerHTML = '';
  el.opportunitiesTable.innerHTML = emptyRow('Start or select a run to inspect opportunities.', 10);
  el.candidatesTable.innerHTML = emptyRow('Start or select a run to inspect discovered candidates.', 5);
  el.browserTable.innerHTML = emptyRow('Start or select a run to inspect browser verification evidence.', 5);
  el.downloadCsv.classList.add('disabled');
  el.downloadFilteredCsv.classList.add('disabled');
}

async function loadOpportunities() {
  if (!state.activeRunId) return;
  const params = filterParams();
  const data = await api(`/api/runs/${encodeURIComponent(state.activeRunId)}/opportunities?${params}`);
  state.opportunities = data.opportunities || [];
  renderOpportunities(state.opportunities);
  updateFilteredDownload();
}

function renderOpportunities(rows) {
  if (rows.length === 0) {
    el.opportunitiesTable.innerHTML = emptyRow('No opportunities match this run and filter set.', 10);
    return;
  }
  el.opportunitiesTable.innerHTML = rows.map((row, index) => {
    const loginRequired = Boolean(row.linkEvidence?.loginRequired || row.browserVerification?.loginRequired);
    const browser = row.browserVerification;
    const strict = row.strictEvidence || {};
    return `
      <tr data-index="${index}">
        <td><span class="score">${formatScore(row.opportunityScore)}</span></td>
        <td>${tierPill(strict.tier)}</td>
        <td class="domain-cell">
          <strong>${escapeHtml(row.domain)}</strong>
          <a href="${escapeAttr(row.url)}" target="_blank" rel="noreferrer">${escapeHtml(row.url)}</a>
        </td>
        <td>${pill(labelType(row.opportunityType))}</td>
        <td>${scorePill(strict.dofollowConfidence, strict.strictDofollow ? 'ok' : '')}</td>
        <td>${scorePill(strict.acceptanceProbability)}</td>
        <td>${scorePill(strict.submissionPathConfidence)}</td>
        <td>${actionPill(row.recommendedAction)}</td>
        <td>${loginRequired ? pill('required', 'warn') : pill('open', 'ok')}</td>
        <td>${browser ? (browser.success ? pill('verified', 'ok') : pill('failed', 'danger')) : pill('pending')}</td>
      </tr>
    `;
  }).join('');
  el.opportunitiesTable.querySelectorAll('tr').forEach((row) => {
    row.addEventListener('click', () => openOpportunity(state.opportunities[Number(row.dataset.index)]));
  });
}

async function loadCandidates() {
  if (!state.activeRunId) return;
  const data = await api(`/api/runs/${encodeURIComponent(state.activeRunId)}/candidates?limit=300`);
  const rows = data.candidates || [];
  if (rows.length === 0) {
    el.candidatesTable.innerHTML = emptyRow('No candidates have been discovered for this run yet.', 5);
    return;
  }
  el.candidatesTable.innerHTML = rows.map((row) => `
    <tr>
      <td><span class="score">${formatScore(row.candidateScore)}</span></td>
      <td class="domain-cell"><strong>${escapeHtml(row.domain)}</strong><a href="${escapeAttr(row.normalizedUrl)}" target="_blank" rel="noreferrer">${escapeHtml(row.normalizedUrl)}</a></td>
      <td>${pill(labelType(row.opportunityType))}</td>
      <td>${escapeHtml(row.discoveryQuery || '')}</td>
      <td>${chips(row.signals || [])}</td>
    </tr>
  `).join('');
}

async function loadBrowserVerifications() {
  if (!state.activeRunId) return;
  const data = await api(`/api/runs/${encodeURIComponent(state.activeRunId)}/browser-verifications?limit=300`);
  const rows = data.verifications || [];
  if (rows.length === 0) {
    el.browserTable.innerHTML = emptyRow('No browser verification records have been written for this run yet.', 5);
    return;
  }
  el.browserTable.innerHTML = rows.map((row) => `
    <tr>
      <td>${row.success ? pill('success', 'ok') : pill('failed', 'danger')}</td>
      <td class="domain-cell"><strong>${escapeHtml(row.domain)}</strong><a href="${escapeAttr(row.finalUrl || row.url)}" target="_blank" rel="noreferrer">${escapeHtml(row.finalUrl || row.url)}</a></td>
      <td>${row.loginRequired ? pill(`required ${row.loginConfidence ?? ''}`, 'warn') : pill('open', 'ok')}</td>
      <td>${escapeHtml(row.forms ?? '')}</td>
      <td>${escapeHtml(row.title || row.error || '')}</td>
    </tr>
  `).join('');
}

async function refreshJobs() {
  const { jobs } = await api('/api/jobs');
  el.jobsList.innerHTML = jobs.slice(0, 8).map((job) => `
    <div class="job-item">
      <div><strong>${escapeHtml(job.command)}</strong> ${statusPill(job.status)}</div>
      <div class="muted">${escapeHtml(job.runId)}</div>
      <button data-job="${escapeAttr(job.id)}">Log</button>
    </div>
  `).join('');
  el.jobsList.querySelectorAll('button[data-job]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.latestJobId = button.dataset.job;
      await loadLatestLog();
      activateTab('logs');
    });
  });
}

async function loadLatestLog() {
  const jobId = state.latestJobId || document.querySelector('.job-item button')?.dataset.job;
  if (!jobId) {
    el.jobLog.textContent = '';
    return;
  }
  const data = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
  el.jobLog.textContent = data.log || (data.job?.logTail || []).join('\n');
}

async function runAction(action) {
  if (!state.activeRunId) return;
  const body = {
    action,
    scrapeLimit: Number(document.querySelector('[name="scrapeLimit"]').value || 0),
    scrapeConcurrency: Number(document.querySelector('[name="scrapeConcurrency"]').value || 4),
    browserLimit: Number(document.querySelector('[name="browserLimit"]').value || 100),
    evidencePages: Number(document.querySelector('[name="evidencePages"]').value || 3),
  };
  try {
    const result = await api(`/api/runs/${encodeURIComponent(state.activeRunId)}/actions`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    state.latestJobId = result.job.id;
    await refreshJobs();
  } catch (error) {
    alert(error.message);
  }
}

function openOpportunity(row) {
  el.drawerTitle.textContent = row.title || row.domain;
  const strict = row.strictEvidence || {};
  el.drawerDomain.textContent = `${row.domain} · ${formatScore(row.opportunityScore)} · ${strict.tier || 'untiered'} · ${row.recommendedAction}`;
  const browser = row.browserVerification;
  el.drawerBody.innerHTML = `
    ${detailSection('Strict Evidence', [
      ['Tier', strict.tier],
      ['Dofollow confidence', strict.dofollowConfidence],
      ['Acceptance probability', strict.acceptanceProbability],
      ['Submission path confidence', strict.submissionPathConfidence],
      ['Strict dofollow', strict.strictDofollow],
      ['Risk score', strict.riskScore],
      ['Indexability', strict.indexabilityStatus],
      ['Payment required', strict.paymentRequired],
      ['Evidence pages', strict.evidencePageCount],
      ['Last accepted date', strict.lastAcceptedDate],
    ])}
    ${detailList('Proof URLs', strict.proofUrls)}
    ${detailList('Sample Accepted URLs', strict.sampleAcceptedUrls)}
    ${detailList('Sample External Link Rel', strict.sampleExternalLinkRel)}
    ${detailList('Disqualification Reasons', strict.disqualificationReasons)}
    ${detailList('Payment Evidence', strict.paymentEvidence)}
    ${detailSection('Link Evidence', [
      ['Submission form', row.linkEvidence?.hasSubmissionForm],
      ['Login required', row.linkEvidence?.loginRequired],
      ['Login confidence', row.linkEvidence?.loginConfidence],
      ['Followed external links', row.linkEvidence?.hasFollowedExternalLinks],
      ['Noindex', row.linkEvidence?.hasNoindex],
    ])}
    ${detailList('Submission URLs', row.linkEvidence?.submissionUrls)}
    ${detailList('Signup URLs', row.linkEvidence?.signupUrls)}
    ${detailList('Login URLs', row.linkEvidence?.loginUrls)}
    ${detailList('Login Evidence', row.linkEvidence?.loginEvidence)}
    ${detailList('Signals', row.signals)}
    ${detailList('Risks', row.risks)}
    ${detailList('Evidence Snippets', row.evidenceSnippets)}
    ${browser ? detailBrowser(browser) : ''}
  `;
  el.drawer.classList.add('open');
  el.drawer.setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  el.drawer.classList.remove('open');
  el.drawer.setAttribute('aria-hidden', 'true');
}

function detailBrowser(browser) {
  return `
    <section class="detail-section">
      <h3>Browser Verification</h3>
      <p>${browser.success ? 'success' : 'failed'} · login ${browser.loginRequired ? 'required' : 'open'} · forms ${browser.forms ?? 0}</p>
      <p>${escapeHtml(browser.title || browser.error || '')}</p>
      ${detailList('Rendered login evidence', browser.loginEvidence)}
      ${detailList('Rendered login URLs', browser.loginUrls)}
      <p>${escapeHtml(browser.visibleTextSample || '')}</p>
    </section>
  `;
}

function detailSection(title, pairs) {
  return `
    <section class="detail-section">
      <h3>${escapeHtml(title)}</h3>
      ${pairs.map(([key, value]) => `<p><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value ?? '')}</p>`).join('')}
    </section>
  `;
}

function detailList(title, values = []) {
  if (!values || values.length === 0) return '';
  return `
    <section class="detail-section">
      <h3>${escapeHtml(title)}</h3>
      ${values.slice(0, 30).map((value) => `<p>${linkify(value)}</p>`).join('')}
    </section>
  `;
}

function formPayload(form) {
  const data = new FormData(form);
  const payload = {};
  for (const [key, value] of data.entries()) {
    payload[key] = value;
  }
  for (const key of ['targetCandidates', 'maxQueries', 'searchPages', 'searchConcurrency', 'scrapeLimit', 'scrapeConcurrency', 'browserLimit', 'evidencePages']) {
    payload[key] = Number(payload[key] || 0);
  }
  payload.browserVerify = Boolean(data.get('browserVerify'));
  return payload;
}

function filterParams() {
  const params = new URLSearchParams();
  for (const [key, node] of Object.entries(filters)) {
    if (node.value !== '') params.set(key, node.value);
  }
  params.set('limit', '300');
  return params.toString();
}

function updateFilteredDownload() {
  if (!state.activeRunId) return;
  el.downloadFilteredCsv.href = `/api/runs/${encodeURIComponent(state.activeRunId)}/export/opportunities-filtered.csv?${filterParams()}`;
  el.downloadFilteredCsv.classList.remove('disabled');
}

function activateTab(name) {
  document.querySelector(`.tab[data-tab="${name}"]`)?.click();
}

function metric(label, value) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function emptyRow(message, columns) {
  return `
    <tr class="empty-row">
      <td colspan="${columns}">
        <div class="empty-state">${escapeHtml(message)}</div>
      </td>
    </tr>
  `;
}

function chips(values = []) {
  return values.slice(0, 6).map((value) => pill(value)).join('');
}

function pill(text, tone = '') {
  return `<span class="pill ${tone}">${escapeHtml(text)}</span>`;
}

function actionPill(action) {
  const tone = action === 'reject' ? 'danger' : action === 'likely_eligible' ? 'ok' : action === 'browser_verify' ? 'warn' : '';
  return pill(action, tone);
}

function tierPill(tier) {
  const tone = tier === 'tier_a' ? 'ok' : tier === 'tier_b' ? 'warn' : tier === 'reject' ? 'danger' : '';
  return pill(labelType(tier || 'unknown'), tone);
}

function scorePill(value, tone = '') {
  return pill(formatScore(value), tone || (Number(value || 0) >= 80 ? 'ok' : Number(value || 0) >= 55 ? 'warn' : ''));
}

function statusPill(status) {
  const tone = status === 'completed' ? 'ok' : status === 'failed' ? 'danger' : status === 'running' ? 'warn' : '';
  return pill(status, tone);
}

function labelType(type) {
  return String(type || '').replaceAll('_', ' ');
}

function formatScore(value) {
  return Number(value || 0).toFixed(1);
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : 'never';
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function linkify(value) {
  const text = String(value ?? '');
  if (/^https?:\/\//.test(text)) {
    return `<a href="${escapeAttr(text)}" target="_blank" rel="noreferrer">${escapeHtml(text)}</a>`;
  }
  return escapeHtml(text);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

init().catch((error) => {
  console.error(error);
  el.healthText.textContent = error.message;
});
