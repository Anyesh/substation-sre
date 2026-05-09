import type {
  Claim,
  CoverageGaps,
  Incident,
  PatternRadarResult,
} from '../shared/types.js';
import './styles.css';

type DashboardData = {
  activeIncidents: Incident[];
  activeClaims: Claim[];
  patternRadar: PatternRadarResult | null;
  coverageGaps: CoverageGaps | null;
  stats: { dailyVolume: number; baseline: number };
};

type Banner = { kind: 'error' | 'warn' | 'success'; text: string };

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const els = {
  banner: $('banner'),
  declareBtn: $<HTMLButtonElement>('declareBtn'),
  refreshBtn: $<HTMLButtonElement>('refreshBtn'),
  radarBtn: $<HTMLButtonElement>('radarBtn'),
  seedBtn: $<HTMLButtonElement>('seedBtn'),
  incidents: $('incidents'),
  incidentsCount: $('incidentsCount'),
  claims: $('claims'),
  claimsCount: $('claimsCount'),
  coverage: $('coverage'),
  coverageMeta: $('coverageMeta'),
  radar: $('radar'),
  radarMeta: $('radarMeta'),
  stats: $('stats'),
  statsMeta: $('statsMeta'),
  declareDialog: $<HTMLDialogElement>('declareDialog'),
  declareForm: $<HTMLFormElement>('declareForm'),
  declTitle: $<HTMLInputElement>('declTitle'),
  declSeverity: $<HTMLSelectElement>('declSeverity'),
  declDescription: $<HTMLTextAreaElement>('declDescription'),
  declCancel: $<HTMLButtonElement>('declCancel'),
  declSubmit: $<HTMLButtonElement>('declSubmit'),
  postmortemDialog: $<HTMLDialogElement>('postmortemDialog'),
  postmortemBody: $<HTMLPreElement>('postmortemBody'),
  postmortemCopy: $<HTMLButtonElement>('postmortemCopy'),
  postmortemClose: $<HTMLButtonElement>('postmortemClose'),
};

const SEVERITIES: ReadonlyArray<Incident['severity']> = ['P1', 'P2', 'P3'];

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showBanner(b: Banner | null): void {
  if (!b) {
    els.banner.classList.add('hidden');
    els.banner.textContent = '';
    return;
  }
  els.banner.classList.remove('hidden', 'error', 'warn', 'success');
  if (b.kind === 'error') els.banner.classList.add('error');
  if (b.kind === 'warn') els.banner.classList.add('warn');
  if (b.kind === 'success') els.banner.classList.add('success');
  els.banner.textContent = b.text;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

async function fetchDashboard(): Promise<DashboardData> {
  const res = await fetch('/api/dashboard');
  if (!res.ok) throw new Error(`dashboard ${res.status}`);
  return (await res.json()) as DashboardData;
}

async function closeIncident(incidentId: string): Promise<{ postmortem: string }> {
  const res = await fetch('/api/close-incident', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ incidentId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`close failed: ${res.status} ${text}`);
  }
  return (await res.json()) as { postmortem: string };
}

async function declareIncident(payload: {
  title: string;
  severity: 'P1' | 'P2' | 'P3';
  description: string;
}): Promise<void> {
  const res = await fetch('/api/declare-incident', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`declare failed: ${res.status} ${text}`);
  }
}

async function seedDemo(): Promise<void> {
  const res = await fetch('/api/seed-demo', { method: 'POST' });
  if (!res.ok) throw new Error(`seed failed: ${res.status}`);
}

async function refreshRadar(): Promise<void> {
  const res = await fetch('/api/refresh-radar', { method: 'POST' });
  if (res.status === 429) {
    throw new Error('Pattern radar is rate-limited or already running.');
  }
  if (!res.ok) {
    throw new Error(`radar refresh failed: ${res.status}`);
  }
}

function renderIncidents(items: Incident[]): void {
  els.incidentsCount.textContent = String(items.length);
  if (items.length === 0) {
    els.incidents.innerHTML = '<div class="empty">No active incidents.</div>';
    return;
  }

  const sorted = [...items].sort((a, b) => {
    const sevDiff = SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);
    if (sevDiff !== 0) return sevDiff;
    return b.declaredAt - a.declaredAt;
  });

  const rows = sorted
    .map(
      (i) => `
        <div class="list-row" data-incident-id="${escape(i.id)}">
          <div class="row-main">
            <div>
              <span class="badge badge-${i.severity}">${i.severity}</span>
              <span class="title">${escape(i.title)}</span>
            </div>
            <div class="meta">
              by u/${escape(i.declaredBy)} · ${relativeTime(i.declaredAt)} · ${i.itemCount} items
            </div>
          </div>
          <div class="row-actions">
            <button class="btn btn-danger close-incident" data-id="${escape(i.id)}">Close</button>
          </div>
        </div>`
    )
    .join('');

  els.incidents.innerHTML = `<div class="list">${rows}</div>`;

  for (const btn of els.incidents.querySelectorAll<HTMLButtonElement>('.close-incident')) {
    btn.addEventListener('click', async () => {
      const id = btn.dataset['id'];
      if (!id) return;
      btn.disabled = true;
      btn.textContent = 'Closing…';
      try {
        const { postmortem } = await closeIncident(id);
        showBanner({ kind: 'success', text: 'Incident closed. Post-mortem ready.' });
        showPostmortem(postmortem);
        await load();
      } catch (err) {
        showBanner({ kind: 'error', text: (err as Error).message });
        btn.disabled = false;
        btn.textContent = 'Close';
      }
    });
  }
}

function showPostmortem(markdown: string): void {
  els.postmortemBody.textContent = markdown || '_(empty)_';
  if (typeof els.postmortemDialog.showModal === 'function') {
    els.postmortemDialog.showModal();
  } else {
    els.postmortemDialog.setAttribute('open', '');
  }
}

function renderClaims(items: Claim[]): void {
  els.claimsCount.textContent = String(items.length);
  if (items.length === 0) {
    els.claims.innerHTML = '<div class="empty">No active claims.</div>';
    return;
  }

  const sorted = [...items].sort((a, b) => b.claimedAt - a.claimedAt);
  const rows = sorted
    .map(
      (c) => `
        <div class="list-row">
          <div class="row-main">
            <div class="title">${escape(c.contentId)}</div>
            <div class="meta">u/${escape(c.mod)} · ${relativeTime(c.claimedAt)}${c.incidentId ? ` · incident ${escape(c.incidentId.slice(0, 8))}` : ''}</div>
          </div>
        </div>`
    )
    .join('');

  els.claims.innerHTML = `<div class="list">${rows}</div>`;
}

function renderCoverage(gaps: CoverageGaps | null): void {
  if (!gaps) {
    els.coverageMeta.textContent = 'no data';
    els.coverage.innerHTML =
      '<div class="empty">Coverage not yet computed. Schedules sync hourly.</div>';
    return;
  }

  const gapSet = new Set(gaps.gapHours);
  const nowHour = new Date().getUTCHours();

  const cells = Array.from({ length: 24 }, (_, h) => {
    const cls = ['coverage-cell'];
    cls.push(gapSet.has(h) ? 'gap' : 'covered');
    if (h === nowHour) cls.push('now');
    return `<div class="${cls.join(' ')}" title="${String(h).padStart(2, '0')}:00 UTC${gapSet.has(h) ? ' — gap' : ''}"></div>`;
  }).join('');

  const axis = Array.from({ length: 24 }, (_, h) => {
    const label = h % 6 === 0 ? `${String(h).padStart(2, '0')}` : '';
    return `<span>${label}</span>`;
  }).join('');

  const gapText =
    gaps.gapHours.length === 0
      ? 'full coverage'
      : `${gaps.gapHours.length} gap hr${gaps.gapHours.length === 1 ? '' : 's'}`;

  els.coverageMeta.textContent = `${gapText} · ${relativeTime(gaps.computedAt)}`;
  els.coverage.innerHTML = `
    <div class="coverage-grid">${cells}</div>
    <div class="coverage-axis">${axis}</div>
  `;
}

function renderRadar(radar: PatternRadarResult | null): void {
  if (!radar) {
    els.radarMeta.textContent = 'no data';
    els.radar.innerHTML =
      '<div class="empty">No radar scan yet. Configure an AI key in Settings, then run radar.</div>';
    return;
  }

  els.radarMeta.textContent = `anomaly ${radar.anomalyScore} · ${relativeTime(radar.generatedAt)}`;

  const clusters = radar.clusters
    .map(
      (c) => `
        <div class="cluster">
          <div class="cluster-head">
            <span class="cluster-label">${escape(c.label)}</span>
            <span class="cluster-count">${c.count}</span>
          </div>
          ${
            c.examples.length > 0
              ? `<ul class="cluster-examples">${c.examples
                  .slice(0, 3)
                  .map((e) => `<li>${escape(e)}</li>`)
                  .join('')}</ul>`
              : ''
          }
        </div>`
    )
    .join('');

  const signalsHtml =
    radar.coordinatedSignals.length > 0
      ? `<p class="meta" style="margin-top:10px"><strong>Coordinated signals</strong></p>
         <ul class="signal-list">${radar.coordinatedSignals
           .map((s) => `<li>${escape(s)}</li>`)
           .join('')}</ul>`
      : '';

  const automodHtml =
    radar.suggestedAutomods.length > 0
      ? `<p class="meta" style="margin-top:10px"><strong>Suggested AutoMod</strong></p>
         <ul class="signal-list">${radar.suggestedAutomods
           .map((s) => `<li>${escape(s)}</li>`)
           .join('')}</ul>`
      : '';

  els.radar.innerHTML =
    (clusters || '<div class="empty">No clusters identified.</div>') + signalsHtml + automodHtml;
}

function renderStats(stats: DashboardData['stats']): void {
  const ratio = stats.baseline > 0 ? stats.dailyVolume / stats.baseline : 0;
  let ratioCls = '';
  let ratioLabel: string;
  if (stats.baseline === 0) {
    ratioLabel = 'no baseline yet';
  } else if (ratio >= 3) {
    ratioCls = 'danger';
    ratioLabel = `${ratio.toFixed(1)}x — surge`;
  } else if (ratio >= 1.5) {
    ratioCls = 'warn';
    ratioLabel = `${ratio.toFixed(1)}x — elevated`;
  } else {
    ratioLabel = `${ratio.toFixed(1)}x — normal`;
  }

  els.statsMeta.textContent = ratioLabel;
  els.stats.innerHTML = `
    <div class="stats-row">
      <div class="stat">
        <span class="stat-label">Reports today</span>
        <span class="stat-value">${stats.dailyVolume}</span>
      </div>
      <div class="stat">
        <span class="stat-label">7-day baseline</span>
        <span class="stat-value">${stats.baseline}</span>
      </div>
      <div class="stat">
        <span class="stat-label">vs baseline</span>
        <span class="stat-value ${ratioCls}">${stats.baseline > 0 ? `${ratio.toFixed(1)}x` : '—'}</span>
      </div>
    </div>
  `;
}

let loading = false;

async function load(): Promise<void> {
  if (loading) return;
  loading = true;
  els.refreshBtn.disabled = true;
  try {
    const data = await fetchDashboard();
    renderIncidents(data.activeIncidents);
    renderClaims(data.activeClaims);
    renderCoverage(data.coverageGaps);
    renderRadar(data.patternRadar);
    renderStats(data.stats);
  } catch (err) {
    showBanner({ kind: 'error', text: `Failed to load dashboard: ${(err as Error).message}` });
  } finally {
    loading = false;
    els.refreshBtn.disabled = false;
  }
}

els.refreshBtn.addEventListener('click', () => {
  showBanner(null);
  void load();
});

els.radarBtn.addEventListener('click', async () => {
  showBanner(null);
  els.radarBtn.disabled = true;
  try {
    await refreshRadar();
    showBanner({ kind: 'success', text: 'Radar scan queued. Reload in ~30s.' });
  } catch (err) {
    showBanner({ kind: 'error', text: (err as Error).message });
  } finally {
    els.radarBtn.disabled = false;
  }
});

els.declareBtn.addEventListener('click', () => {
  els.declareForm.reset();
  els.declSeverity.value = 'P2';
  if (typeof els.declareDialog.showModal === 'function') {
    els.declareDialog.showModal();
  } else {
    els.declareDialog.setAttribute('open', '');
  }
  setTimeout(() => els.declTitle.focus(), 0);
});

els.declCancel.addEventListener('click', () => {
  els.declareDialog.close();
});

els.declareForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = els.declTitle.value.trim();
  const severity = els.declSeverity.value as 'P1' | 'P2' | 'P3';
  const description = els.declDescription.value.trim();
  if (!title) return;

  els.declSubmit.disabled = true;
  els.declSubmit.textContent = 'Declaring…';
  try {
    await declareIncident({ title, severity, description });
    els.declareDialog.close();
    showBanner({ kind: 'success', text: `Incident declared: ${title}` });
    await load();
  } catch (err) {
    showBanner({ kind: 'error', text: (err as Error).message });
  } finally {
    els.declSubmit.disabled = false;
    els.declSubmit.textContent = 'Declare';
  }
});

els.postmortemClose.addEventListener('click', () => {
  els.postmortemDialog.close();
});

els.postmortemCopy.addEventListener('click', async () => {
  const text = els.postmortemBody.textContent ?? '';
  try {
    await navigator.clipboard.writeText(text);
    els.postmortemCopy.textContent = 'Copied!';
    setTimeout(() => (els.postmortemCopy.textContent = 'Copy markdown'), 1500);
  } catch {
    els.postmortemCopy.textContent = 'Copy failed';
  }
});

els.seedBtn.addEventListener('click', async () => {
  els.seedBtn.disabled = true;
  const original = els.seedBtn.textContent;
  els.seedBtn.textContent = 'Seeding…';
  try {
    await seedDemo();
    showBanner({ kind: 'success', text: 'Demo data loaded.' });
    await load();
  } catch (err) {
    showBanner({ kind: 'error', text: (err as Error).message });
  } finally {
    els.seedBtn.disabled = false;
    els.seedBtn.textContent = original;
  }
});

void load();
setInterval(() => void load(), 60_000);
