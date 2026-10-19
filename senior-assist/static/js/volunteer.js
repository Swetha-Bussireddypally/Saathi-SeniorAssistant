/* Volunteer dashboard — refreshes every 5 seconds from /api/dashboard. */
const $ = id => document.getElementById(id);
const CSRF = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
const post = (url, data) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF }, body: JSON.stringify(data || {}) });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let DATA = null;
let funnelTask = 'bill';

function ago(iso) {
  // both times come from the server clock, so time zones never disagree
  const now = DATA && DATA.server_now ? new Date(DATA.server_now).getTime() : Date.now();
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return Math.round(s) + 's ago';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}

/* tooltip for any element with data-tip */
document.addEventListener('pointermove', e => {
  const el = e.target.closest('[data-tip]');
  const tip = $('tip');
  if (!el) { tip.hidden = true; return; }
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const x = Math.min(window.innerWidth - tip.offsetWidth - 12, e.clientX + 14);
  tip.style.left = x + 'px';
  tip.style.top = (e.clientY + 16) + 'px';
});

function renderKpis(k) {
  const items = [
    ['Sessions', k.sessions, 'tasks started'],
    ['Completed', k.completion_rate + '%', `${k.completed} of ${k.sessions}`],
    ['Stuck sessions', k.stuck_sessions, '3+ voice retries on a step'],
    ['Open help requests', k.open_help, 'waiting for a volunteer', k.open_help > 0],
    ['Scam warnings', k.scam_warnings, 'fraud messages caught'],
    ['Not understood', k.not_understood, 'voice inputs that failed'],
  ];
  $('kpis').innerHTML = items.map(([l, v, n, alert]) =>
    `<div class="kpi ${alert ? 'alert' : ''}"><div class="k-label">${esc(l)}</div><div class="k-value">${esc(v)}</div><div class="k-note">${esc(n)}</div></div>`).join('');
}

function renderHelp(rows) {
  const box = $('help-list');
  // don't wipe a hint the volunteer is typing
  if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  if (!rows.length) { box.innerHTML = '<p class="empty">No one is waiting for help. 🎉</p>'; return; }
  const quick = ['Press the big green YES button.', 'Say the number slowly, two digits at a time.', 'Tap the microphone and speak after the beep.', 'Do not share your OTP with anyone.'];
  box.innerHTML = rows.map(r => `
    <div class="help-item" data-id="${r.id}">
      <div class="who">${r.kind === 'fraud' ? '<span class="badge stuck">🛡️ Possible fraud — call them now</span> ' : ''}${esc(r.user)} <span class="lang-tag">· ${esc(r.lang_label || '')} · ${esc(ago(r.created_at))}</span></div>
      <div class="where">Stuck in <b>${esc(r.task_label)}</b> → <b>${esc(r.step_label)}</b></div>
      ${r.hint ? `<div class="where">Last hint sent: “${esc(r.hint)}” ${r.hint_delivered ? '✓ delivered' : '… sending'}</div>` : ''}
      <div class="help-actions">
        <input type="text" placeholder="Type a hint to read aloud on their phone…" aria-label="Hint for ${esc(r.user)}">
        <button class="btn primary" data-act="hint">Send hint</button>
        <button class="btn" data-act="resolve">Mark resolved</button>
      </div>
      <div class="quick">${quick.map(q => `<button data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    </div>`).join('');
}

$('help-list').addEventListener('click', async e => {
  const item = e.target.closest('.help-item');
  if (!item) return;
  const id = item.dataset.id;
  const input = item.querySelector('input');
  if (e.target.dataset.q) { input.value = e.target.dataset.q; input.focus(); return; }
  if (e.target.dataset.act === 'hint' && input.value.trim()) {
    await post(`/api/help/${id}/hint`, { hint: input.value.trim() });
    input.value = ''; input.blur(); load();
  }
  if (e.target.dataset.act === 'resolve') {
    await post(`/api/help/${id}/resolve`);
    load();
  }
});
$('help-list').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.closest('.help-item').querySelector('[data-act=hint]').click(); });

function renderLive(rows) {
  if (!rows.length) { $('live-list').innerHTML = '<p class="empty">Nobody is struggling right now.</p>'; return; }
  $('live-list').innerHTML = rows.map(r => `
    <div class="live-item">
      <div><b>${esc(r.user)}</b> <span class="lang-tag">${esc(r.lang)}</span><br><span class="where">${esc(r.task_label)} → ${esc(r.step_label)}</span></div>
      <div style="text-align:right">${r.stuck ? '<span class="badge stuck">⚠ Stuck</span>' : r.retries_here ? `<span class="badge slow">${r.retries_here} retries</span>` : '<span class="lang-tag">in progress</span>'}<br><span class="lang-tag">${esc(ago(r.last_seen))}</span></div>
    </div>`).join('');
}

function renderFunnelTabs() {
  const labels = { bill: 'Bill payment', ticket: 'Ticket booking', call: 'Video call', scam_check: 'Message check', doc: 'Read a bill' };
  $('funnel-tabs').innerHTML = Object.entries(labels).map(([k, v]) =>
    `<button class="tab" role="tab" aria-selected="${k === funnelTask}" data-task="${k}">${v}</button>`).join('');
}
$('funnel-tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-task]'); if (!b) return;
  funnelTask = b.dataset.task; renderFunnelTabs(); renderFunnel();
});

function renderFunnel() {
  const steps = DATA.funnels[funnelTask];
  const start = steps[0].count || 0;
  if (!start) { $('funnel').innerHTML = '<p class="empty">No sessions for this task in this period.</p>'; return; }
  // biggest drop between consecutive steps
  let worst = -1, worstDrop = 0;
  for (let i = 1; i < steps.length; i++) { const d = steps[i - 1].count - steps[i].count; if (d > worstDrop) { worstDrop = d; worst = i; } }
  $('funnel').innerHTML = steps.map((s, i) => {
    const pct = Math.round(100 * s.count / start);
    const drop = i > 0 ? steps[i - 1].count - s.count : 0;
    return `${i === worst ? `<div class="drop-note">▼ biggest drop: ${worstDrop} people left before “${esc(s.label)}”</div>` : ''}
      <div class="hbar" data-tip="${esc(s.label)}: ${s.count} sessions (${pct}% of starts)${drop > 0 ? ` · ${drop} dropped since previous step` : ''}">
        <span class="lbl">${esc(s.label)}</span>
        <span class="track"><span class="fill" style="width:${pct}%"></span></span>
        <span class="val">${s.count} <small>${pct}%</small></span>
      </div>`;
  }).join('');
}

function renderTasks(rows) {
  $('tasks-tbl').innerHTML = `<thead><tr><th>Task</th><th class="num">Started</th><th class="num">Done</th><th class="num">Avg time</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${r.sessions}</td>
      <td class="num">${r.sessions ? Math.round(100 * r.completed / r.sessions) + '%' : '—'}</td>
      <td class="num">${r.avg_minutes != null ? r.avg_minutes + ' min' : '—'}</td></tr>`).join('') + '</tbody>';
}

function renderTrouble(rows) {
  if (!rows.length) { $('trouble-tbl').innerHTML = '<tr><td class="empty">No trouble spots yet.</td></tr>'; return; }
  const maxD = Math.max(1, ...rows.map(r => r.dropoffs)), maxR = Math.max(1, ...rows.map(r => r.retries));
  $('trouble-tbl').innerHTML = `<thead><tr><th>Task</th><th>Step</th><th class="num">Gave up here</th><th></th><th class="num">Voice retries</th><th></th></tr></thead><tbody>` +
    rows.map(r => `<tr>
      <td>${esc(r.task_label)}</td><td><b>${esc(r.step_label)}</b></td>
      <td class="num">${r.dropoffs}</td><td style="width:18%"><span class="minibar drop" style="width:${100 * r.dropoffs / maxD}%" data-tip="${r.dropoffs} people gave up at ${esc(r.step_label)}"></span></td>
      <td class="num">${r.retries}</td><td style="width:18%"><span class="minibar" style="width:${100 * r.retries / maxR}%" data-tip="${r.retries} voice inputs not understood at ${esc(r.step_label)}"></span></td>
    </tr>`).join('') + '</tbody>';
}

function renderLangs(rows) {
  if (!rows.length) { $('lang-bars').innerHTML = '<p class="empty">No data yet.</p>'; return; }
  const max = Math.max(0.01, ...rows.map(r => r.fails_per_session));
  $('lang-bars').innerHTML = rows.map(r => `
    <div class="hbar" style="grid-template-columns: 6rem 1fr 7rem" data-tip="${esc(r.lang)}: ${r.not_understood} not understood in ${r.sessions} sessions">
      <span class="lbl">${esc(r.lang)}</span>
      <span class="track"><span class="fill" style="width:${100 * r.fails_per_session / max}%"></span></span>
      <span class="val">${r.fails_per_session} <small>/session</small></span>
    </div>`).join('') +
    `<p class="card-sub" style="margin-top:.6rem">${rows.map(r => `${esc(r.lang)}: ${r.sessions} sessions`).join(' · ')}</p>`;
}

function renderFails(rows) {
  if (!rows.length) { $('fails-tbl').innerHTML = '<tr><td class="empty">Nothing yet — every voice input was understood.</td></tr>'; return; }
  $('fails-tbl').innerHTML = `<thead><tr><th>What the system heard</th><th>Language</th><th>Task</th><th>Step</th><th>When</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td>“${esc(r.heard)}”</td><td>${esc(r.lang)}</td><td>${esc(r.task)}</td><td>${esc(r.step)}</td><td>${esc(ago(r.time))}</td></tr>`).join('') + '</tbody>';
}

async function load() {
  try {
    const r = await fetch('/api/dashboard?days=' + $('days').value);
    if (r.status === 401) { window.location.href = '/login/volunteer?next=/volunteer'; return; }
    DATA = await r.json();
    $('live-dot').classList.remove('off');
  } catch (e) { $('live-dot').classList.add('off'); return; }
  $('demo-note').hidden = !DATA.has_demo;
  renderKpis(DATA.kpis);
  renderHelp(DATA.help);
  renderLive(DATA.live);
  renderFunnelTabs(); renderFunnel();
  renderTasks(DATA.tasks);
  renderTrouble(DATA.trouble);
  renderLangs(DATA.languages);
  renderFails(DATA.asr_fails);
}


/* ---------- payment & session log ---------- */
const PL = { filter: 'all', data: null, users: false };
const REASON = {
  limit: 'Over daily limit — needs family approval', pin_blocked: 'Wrong PIN 3 times',
  user_cancelled: 'Senior cancelled', left: 'Left before confirming',
};
const STAGE = { confirm: 'at confirm', hold: 'at hold-to-pay', pin: 'at PIN', countdown: 'during countdown' };
const OUT = { paid: 'Paid', failed: 'Failed', stopped: 'Stopped', in_progress: 'In progress' };
const WHY = { home: 'went Home', cancel: 'cancelled', error: 'error', closed: 'app closed / timed out' };

function renderPayLog() {
  const d = PL.data; if (!d) return;
  const sm = d.summary;
  $('pl-tabs').innerHTML = ['all', 'paid', 'failed', 'stopped'].map(f =>
    `<button class="tab" role="tab" aria-selected="${f === PL.filter}" data-plf="${f}">${f[0].toUpperCase() + f.slice(1)}${f === 'all' ? '' : ' · ' + sm[f]}</button>`).join('');
  $('pl-sum').innerHTML = `<span>✅ ${sm.paid} paid · ₹${sm.paid_amount.toLocaleString('en-IN')}</span><span>❌ ${sm.failed} failed</span>
    <span>⏸ ${sm.stopped} stopped</span><span>🕒 ${sm.unfinished} tasks left half-way</span>`;
  const rows = d.payments.filter(p => PL.filter === 'all' || p.outcome === PL.filter);
  $('pl-tbl').innerHTML = rows.length ? `<thead><tr><th>When</th><th>Senior</th><th>Type</th><th>Paid to</th><th class="num">Amount</th><th>Status</th><th>Why / where</th><th>Ref</th></tr></thead><tbody>` +
    rows.map(p => `<tr>
      <td>${esc(ago(p.created_at))}</td><td>${esc(p.user_name || '#' + p.user_id)}</td>
      <td>${p.type === 'ticket' ? '🎫 ' + esc(p.mode || 'ticket') : '🧾 ' + esc(p.category || 'bill')}</td>
      <td>${esc(p.payee)}${p.from_name && p.to_name ? `<br><small>${esc(p.from_name)} → ${esc(p.to_name)}</small>` : ''}</td>
      <td class="num">₹${p.amount.toLocaleString('en-IN')}</td>
      <td><span class="st ${p.outcome}">${OUT[p.outcome]}</span></td>
      <td>${p.outcome === 'paid' ? '—' : esc((REASON[p.reason] || '') + (p.stage && p.reason !== 'limit' ? ' ' + STAGE[p.stage] : ''))}</td>
      <td><small>${esc(p.ref)}</small></td></tr>`).join('') + '</tbody>'
    : '<tr><td class="empty">No payments match.</td></tr>';
  const ss = (PL.filter === 'all' || PL.filter === 'stopped') ? d.unfinished.slice(0, 25) : [];
  $('pl-sess').innerHTML = ss.length ? `<thead><tr><th>When</th><th>Senior</th><th>Task</th><th>Stopped at</th><th>Why</th><th class="num">Voice retries</th></tr></thead><tbody>` +
    ss.map(s => `<tr><td>${esc(ago(s.last_at))}</td><td>${esc(s.user_name || '#' + s.user_id)}</td><td>${esc(s.task_label)}</td>
      <td><b>${esc(s.step_label)}</b> <small>(step ${Math.max(s.step_no, 1)} of ${s.step_total})</small></td>
      <td>${esc(WHY[s.reason] || s.reason)}${s.help ? ' · asked for help' : ''}</td><td class="num">${s.retries}</td></tr>`).join('') + '</tbody>'
    : '<tr><td class="empty">Nothing left half-way.</td></tr>';
}

async function loadPayLog() {
  try {
    const u = $('pl-user').value;
    const r = await fetch('/api/history' + (u ? '?user_id=' + u : ''));
    if (!r.ok) return;
    PL.data = await r.json();
    if (!PL.users) {           // fill the senior picker once
      const names = {};
      PL.data.payments.forEach(p => { names[p.user_id] = p.user_name; });
      PL.data.unfinished.forEach(s => { names[s.user_id] = s.user_name; });
      Object.entries(names).sort((a, b) => String(a[1]).localeCompare(String(b[1]))).forEach(([id, n]) => {
        const o = document.createElement('option'); o.value = id; o.textContent = n || '#' + id; $('pl-user').appendChild(o);
      });
      PL.users = true;
    }
    renderPayLog();
  } catch (e) { /* offline */ }
}
$('pl-tabs').addEventListener('click', e => { const b = e.target.closest('[data-plf]'); if (b) { PL.filter = b.dataset.plf; renderPayLog(); } });
$('pl-user').onchange = loadPayLog;

$('days').onchange = load;
$('clear-demo').onclick = async () => {
  if (!confirm('Remove the sample demo activity? Real activity is kept.')) return;
  await post('/api/dashboard/clear-demo'); load(); loadPayLog();
};
load(); loadPayLog();
setInterval(load, 5000);
setInterval(loadPayLog, 10000);
