/* History: every payment the senior made — paid, failed or stopped — plus tasks
   they started and left half-way. Opened from the "History" button, or by saying
   "show my payments" / "पिछले भुगतान" / "నా చెల్లింపులు".
   Voice on this screen: "paid", "failed", "stopped", "all" filter the list. */

const HIST_FILTERS = ['all', 'paid', 'failed', 'stopped'];

function histWhen(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const n = Math.round((today - day) / 86400000);
  const code = LANGS[App.lang || 'en'].code;
  let time = '';
  try { time = d.toLocaleTimeString(code, { hour: 'numeric', minute: '2-digit' }); } catch (e) { /* old browser */ }
  if (n <= 0) return t('today') + ', ' + time;
  if (n === 1) return t('yesterday') + ', ' + time;
  if (n < 7) return t('days_ago', { n });
  try { return d.toLocaleDateString(code, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return iso.slice(0, 10); }
}

function histIcon(p) {
  if (p.type === 'ticket') return p.mode === 'bus' ? ICONS.bus : ICONS.train;
  return { electricity: ICONS.bulb, water: ICONS.water, mobile: ICONS.mobile }[p.category] || ICONS.bill;
}

function histReason(p) {
  const stage = p.stage ? t('stage_' + p.stage) : '';
  if (p.outcome === 'paid' || p.outcome === 'in_progress') return '';
  const r = t('reason_' + (p.reason || 'left'), { stage }).replace(/\s+([.।])$/, '$1');
  return r + ' ' + t('hist_no_money');
}

function histPurpose(p) {
  if (p.type === 'ticket') {
    return [t(p.mode === 'bus' ? 'mode_bus' : 'mode_train'), p.from_name && p.to_name ? `${p.from_name} → ${p.to_name}` : ''].filter(Boolean).join(' · ');
  }
  return p.category ? t('cat_' + p.category) : t('task_bill');
}

function stepName(s) {
  const loc = (typeof STEP_NAMES !== 'undefined' && STEP_NAMES[App.lang]) || null;
  return (loc && loc[s.step]) || s.step_label || s.step;
}

function taskName(task) {
  return t({ scam_check: 'task_scam' }[task] || 'task_' + task);
}

function histItemHtml(p) {
  const chip = { paid: ICONS.check, failed: ICONS.xmark, stopped: ICONS.pause, in_progress: ICONS.clock }[p.outcome];
  const canRetry = (p.outcome === 'failed' || p.outcome === 'stopped') && p.type === 'bill' && p.reason !== 'limit';
  const reason = histReason(p);
  return `
    <article class="hist-item out-${p.outcome}">
      <span class="hist-ico" aria-hidden="true">${histIcon(p)}</span>
      <div class="hist-main">
        <b class="hist-payee">${esc(p.payee)}</b>
        <span class="hist-meta">${esc(histPurpose(p))} · ${esc(histWhen(p.created_at))}</span>
        ${reason ? `<span class="hist-reason">${esc(reason)}</span>` : ''}
        <span class="hist-ref">${esc(t('hist_ref'))}: ${esc(p.ref)}</span>
      </div>
      <div class="hist-side">
        <strong class="hist-amt">₹${p.amount.toLocaleString('en-IN')}</strong>
        <span class="chip chip-${p.outcome}"><span class="ico">${chip}</span>${esc(t('out_' + p.outcome))}</span>
        ${canRetry ? `<button class="hist-retry" data-retry="${p.id}">${esc(t('hist_try_again'))}</button>` : ''}
      </div>
    </article>`;
}

function histSessionHtml(s) {
  const icon = { bill: ICONS.bill, ticket: ICONS.ticket, call: ICONS.video, scam_check: ICONS.shield, doc: ICONS.doc }[s.task] || ICONS.list;
  const why = t('why_' + (['home', 'cancel', 'error'].includes(s.reason) ? s.reason : 'closed'));
  const extra = [s.retries ? t('hist_retries', { n: s.retries }) : '', s.help ? t('hist_helped') : ''].filter(Boolean).join(' · ');
  return `
    <article class="hist-item out-left">
      <span class="hist-ico" aria-hidden="true">${icon}</span>
      <div class="hist-main">
        <b class="hist-payee">${esc(taskName(s.task))}</b>
        <span class="hist-meta">${esc(histWhen(s.started_at))} · ${esc(why)}</span>
        <span class="hist-reason">${esc(t('hist_left_at', { step: stepName(s), n: Math.max(s.step_no, 1), total: s.step_total }))}</span>
        ${extra ? `<span class="hist-ref">${esc(extra)}</span>` : ''}
      </div>
      <div class="hist-side">
        <div class="hist-steps" aria-hidden="true">${Array.from({ length: s.step_total }, (_, i) => `<i class="${i < s.step_no ? 'on' : ''}"></i>`).join('')}</div>
      </div>
    </article>`;
}

async function historyScreen() {
  document.body.classList.remove('on-home');
  document.body.classList.add('on-history');
  App.task = null; App.step = 'history';
  UI.progress(0);
  UI.loading(t('hist_loading'));
  let data;
  try { data = await api('/api/history'); }
  catch (e) {
    document.body.classList.remove('on-history');
    try { await UI.info({ title: t('pay_failed'), cls: 'bad', button: t('go_home') }); } catch (x) { /* back */ }
    return;
  }
  const sm = data.summary;
  let filter = 'all', first = true, showAll = false;
  try {
    for (;;) {
      const list = data.payments.filter(p => filter === 'all' || p.outcome === filter);
      const sessions = (filter === 'all' || filter === 'stopped') ? data.unfinished : [];
      const shown = showAll ? list : list.slice(0, 8);
      const tab = f => `<button class="hist-tab ${f === filter ? 'on' : ''}" data-f="${f}" role="tab" aria-selected="${f === filter}">${esc(t('hist_' + f))}${f === 'all' ? '' : ` <span>${sm[f]}</span>`}</button>`;
      UI.render(`
        <h2 class="prompt">${esc(t('hist_title'))}</h2>
        <p class="hint">${esc(t('hist_sub'))}</p>
        <div class="hist-stats">
          <button class="hist-stat paid" data-f="paid"><span class="ico">${ICONS.check}</span><b>${sm.paid}</b><span>${esc(t('hist_paid'))}</span><small>${esc(t('hist_total'))}: ₹${sm.paid_amount.toLocaleString('en-IN')}</small></button>
          <button class="hist-stat failed" data-f="failed"><span class="ico">${ICONS.xmark}</span><b>${sm.failed}</b><span>${esc(t('hist_failed'))}</span></button>
          <button class="hist-stat stopped" data-f="stopped"><span class="ico">${ICONS.pause}</span><b>${sm.stopped}</b><span>${esc(t('hist_stopped'))}</span></button>
          <button class="hist-stat left" data-f="stopped"><span class="ico">${ICONS.clock}</span><b>${sm.unfinished}</b><span>${esc(t('hist_unfinished'))}</span></button>
        </div>
        <div class="hist-tabs" role="tablist">${HIST_FILTERS.map(tab).join('')}</div>
        <div class="hist-list">
          ${shown.length ? shown.map(histItemHtml).join('') : `<p class="hist-empty">${esc(t('hist_empty'))}</p>`}
          ${list.length > shown.length ? `<button class="hist-more" id="hist-more">${esc(t('show_more'))} (${list.length - shown.length})</button>` : ''}
        </div>
        ${sessions.length ? `
          <h3 class="hist-h3">${esc(t('hist_unfinished'))}</h3>
          <p class="hint">${esc(t('hist_unfinished_sub'))}</p>
          <div class="hist-list">${sessions.slice(0, showAll ? 30 : 5).map(histSessionHtml).join('')}</div>` : ''}
      `);
      let speech;
      if (first) speech = t('hist_say', { paid: sm.paid, amount: sm.paid_amount.toLocaleString('en-IN'), failed: sm.failed, stopped: sm.stopped });
      else if (!list.length) speech = t('hist_say_none', { what: t('hist_w_' + filter) });
      else {
        speech = (filter === 'all' ? '' : t('hist_say_filter', { n: list.length, what: t('hist_w_' + filter) })) +
          list.slice(0, 3).map(p => t('hist_say_item', { amount: p.amount, payee: p.payee, when: histWhen(p.created_at), status: t('out_' + p.outcome) }) +
            (p.outcome === 'failed' || p.outcome === 'stopped' ? ' ' + histReason(p) : '')).join(' ');
      }
      first = false;
      const r = await UI.interact({
        speech,
        hint: () => [t('hist_paid'), t('hist_failed'), t('hist_stopped'), t('hist_all')].join(', '),
        setup: ctl => {
          const st = UI.stage();
          st.querySelectorAll('[data-f]').forEach(b => b.onclick = () => ctl.resolve({ filter: b.dataset.f }));
          st.querySelectorAll('[data-retry]').forEach(b => b.onclick = () => ctl.resolve({ retry: +b.dataset.retry }));
          const more = st.querySelector('#hist-more');
          if (more) more.onclick = () => ctl.resolve({ more: true });
        },
        onVoice: async (alts, ctl) => {
          for (const f of ['failed', 'stopped', 'paid', 'all']) {          // "not paid" must win over "paid"
            if (Match.anyOf(alts, VOCAB['hist_' + f] || [])) { ctl.resolve({ filter: f }); return true; }
          }
          return false;
        },
      });
      if (r.more) { showAll = true; continue; }
      if (r.filter) { filter = r.filter; showAll = false; continue; }
      if (r.retry) {
        const p = data.payments.find(x => x.id === r.retry);
        const num = p && (p.consumer_no || null);
        App.prefillBill = { cat: p.category, num, amount: null };
        App.nextTask = 'bill';
        return;
      }
    }
  } catch (e) {
    if (e !== BACK && e !== HOME && e !== CANCEL) console.error(e);
  } finally {
    document.body.classList.remove('on-history');
  }
}
