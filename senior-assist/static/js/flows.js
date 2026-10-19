/* The guided tasks. Each task is a list of steps; the engine below runs them in
   order, handles "Back", "Cancel", "Home" and logs every step for the volunteer
   dashboard (which is how it learns where people get stuck). */

function newSession() { return 's-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
const Goto = id => ({ goto: id });

async function runTask(task, steps) {
  document.body.classList.remove('on-home');
  App.task = task; App.session = newSession(); App.step = 'start';
  logEvent('start');
  const ctx = {};
  let i = 0, dir = 1, finished = false;
  try {
    while (i < steps.length) {
      const s = steps[i];
      App.step = s.id;
      UI.progress(Math.min(i + 1, steps.length - 1), steps.length - 1);
      if (dir === -1 && s.auto) { i--; if (i < 0) throw HOME; continue; }
      if (s.id === 'complete') { logEvent('complete'); finished = true; UI.progress(0); }
      else logEvent('step');
      let r;
      try { r = await s.run(ctx); }
      catch (e) {
        if (e === BACK) { if (s.id === 'complete' || i === 0) throw HOME; dir = -1; i--; continue; }
        if (e && e.goto) { i = steps.findIndex(x => x.id === e.goto); dir = 1; continue; }
        throw e;
      }
      if (r === 'skip' && dir === -1) { i--; if (i < 0) throw HOME; continue; }
      dir = 1; i++;
    }
  } catch (e) {
    if (!finished) {
      if (e === CANCEL) { logEvent('abandon', { reason: 'cancel' }); await say(t('cancelled')); }
      else if (e === HOME) logEvent('abandon', { reason: 'home' });
      else { console.error(e); logEvent('abandon', { reason: 'error', message: String(e && e.message || e) }); }
    }
  }
  App.task = null; App.session = null; App.step = null; App.current = null; App.ack = null;
  UI.progress(0);
  document.getElementById('btn-help').classList.remove('pulse');
}

/* ======================= BILL PAYMENT ======================= */
const BILL_ICONS = { electricity: ICONS.bulb, water: ICONS.water, mobile: ICONS.mobile };
const billFlow = [
  { id: 'category', run: async c => {
      if (App.prefillBill) {                       // came from "Pay this bill" in the document reader
        c.cat = App.prefillBill.cat; c.docAmount = App.prefillBill.amount; c.prefillNum = App.prefillBill.num;
        App.prefillBill = null;
        return;
      }
      c.cat = await UI.choose({
        prompt: t('bill_which'), cols: 3,
        options: ['electricity', 'water', 'mobile'].map(k => ({ value: k, label: t('cat_' + k), icon: BILL_ICONS[k], words: VOCAB['cat_' + k] })),
      });
  } },
  { id: 'consumer', run: async c => {
      if (c.prefillNum) { c.num = c.prefillNum; c.prefillNum = null; c.verified = false; return; }   // still read back next
      const saved = App.user && App.user.saved_billers && App.user.saved_billers[c.cat];
      const mobile = c.cat === 'mobile';
      for (;;) {
        c.verified = false;
        if (saved) {
          const r = await UI.askYesNo({
            prompt: t('bill_saved_q', { num: saved }),
            speech: t('bill_saved_q', { num: spaced(saved) }),
            extra: `<div class="numdisplay">${esc(saved)}</div>`,
          });
          if (r.yes) { c.num = saved; c.verified = true; return; }
        }
        try {
          c.num = await UI.askNumber({ prompt: mobile ? t('bill_enter_mobile') : t('bill_enter_num'), minLen: mobile ? 10 : 6, maxLen: mobile ? 10 : 12 });
          return;
        } catch (e) {
          if (e === BACK && saved) continue;      // Back from the keypad → the "use saved number?" question
          throw e;
        }
      }
  } },
  { id: 'verify_number', run: async c => {
      if (c.verified) return 'skip';
      const r = await UI.askYesNo({
        prompt: t('num_readback', { num: c.num }),
        speech: t('num_readback', { num: spaced(c.num) }),
        extra: `<div class="numdisplay">${esc(c.num)}</div>`,
      });
      if (!r.yes) throw BACK;
      c.verified = true;
  } },
  { id: 'fetch_bill', auto: true, run: async c => {
      UI.loading(t('please_wait'));
      try { c.bill = await api(`/api/bill?category=${c.cat}&consumer=${c.num}`); }
      catch (e) { await UI.info({ title: t('bill_error'), cls: 'bad', button: t('back') }); throw Goto('consumer'); }
  } },
  { id: 'review', run: async c => {
      const b = c.bill;
      const card = `<div class="summary">
          <div class="row"><span>${esc(t('lbl_board'))}</span><strong>${esc(b.board)}</strong></div>
          ${b.customer_name ? `<div class="row"><span>${esc(t('lbl_name'))}</span><strong>${esc(b.customer_name)}</strong></div>` : ''}
          <div class="row"><span>${esc(t('lbl_consumer'))}</span><strong>${esc(b.consumer_no)}</strong></div>
          <div class="row"><span>${esc(t('lbl_due'))}</span><strong>${esc(fmtDate(b.due_date))}</strong></div>
          <div class="row amount"><span>${esc(t('lbl_amount'))}</span><strong>₹${b.amount}</strong></div></div>`;
      const found = t('bill_found', { cat: t('cat_' + c.cat), amount: b.amount, due: fmtDate(b.due_date) });
      // safety: the paper bill and the board's records must agree
      const mismatch = c.docAmount && Math.round(c.docAmount) !== Math.round(b.amount)
        ? t('doc_mismatch', { paper: Math.round(c.docAmount), board: b.amount }) : '';
      const r = await UI.askYesNo({ prompt: t('bill_pay_q'), extra: card + (mismatch ? `<div class="warning">⚠️ ${esc(mismatch)}</div>` : ''),
        speech: found + ' ' + (mismatch ? mismatch + ' ' : '') + t('bill_pay_q') });
      if (!r.yes) throw CANCEL;
  } },
  { id: 'confirm', run: async c => {
      c.receipt = await UI.confirmAndPay({
        type: 'bill', payee: c.bill.board, amount: c.bill.amount, purpose: t('cat_' + c.cat),
        account: c.num, details: { category: c.cat, consumer_no: c.num },
      });
  } },
  { id: 'complete', run: async c => {
      const r = c.receipt;
      await UI.done({
        lines: [[t('receipt'), r.ref], [t('lbl_pay_to'), r.payee], [t('lbl_amount'), '₹' + r.amount], [t('paid_on'), r.time]],
        speech: t('paid_ok', { amount: r.amount, ref: spaced(r.ref.replace('SA-', '')) }),
      });
  } },
];

/* ======================= TICKET BOOKING ======================= */
function isoIn(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const cityOptions = exclude => CITY_LIST.filter(c => c.id !== exclude).map(c => ({
  value: c.id, label: c[App.lang] || c.en, sub: App.lang === 'en' ? '' : c.en, words: [c.en, c.hi, c.te, ...c.words],
}));

const ticketFlow = [
  { id: 'mode', run: async c => {
      c.mode = await UI.choose({ prompt: t('tkt_mode'), options: [
        { value: 'bus', label: t('mode_bus'), sub: t('mode_bus_sub'), icon: ICONS.bus, words: VOCAB.mode_bus },
        { value: 'train', label: t('mode_train'), sub: t('mode_train_sub'), icon: ICONS.train, words: VOCAB.mode_train }] });
  } },
  { id: 'from', run: async c => { c.from = await UI.choose({ prompt: t('tkt_from'), options: cityOptions(null), cls: 'cities' }); } },
  { id: 'to', run: async c => { c.to = await UI.choose({ prompt: t('tkt_to'), options: cityOptions(c.from), cls: 'cities' }); } },
  { id: 'date', run: async c => {
      c.dateKey = await UI.choose({ prompt: t('tkt_date'), cols: 3, options: [
        { value: 'today', label: t('today'), sub: fmtDate(isoIn(0)), icon: ICONS.calendar, words: VOCAB.today },
        { value: 'tomorrow', label: t('tomorrow'), sub: fmtDate(isoIn(1)), icon: ICONS.calendar, words: VOCAB.tomorrow },
        { value: 'day_after', label: t('day_after'), sub: fmtDate(isoIn(2)), icon: ICONS.calendar, words: VOCAB.day_after }] });
      c.date = isoIn({ today: 0, tomorrow: 1, day_after: 2 }[c.dateKey]);
  } },
  { id: 'choose_option', run: async c => {
      UI.loading(t('please_wait'));
      const opts = await api(`/api/journeys?mode=${c.mode}&from=${c.from}&to=${c.to}&date=${c.date}`);
      const lines = opts.map((o, i) => t('opt_line', { i: i + 1, name: o.name.replace(' (Demo)', ''), dep: o.depart, arr: o.arrive, fare: o.fare }));
      const pick = await UI.choose({
        prompt: t('tkt_pick'), cols: 1, cls: 'journeys',
        speech: [t('tkt_found', { n: opts.length }), ...lines, t('tkt_pick'), Voice.supported ? t('read_tip') : ''].join(' '),
        options: opts.map((o, i) => ({
          value: i, label: o.name, words: [o.name.replace(' (Demo)', ''), 'option ' + (i + 1), 'विकल्प ' + (i + 1), 'ఎంపిక ' + (i + 1)],
          // what Saathi says when asked to read only this option
          speak: t('opt_detail', { name: o.name.replace(' (Demo)', ''), dep: o.depart, arr: o.arrive, fare: o.fare }),
          // lets the user say "the cheapest", "the fastest", "the morning one", "the night bus"
          meta: { fare: o.fare, hours: o.hours, hour: parseInt(o.depart, 10) },
          html: `<span class="opt-num">${i + 1}</span>
            <span class="opt-body"><span class="choice-label">${esc(o.name)}</span>
            <span class="opt-times"><b>${o.depart}</b> → <b>${o.arrive}</b> ${o.next_day ? esc(t('next_day')) : ''} · ${o.hours} h</span>
            <span class="opt-meta">${esc(t('lbl_fare'))} <b>₹${o.fare}</b> · ${o.seats_left} ${esc(t('lbl_seats'))}</span></span>`,
        })),
      });
      c.opt = opts[pick];
  } },
  { id: 'seat', run: async c => {
      c.seat = await UI.choose({ prompt: t('tkt_seat'), options: [
        { value: 'lower', label: t('seat_lower'), icon: ICONS.seat_lower, words: VOCAB.seat_lower },
        { value: 'any', label: t('seat_any'), icon: ICONS.seat_any, words: VOCAB.seat_any }] });
  } },
  { id: 'confirm', run: async c => {
      c.purpose = t('tkt_purpose', { mode: t('mode_' + c.mode), from: cityName(c.from), to: cityName(c.to), date: fmtDate(c.date) });
      c.receipt = await UI.confirmAndPay({
        type: 'ticket', payee: c.mode === 'train' ? 'Railway Booking (Demo)' : 'Bus Booking (Demo)',
        amount: c.opt.fare, purpose: c.purpose + ' · ' + c.opt.name.replace(' (Demo)', '') + ' ' + c.opt.depart,
        details: { mode: c.mode, from: c.from, to: c.to, date: c.date, seat: c.seat, option_id: c.opt.id },
      });
  } },
  { id: 'complete', run: async c => {
      const r = c.receipt;
      await UI.done({
        lines: [[t('lbl_booking'), r.ref], [t('lbl_journey'), c.purpose], [c.opt.name, `${c.opt.depart} → ${c.opt.arrive}`],
                [t('lbl_seat'), r.seat], [t('lbl_amount'), '₹' + r.amount]],
        speech: t('tkt_done', { ref: spaced(r.ref.replace('SA-', '')), seat: r.seat }),
      });
  } },
];

/* ======================= VIDEO CALL ======================= */
const callFlow = [
  { id: 'choose_contact', run: async c => {
      if (!c.contacts) c.contacts = await api(`/api/contacts/${App.userId}`);
      const id = await UI.choose({
        prompt: t('call_who'), cls: 'contacts',
        options: c.contacts.map(p => ({
          value: p.id, label: p.name, words: [p.name, p.name.replace('Dr. ', ''), ...(VOCAB['rel_' + p.relation] || [])],
          speak: `${p.name}, ${t('rel_' + p.relation)}`,
          html: `<span class="avatar" style="background:${esc(p.color)}" aria-hidden="true">${esc(p.name.replace('Dr. ', '').slice(0, 1))}</span>
                 <span class="choice-text"><span class="choice-label">${esc(p.name)}</span><span class="choice-sub">${esc(t('rel_' + p.relation))}</span></span>`,
        })),
      });
      c.person = c.contacts.find(p => p.id === id);
  } },
  { id: 'confirm_call', run: async c => {
      const p = c.person;
      const r = await UI.askYesNo({
        prompt: t('call_confirm', { name: p.name, relation: t('rel_' + p.relation) }),
        extra: `<div class="call-card"><span class="avatar xl" style="background:${esc(p.color)}">${esc(p.name.replace('Dr. ', '').slice(0, 1))}</span></div>`,
      });
      if (!r.yes) throw BACK;
  } },
  { id: 'in_call', run: async c => {
      const p = c.person;
      const room = `Saathi-${App.userId}-${p.id}-${(App.user && App.user.name || 'user').replace(/\W/g, '')}`;
      const url = `https://${window.JITSI_DOMAIN}/${room}#config.prejoinPageEnabled=false&config.disableDeepLinking=true&userInfo.displayName=%22${encodeURIComponent(App.user ? App.user.name : 'Saathi')}%22`;
      UI.render(`
        <h2 class="prompt">${esc(t('calling', { name: p.name }))}</h2>
        <div class="call-frame"><iframe src="${esc(url)}" title="Video call" allow="camera; microphone; fullscreen; display-capture; autoplay"></iframe></div>
        <a class="link-tab" href="${esc(url)}" target="_blank" rel="noopener">${esc(t('call_open_tab'))} ↗</a>
        <button class="btn-endcall" id="endcall">📞 ${esc(t('end_call'))}</button>`);
      await UI.interact({
        speech: t('calling', { name: p.name }),
        setup: ctl => { document.getElementById('endcall').onclick = () => ctl.resolve(true); ctl.device = b => { if (b === 'no') ctl.resolve(true); }; },
        onVoice: () => false,
      });
      UI.stage().querySelector('iframe').src = 'about:blank';
  } },
  { id: 'complete', run: async () => {
      UI.render(`<div class="info good"><div class="big-tick" aria-hidden="true">📞</div><h2 class="prompt">${esc(t('call_ended'))}</h2></div>`);
      await say(t('call_ended'));
  } },
];

/* ======================= MESSAGE / SCAM CHECK ======================= */
const scamFlow = [
  { id: 'message', run: async c => {
      UI.render(`
        <h2 class="prompt">${esc(t('scam_ask'))}</h2>
        <textarea id="scam-text" class="bigtext" rows="5" placeholder="${esc(t('scam_placeholder'))}">${esc(App.prefill || '')}</textarea>
        <button class="btn-primary big" id="scam-go">🔍 ${esc(t('scam_check_btn'))}</button>`);
      App.prefill = null;
      c.text = await UI.interact({
        speech: t('scam_ask'),
        setup: ctl => {
          document.getElementById('scam-go').onclick = () => {
            const v = document.getElementById('scam-text').value.trim();
            if (v) ctl.resolve(v); else document.getElementById('scam-text').focus();
          };
        },
        onVoice: (alts, ctl) => {
          const box = document.getElementById('scam-text');
          box.value = (box.value ? box.value + ' ' : '') + alts[0];
          ctl.resolve(box.value);
          return true;
        },
      });
  } },
  { id: 'result', run: async c => {
      UI.loading(t('please_wait'));
      const r = await api('/api/scam/check', { text: c.text });
      if (r.level !== 'safe') logEvent('scam_warning', { level: r.level, reasons: r.reasons });
      const icon = { danger: '🛑', caution: '⚠️', safe: '✅' }[r.level];
      const msg = t('scam_' + r.level);
      await UI.info({
        title: msg, cls: 'scam-' + r.level, button: t('go_home'),
        html: `<div class="big-tick" aria-hidden="true">${icon}</div>
          ${r.reasons.length ? `<h3>${esc(t('scam_reasons'))}</h3><ul class="reasons">${r.reasons.map(k => `<li>${esc(t('r_' + k))}</li>`).join('')}</ul>` : ''}
          <blockquote class="quoted">${esc(c.text)}</blockquote>`,
        speech: msg + ' ' + r.reasons.map(k => t('r_' + k)).join('. '),
      });
  } },
  { id: 'complete', run: async () => {} },
];

/* ======================= READ A BILL / LETTER ======================= */
const DOC_KIND_ICON = { electricity: ICONS.bulb, water: ICONS.water, mobile: ICONS.mobile };
const docFlow = [
  { id: 'upload', run: async c => {
      UI.render(`
        <h2 class="prompt">${esc(t('doc_ask'))}</h2>
        <p class="hint">${esc(t('doc_hint'))}</p>
        <div class="choices list">
          <div class="choice-wrap"><button class="choice row" id="doc-cam-btn">
            <span class="choice-icon" aria-hidden="true">${ICONS.camera}</span>
            <span class="choice-text"><span class="choice-label">${esc(t('doc_photo'))}</span><span class="choice-sub">${esc(t('doc_photo_sub'))}</span></span>
            <span class="chev" aria-hidden="true">${ICONS.chevron}</span></button></div>
          <div class="choice-wrap"><button class="choice row" id="doc-file-btn">
            <span class="choice-icon" aria-hidden="true">${ICONS.doc}</span>
            <span class="choice-text"><span class="choice-label">${esc(t('doc_file'))}</span><span class="choice-sub">${esc(t('doc_file_sub'))}</span></span>
            <span class="chev" aria-hidden="true">${ICONS.chevron}</span></button></div>
        </div>
        <input type="file" id="doc-cam" accept="image/*" capture="environment" hidden>
        <input type="file" id="doc-file" accept="application/pdf,image/*" hidden>
        <details class="paste"><summary>${esc(t('doc_paste'))}</summary>
          <textarea id="doc-text" class="bigtext" rows="5" placeholder="${esc(t('scam_placeholder'))}"></textarea>
          <button class="btn-primary big" id="doc-go">${esc(t('doc_read_btn'))}</button></details>
        <div id="doc-status" class="doc-status" aria-live="polite"></div>`);
      c.result = await UI.interact({
        speech: t('doc_ask') + ' ' + t('doc_hint'),
        setup: ctl => {
          const status = document.getElementById('doc-status');
          const send = async (file, text) => {
            status.innerHTML = `<div class="spinner" aria-hidden="true"></div><p>${esc(t('doc_reading'))}</p>`;
            say(t('doc_reading'));
            const fd = new FormData();
            if (file) fd.append('file', file);
            if (text) fd.append('text', text);
            fd.append('lang', App.lang); fd.append('session_id', App.session || '');
            let r, j = {};
            try {
              r = await fetch('/api/doc/read', { method: 'POST', headers: { 'X-CSRF-Token': CSRF }, body: fd });
              j = await r.json();
            } catch (e) { j = { error: 'network' }; }
            if (r && r.status === 401) { location.href = '/login/senior?next=/app'; return; }
            if (r && r.ok) return ctl.resolve(j);
            const msg = t('doc_err_' + (j.error || 'network'));
            status.innerHTML = `<div class="warning block">⚠️ ${esc(msg)}</div>`;
            logEvent('not_understood', { heard: '', doc_error: j.error });
            say(msg);
          };
          document.getElementById('doc-cam-btn').onclick = () => document.getElementById('doc-cam').click();
          document.getElementById('doc-file-btn').onclick = () => document.getElementById('doc-file').click();
          for (const id of ['doc-cam', 'doc-file']) document.getElementById(id).onchange = e => { const f = e.target.files[0]; if (f) send(f); };
          document.getElementById('doc-go').onclick = () => { const v = document.getElementById('doc-text').value.trim(); if (v) send(null, v); };
        },
        onVoice: async () => { await say(t('doc_voice')); return true; },
      });
  } },
  { id: 'explain', run: async c => {
      const d = c.result;
      const kindName = t('doc_kind_' + d.kind);
      const due = d.due_date ? fmtDate(d.due_date) : null;
      const daysTxt = d.days_left == null ? '' : d.days_left > 1 ? t('doc_days', { n: d.days_left }) : d.days_left === 1 ? t('doc_tomorrow')
        : d.days_left === 0 ? t('doc_today') : t('doc_overdue', { n: -d.days_left });
      const lines = [];
      lines.push(d.kind === 'other' ? t('doc_from_other', { biller: d.biller || '' }) : t('doc_from', { kind: kindName, biller: d.biller || '' }));
      if (d.amount != null) lines.push(t('doc_amount', { amount: Math.round(d.amount) }));
      if (due) lines.push(t('doc_due', { due }) + ' ' + daysTxt);
      if (d.units != null) lines.push(t('doc_units', { units: d.units }));
      if (d.number) lines.push(t('doc_number', { num: spaced(d.number) }));
      if (d.scam.level !== 'safe') lines.push(t('scam_' + d.scam.level));
      if (d.amount == null && !due) lines.push(t('doc_unclear'));
      const row = (k, v) => v ? `<div class="row"><span>${esc(k)}</span><strong>${v}</strong></div>` : '';
      const dueChip = d.days_left == null ? '' : `<span class="chip ${d.days_left < 0 ? 'bad' : d.days_left <= 3 ? 'warn' : ''}">${esc(daysTxt)}</span>`;
      const card = `
        ${d.scam.level !== 'safe' ? `<div class="warning block">🛑 ${esc(t('scam_' + d.scam.level))}<ul class="reasons">${d.scam.reasons.map(k => `<li>${esc(t('r_' + k))}</li>`).join('')}</ul></div>` : ''}
        <div class="summary doc-card">
          <div class="doc-head"><span class="choice-icon" aria-hidden="true">${DOC_KIND_ICON[d.kind] || ICONS.doc}</span>
            <span><strong>${esc(kindName)}</strong><br><span class="hint">${esc(d.biller || '')}</span></span></div>
          ${row(t('lbl_amount'), d.amount != null ? '₹' + esc(Math.round(d.amount)) : '')}
          ${row(t('lbl_due'), due ? esc(due) + ' ' + dueChip : '')}
          ${row(t('lbl_consumer'), d.number ? esc(d.number) : '')}
          ${row(t('doc_lbl_units'), d.units != null ? esc(d.units) : '')}
        </div>
        <details class="paste"><summary>${esc(t('doc_show_text'))}</summary><blockquote class="quoted">${esc(d.preview)}</blockquote></details>
        <div class="doc-actions">
          <button class="btn-primary big" id="doc-again">🔁 ${esc(t('doc_again'))}</button>
          ${d.payable && d.scam.level === 'safe' ? `<button class="btn-yes" id="doc-pay">💳 ${esc(t('doc_pay'))}</button>` : ''}
          <button class="btn-cancel" id="doc-home">🏠 ${esc(t('go_home'))}</button>
        </div>`;
      UI.render(`<h2 class="prompt">${esc(t('doc_title'))}</h2>${card}`);
      const speech = lines.join(' ') + (d.payable && d.scam.level === 'safe' ? ' ' + t('doc_pay_q') : '');
      const act = await UI.interact({
        speech,
        setup: ctl => {
          document.getElementById('doc-again').onclick = () => ctl.repeat();
          const pay = document.getElementById('doc-pay');
          if (pay) pay.onclick = () => ctl.resolve('pay');
          document.getElementById('doc-home').onclick = () => ctl.resolve('home');
        },
        onVoice: async (alts, ctl) => {
          if (d.payable && d.scam.level === 'safe' && (Match.yesNo(alts) === 'yes' || Match.hasAny(alts, ['pay', 'भर', 'भुगतान', 'కట్ట', 'చెల్లించ']))) { ctl.resolve('pay'); return true; }
          if (Match.yesNo(alts) === 'no') { ctl.resolve('home'); return true; }
          return false;
        },
      });
      if (act === 'pay') { App.prefillBill = { cat: d.kind, num: d.number, amount: d.amount }; App.nextTask = 'bill'; }
  } },
  { id: 'complete', run: async () => {} },
];

/* ======================= HELP: trusted family · volunteer · fraud helpline ======================= */
function openHelpSheet(start) {
  const sheet = document.getElementById('helpsheet');
  const body = document.getElementById('hs-body');
  const tr = App.user && App.user.trusted;
  const rel = tr ? t('rel_' + tr.relation) : '';
  const row = (id, icon, label, sub, cls = '') => `<div class="choice-wrap"><button class="choice row ${cls}" id="${id}">
      <span class="choice-icon" aria-hidden="true">${icon}</span>
      <span class="choice-text"><span class="choice-label">${esc(label)}</span><span class="choice-sub">${esc(sub)}</span></span>
      <span class="chev" aria-hidden="true">${ICONS.chevron}</span></button></div>`;
  const close = () => { sheet.hidden = true; document.getElementById('btn-help').focus(); };
  const logHelp = kind => api('/api/help', { user_id: App.userId, session_id: App.session, task: App.task, step: App.step, lang: App.lang, kind }).catch(() => {});
  const room = () => `https://${window.JITSI_DOMAIN}/Saathi-help-${App.userId}-${tr ? tr.id : 0}`;

  const menu = () => {
    body.innerHTML = `<h2 id="hs-title">${ICONS.help} ${esc(t('hs_title'))}</h2><p class="hint">${esc(t('hs_hint'))}</p>
      <div class="choices list">
        ${tr ? row('hs-family', ICONS.letter(esc(tr.name.slice(0, 1)), tr.color || '#2563eb'), t('hs_family', { name: tr.name }), t('hs_family_sub', { relation: rel })) : ''}
        ${row('hs-vol', ICONS.volunteer, t('hs_volunteer'), t('hs_volunteer_sub'))}
        ${row('hs-fraud', ICONS.shield, t('hs_fraud'), t('hs_fraud_sub'), 'fraud')}
      </div>
      <button class="vclose ghost" id="hs-close">${esc(t('hs_close'))}</button>`;
    if (tr) document.getElementById('hs-family').onclick = family;
    document.getElementById('hs-vol').onclick = () => { close(); requestHelp(); };
    document.getElementById('hs-fraud').onclick = fraud;
    document.getElementById('hs-close').onclick = close;
    say(t('hs_title') + ' ' + [tr ? t('hs_family', { name: tr.name }) : '', t('hs_volunteer'), t('hs_fraud')].filter(Boolean).join(', ') + '.');
  };
  // calling family: always ask first, then phone or video
  const family = () => {
    body.innerHTML = `<h2>${esc(t('hs_confirm_call', { name: tr.name }))}</h2>
      <p class="hint">${esc(t('hs_family_sub', { relation: rel }))} · ${esc(tr.phone || '')}</p>
      <div class="call-card"><span class="avatar xl" style="background:${esc(tr.color || '#2563eb')}">${esc(tr.name.slice(0, 1))}</span></div>
      <div class="hs-actions">
        <a class="btn-yes" id="hs-phone" href="tel:${esc((tr.phone || '').replace(/[^+\d]/g, ''))}">📞 ${esc(t('hs_phone'))}</a>
        <a class="btn-primary" id="hs-video" href="${esc(room())}" target="_blank" rel="noopener">📹 ${esc(t('hs_video'))}</a>
        <button class="btn-cancel" id="hs-back">⬅ ${esc(t('back'))}</button>
      </div>`;
    const done = () => { logHelp('family'); addNote(t('hs_family_noted', { name: tr.name }), 'help'); setTimeout(close, 400); };
    document.getElementById('hs-phone').onclick = done;
    document.getElementById('hs-video').onclick = done;
    document.getElementById('hs-back').onclick = menu;
    say(t('hs_confirm_call', { name: tr.name }));
  };
  // someone may be cheating me: stop, protect, call 1930
  const fraud = () => {
    logHelp('fraud');
    addNote(t('hs_fraud_noted'), 'help');
    body.innerHTML = `<h2 class="fraud-title">🛑 ${esc(t('hs_fraud_title'))}</h2>
      <ol class="fraud-steps"><li>${esc(t('fs1'))}</li><li>${esc(t('fs2'))}</li><li>${esc(t('fs3'))}</li><li>${esc(t('fs4'))}</li></ol>
      <div class="hs-actions">
        <a class="btn-no" href="tel:1930">📞 ${esc(t('hs_call_1930'))}</a>
        ${tr ? `<button class="btn-primary" id="hs-tell">${esc(t('hs_tell', { name: tr.name }))}</button>` : ''}
        <button class="btn-cancel" id="hs-back">⬅ ${esc(t('back'))}</button>
      </div>
      <p class="hint">${esc(t('hs_portal'))}</p>`;
    if (tr) document.getElementById('hs-tell').onclick = family;
    document.getElementById('hs-back').onclick = menu;
    say([t('hs_fraud_title'), t('fs1'), t('fs2'), t('fs3'), t('fs4')].join(' '));
  };
  (start === 'family' && tr ? family : start === 'fraud' ? fraud : menu)();
  sheet.onclick = e => { if (e.target === sheet) close(); };
  sheet.hidden = false;
  const first = body.querySelector('button, a');
  if (first) first.focus();
}
document.addEventListener('click', e => { const b = e.target.closest('[data-call-trusted]'); if (b) openHelpSheet('family'); });

const FLOWS = { bill: billFlow, ticket: ticketFlow, call: callFlow, scam_check: scamFlow, doc: docFlow };

/* ======================= HOME & LANGUAGE ======================= */
async function chooseLanguage() {
  App.task = null;
  UI.progress(0);
  UI.render(`
    <h2 class="prompt">Choose your language · भाषा चुनें · భాష ఎంచుకోండి</h2>
    <div class="choices grid cols-3 langs">
      ${Object.entries(LANGS).map(([k, v]) => `<button class="choice" data-lang="${k}"><span class="choice-icon" aria-hidden="true">${{ en: 'A', hi: 'अ', te: 'అ' }[k]}</span><span class="choice-label">${v.name}</span></button>`).join('')}
    </div>`);
  const ctl = { active: true, device: null, repeat() {}, listen() {}, resolve() {}, reject() {} };
  App.current = ctl;
  return new Promise(resolve => {
    UI.stage().querySelectorAll('[data-lang]').forEach(b => b.onclick = () => {
      App.lang = b.dataset.lang; api('/api/me/language', { language: App.lang }).catch(() => {}); applySettings(); resolve();
    });
    (async () => { for (const l of ['en', 'hi', 'te']) { if (App.lang) break; await Voice.speak(STRINGS[l].choose_lang, l, 0.9); } })();
  });
}

async function homeScreen() {
  App.task = null; App.step = 'home';
  UI.progress(0);
  document.body.classList.add('on-home');
  const cards = [
    { value: 'bill', label: t('task_bill'), sub: t('task_bill_sub'), icon: ICONS.bill },
    { value: 'ticket', label: t('task_ticket'), sub: t('task_ticket_sub'), icon: ICONS.ticket },
    { value: 'call', label: t('task_call'), sub: t('task_call_sub'), icon: ICONS.video },
    { value: 'scam_check', label: t('task_scam'), sub: t('task_scam_sub'), icon: ICONS.shield },
    { value: 'doc', label: t('task_doc'), sub: t('task_doc_sub'), icon: ICONS.doc },
  ];
  const name = App.user ? App.user.name : '';
  const title = t('home_title', { hello: greetingWord(), name });
  UI.render(`
    <h2 class="prompt">${esc(title)}</h2>
    <p class="subq">${esc(t('home_q'))}</p>
    <p class="hint">${esc(Voice.supported ? t('home_hint') : t('voice_unsupported'))}</p>
    <div class="choices list home">
      ${cards.map((o, i) => `<button class="choice row task-${o.value}" data-i="${i}">
          <span class="choice-icon" aria-hidden="true">${o.icon}</span>
          <span class="choice-text"><span class="choice-label">${esc(o.label)}</span><span class="choice-sub">${esc(o.sub)}</span></span>
          <span class="chev" aria-hidden="true">${ICONS.chevron}</span></button>`).join('')}
    </div>`);
  try {
    return await UI.interact({
      speech: title + ' ' + t('home_q'),
      setup: ctl => UI.stage().querySelectorAll('.choice').forEach(b => b.onclick = () => ctl.resolve(cards[+b.dataset.i].value)),
      hint: () => cards.map(c => c.label).join(', '),
      onVoice: async (alts, ctl) => {
        // 1. the server's multilingual intent model, tried on each of the top guesses
        for (const alt of alts.slice(0, 3)) {
          let r;
          try { r = await api('/api/intent', { text: alt, lang: App.lang }); } catch (e) { break; }
          if (r.scam && r.scam.level !== 'safe') {
            await say(t('scam_heard_warning'));
            App.prefill = alt;
            ctl.resolve('scam_check'); return true;
          }
          if (r.intent === 'help') { openHelpSheet(); return true; }
          if (r.intent) { ctl.resolve(r.intent); return true; }
        }
        // 2. sound-alike matching in the browser (works across scripts, e.g. "టికెట్" ≈ "ticket")
        const m = Match.optionScored(alts, cards.map(c => ({ ...c, words: VOCAB['task_' + c.value] || [] })));
        if (m) { ctl.resolve(m.option.value); return true; }
        return false;
      },
    });
  } catch (e) { return null; }      // back/home/cancel on the home screen → just show home again
}

async function main() {
  window.JITSI_DOMAIN = document.body.dataset.jitsi || 'meet.jit.si';
  Voice.setMuted(App.settings.mute);
  Voice.onNoVoice = lang => banner(t('no_voice_lang', { lang: LANGS[lang].name }), 'info', 12000);
  applySettings();
  try { App.user = await api('/api/me'); } catch (e) { App.user = { name: document.body.dataset.userName || '', saved_billers: {} }; }
  poll();
  if (!App.lang) await chooseLanguage();
  applySettings();
  for (;;) {
    // "Pay this bill" from the document reader / "History" button set App.nextTask
    let task = App.nextTask; App.nextTask = null;
    if (!task) { task = await homeScreen(); if (!task && App.nextTask) { task = App.nextTask; App.nextTask = null; } }
    if (task === '__lang') { await chooseLanguage(); continue; }
    if (task === 'history') { await historyScreen(); continue; }
    if (task && FLOWS[task]) await runTask(task, FLOWS[task]);
  }
}

/* ======================= TOOLBAR ======================= */
function wireToolbar() {
  const $ = id => document.getElementById(id);
  $('btn-home').onclick = () => { if (App.current) App.current.reject(HOME); };
  $('btn-back').onclick = () => { if (App.current) App.current.reject(BACK); };
  $('btn-repeat').onclick = () => { if (App.current) App.current.repeat(); };
  $('btn-help').onclick = () => { $('btn-help').classList.remove('pulse'); openHelpSheet(); };
  // History: from home it opens straight away; in the middle of a task it leaves the task first
  $('btn-history').onclick = () => {
    if (App.step === 'history') return;
    App.nextTask = 'history';
    if (App.current) App.current.reject(HOME);
  };
  $('btn-bigger').onclick = () => changeSize(+0.25);
  $('btn-smaller').onclick = () => changeSize(-0.25);
  $('btn-dark').onclick = () => { App.settings.dark = !App.settings.dark; store.set('dark', App.settings.dark); applySettings(); };
  $('btn-voice').onclick = () => openVoicePanel();
  $('btn-menu').onclick = () => openMenu();
  $('btn-lang').onclick = () => { if (App.task) return; if (App.current) { App.lang = null; App.current.resolve('__lang'); } };
  $('mic').onclick = () => {
    if (!Voice.supported) { voiceProblem('unsupported'); return; }
    if (Voice.isListening()) { Voice.finish(); return; }   // tap again = I'm done, use what I said
    if (App.current && App.current.active) { Voice.stopSpeaking(); App.current.listen(); }
  };
}

document.addEventListener('DOMContentLoaded', () => { wireToolbar(); main(); });
