/* Screen building blocks used by every guided task.
   Each block speaks its question, listens once automatically, and also accepts
   taps / the hardware remote. They return a Promise with the answer. */
const BACK = 'BACK', CANCEL = 'CANCEL', HOME = 'HOME';
let turnCounter = 0;

const UI = {
  stage() { return document.getElementById('stage'); },

  render(html) {
    const s = this.stage();
    s.innerHTML = html;
    UI.addAvatar(s);
    paintIcons(s);
    window.scrollTo(0, 0);
    const h = s.querySelector('h2');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    showHeard('');
  },

  /* Put the friendly grandparent picture next to the question (like a person asking). */
  addAvatar(s) {
    const h = s.querySelector(':scope > h2.prompt');
    if (!h) return;
    const row = document.createElement('div');
    row.className = 'prompt-row';
    const text = document.createElement('div');
    text.className = 'prompt-text';
    h.before(row);
    text.appendChild(h);
    while (row.nextElementSibling && row.nextElementSibling.matches('.subq, .hint:not(.read-tip)')) text.appendChild(row.nextElementSibling);
    row.appendChild(text);
    const pic = document.createElement('span');
    pic.className = 'avatar-pic';
    pic.innerHTML = AVATARS[document.body.dataset.avatar] || AVATARS.grandpa;
    row.appendChild(pic);
  },

  progress(i, total) {
    const p = document.getElementById('progress');
    if (!total) { p.hidden = true; return; }
    p.hidden = false;
    p.querySelector('.progress-text').textContent = t('step_of', { n: i, total });
    p.querySelector('.progress-fill').style.width = Math.round(100 * i / total) + '%';
  },

  /* Core loop: speak → listen → match → (retry | answer). */
  /* The microphone NEVER switches on by itself — it only listens after the user
     taps the mic button (or presses SPEAK on the ESP32 remote). */
  interact({ speech, onVoice, setup, hint }) {
    const myTurn = ++turnCounter;
    return new Promise((resolve, reject) => {
      let done = false;
      const ctl = {
        retries: 0,
        hint,                                   // what to suggest after a failed try, e.g. the option names
        get active() { return !done && myTurn === turnCounter; },
        resolve(v) { if (done) return; done = true; Voice.stop(); Voice.stopSpeaking(); Mic.idle(); resolve(v); },
        reject(e) { if (done) return; done = true; Voice.stop(); Voice.stopSpeaking(); Mic.idle(); reject(e); },
        device: null,
        async repeat() { if (!ctl.active) return; await say(speech); },   // mic stays off until the user taps it
        async listen() {
          if (!ctl.active) return;
          if (!Voice.supported) { await voiceProblem('unsupported'); return; }
          Mic.listening();
          let alts;
          try {
            alts = await Voice.listen(App.lang, { onInterim: txt => showHeard(txt, true) });
          } catch (err) {
            Mic.idle();
            if (ctl.active && err !== 'aborted') await voiceProblem(err);
            return;
          }
          Mic.idle();
          if (!ctl.active || !alts.length) return;
          showHeard(alts[0]);
          const cmd = Match.command(alts);
          if (cmd) return UI.globalCommand(cmd, ctl);
          const handled = await onVoice(alts, ctl);
          if (handled || !ctl.active) return;
          ctl.retries++;
          logEvent('not_understood', { heard: alts[0], alts: alts.slice(0, 3), retry: ctl.retries });
          if (ctl.retries >= 3) {
            if (ctl.retries === 3) logEvent('stuck', { heard: alts[0] });
            document.getElementById('btn-help').classList.add('pulse');
            await say(t('still_stuck'));
          } else {
            // tell the user what was heard and what they can say
            const h = typeof ctl.hint === 'function' ? ctl.hint() : ctl.hint;
            const next = !h ? t('not_understood') : (h.sentence ? h.sentence : t('say_one_of', { list: h }));
            await say(t('heard_prefix', { heard: alts[0] }) + ' ' + next);
          }
        },
      };
      App.current = ctl;
      if (setup) setup(ctl);
      (async () => {
        await say(speech);
      })();
    });
  },

  globalCommand(cmd, ctl) {
    if (cmd === 'back') ctl.reject(BACK);
    else if (cmd === 'cancel') ctl.reject(CANCEL);
    else if (cmd === 'home') ctl.reject(HOME);
    else if (cmd === 'repeat') ctl.repeat();
    else if (cmd === 'help') openHelpSheet();
  },

  /* Big option buttons. options: [{value, label, sub, icon, words, html, speak, meta}]
     Voice understanding on this screen, in English / Hindi / Telugu:
       • "Electricity", "బిజ్లీ", "option 2", "दूसरा"     → choose it
       • "read option 2", "दूसरा बताओ", "రెండో ఎంపిక చెప్పండి" → read ONLY that option aloud
       • "one by one", "एक-एक करके", "ఒక్కొక్కటిగా"       → read one at a time, ask yes / next
       • "the cheapest", "सुबह वाली", "సాయంత్రం బస్సు"     → smart pick (options with meta), then confirm
       • unclear / close-sounding word                    → "Did you mean …?" before choosing
     Every option also has a 🔊 button to hear just that one. */
  choose({ prompt, extra = '', speech, options, cols = 2, cls = '', tip }) {
    const showTip = (tip ?? options.length >= 3) && Voice.supported;
    // big list rows (icon · text · ›) for most questions; tiles only for long lists of short words (cities, languages)
    const grid = /\b(cities|langs)\b/.test(cls);
    this.render(`
      <h2 class="prompt">${esc(prompt)}</h2>
      ${extra}
      <div class="assist" id="assist" role="status" hidden></div>
      <div class="choices ${grid ? 'grid cols-' + cols : 'list'} ${cls}">
        ${options.map((o, i) => `
          <div class="choice-wrap" data-w="${i}">
            <button class="choice${grid ? '' : ' row'}" data-i="${i}">
              ${o.icon ? `<span class="choice-icon" aria-hidden="true">${o.icon}</span>` : ''}
              ${o.html ? o.html : `<span class="choice-text"><span class="choice-label">${esc(o.label)}</span>${o.sub ? `<span class="choice-sub">${esc(o.sub)}</span>` : ''}</span>`}
              ${grid ? '' : `<span class="chev" aria-hidden="true">${ICONS.chevron}</span>`}
            </button>
            <button class="opt-speak" data-speak="${i}" aria-label="${esc(t('hear_option'))}: ${esc(o.label)}" title="${esc(t('hear_option'))}">${ICONS.speaker}</button>
          </div>`).join('')}
      </div>
      ${showTip ? `<p class="hint read-tip">💡 ${esc(t('read_tip'))}</p>` : ''}`);
    const stage = this.stage();
    const wraps = [...stage.querySelectorAll('.choice-wrap')];
    const optText = i => (options[i].speak || [options[i].label, options[i].sub].filter(Boolean).join(', ')).replace(/[.।\s]+$/, '');
    const readOne = async i => {
      wraps.forEach((w, k) => w.classList.toggle('reading', k === i));
      wraps[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      await say(t('option_n', { i: i + 1 }) + ': ' + optText(i) + '.');
      wraps[i].classList.remove('reading');
    };
    let focus = -1, mode = null;        // mode: 'obo' (one by one) | 'guess' (did you mean) | 'smart'

    return this.interact({
      speech: speech || prompt,
      hint: () => options.slice(0, 4).map(o => o.label).join(', '),
      setup: ctl => {
        const assist = document.getElementById('assist');
        const setFocus = (i, msg) => {
          focus = i;
          wraps.forEach((w, k) => w.classList.toggle('focus', k === i));
          if (i < 0) { assist.hidden = true; mode = null; return; }
          assist.hidden = false;
          assist.innerHTML = `<p>${esc(msg)}</p><div class="assist-btns">
            <button class="assist-yes" data-a="yes">✔ ${esc(t('obo_choose'))}</button>
            <button class="assist-next" data-a="next">${esc(t('obo_next'))} ▶</button></div>`;
          wraps[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        };
        ctl.offer = async (i, msg, m) => { mode = m; setFocus(i, msg); await say(msg); };
        ctl.oneByOne = i => ctl.offer(i, t('obo_ask', { i: i + 1, text: optText(i) }), 'obo');
        ctl.next = async () => {
          let n = focus + 1;
          if (n >= options.length) { await say(t('obo_last')); n = 0; }
          return ctl.oneByOne(n);
        };
        ctl.choose = i => { this.flash(i); App.ack = ackFor(options[i].label.replace(/\s*\(.*\)$/, '')); ctl.resolve(options[i].value); };
        ctl.clearFocus = () => setFocus(-1);
        assist.addEventListener('click', e => {
          const a = e.target.closest('[data-a]');
          if (!a || focus < 0) return;
          if (a.dataset.a === 'yes') ctl.choose(focus); else ctl.next();
        });
        stage.querySelectorAll('.choice').forEach(btn => btn.addEventListener('click', () => ctl.choose(+btn.dataset.i)));
        stage.querySelectorAll('.opt-speak').forEach(b => b.addEventListener('click', e => {
          e.stopPropagation();
          logEvent('voice_assist', { kind: 'speaker_button', option: +b.dataset.speak + 1 });
          readOne(+b.dataset.speak);
        }));
        ctl.device = b => {          // ESP32 remote: YES chooses the highlighted option, NO moves to the next
          if (b === 'yes' && focus >= 0) ctl.choose(focus);
          if (b === 'no') ctl.next();
        };
      },
      onVoice: async (alts, ctl) => {
        // 1. answering "Do you want this one?" / "Did you mean …?"
        if (focus >= 0) {
          const yn = Match.yesNo(alts);
          if (yn === 'yes') { ctl.choose(focus); return true; }
          if (Match.wantsNext(alts) || (yn === 'no' && mode !== 'guess')) { await ctl.next(); return true; }
          if (yn === 'no') { ctl.clearFocus(); await say(t('try_again_choose')); return true; }
        }
        // 2. "one by one"  (also "next" before anything is highlighted)
        if (Match.wantsOneByOne(alts) || (focus < 0 && Match.wantsNext(alts))) {
          logEvent('voice_assist', { kind: 'one_by_one' });
          await ctl.oneByOne(0); return true;
        }
        // 3. "read option 2" → read only that option, do not choose it
        const r = Match.readRequest(alts, options);
        if (r >= 0) {
          logEvent('voice_assist', { kind: 'read_option', option: r + 1 });
          await readOne(r); return true;
        }
        // 4. "the cheapest", "the morning one" …
        const sp = Match.smartPick(alts, options);
        if (sp) {
          logEvent('voice_assist', { kind: 'smart_' + sp.kind });
          if (sp.index < 0) { await say(t('smart_none', { what: t('w_' + sp.kind) })); return true; }
          await ctl.offer(sp.index, t('smart_found', { what: t('w_' + sp.kind), i: sp.index + 1, text: optText(sp.index) }), 'smart');
          return true;
        }
        // 5. a normal answer — clear → choose; only close-sounding → ask first
        const m = Match.optionScored(alts, options);
        if (m && m.strength === 'strong') { ctl.choose(m.index); return true; }
        if (m) {
          logEvent('voice_assist', { kind: 'did_you_mean' });
          await ctl.offer(m.index, t('did_you_mean', { x: m.option.label }), 'guess'); return true;
        }
        return false;
      },
    });
  },

  flash(i) {
    const b = this.stage().querySelector(`.choice[data-i="${i}"]`);
    if (b) b.classList.add('chosen');
  },

  /* Yes / No question. Returns {yes: bool, byVoice: bool} */
  askYesNo({ prompt, extra = '', speech, yesLabel, noLabel }) {
    this.render(`
      <h2 class="prompt">${esc(prompt)}</h2>
      ${extra}
      <div class="yesno">
        <button class="btn-yes" id="yn-yes"><span aria-hidden="true">✔</span> ${esc(yesLabel || t('yes'))}</button>
        <button class="btn-no" id="yn-no"><span aria-hidden="true">✖</span> ${esc(noLabel || t('no'))}</button>
      </div>`);
    return this.interact({
      speech: speech || prompt,
      hint: () => `${yesLabel || t('yes')}, ${noLabel || t('no')}`,
      setup: ctl => {
        document.getElementById('yn-yes').onclick = () => { App.ack = ackFor(); ctl.resolve({ yes: true, byVoice: false }); };
        document.getElementById('yn-no').onclick = () => ctl.resolve({ yes: false, byVoice: false });
        ctl.device = b => { if (b === 'yes') ctl.resolve({ yes: true, byVoice: false }); if (b === 'no') ctl.resolve({ yes: false, byVoice: false }); };
      },
      onVoice: (alts, ctl) => {
        const a = Match.yesNo(alts);
        if (a) { if (a === 'yes') App.ack = ackFor(); ctl.resolve({ yes: a === 'yes', byVoice: true }); return true; }
        return false;
      },
    });
  },

  /* Number entry: say the digits or use the big keypad. */
  askNumber({ prompt, minLen, maxLen }) {
    this.render(`
      <h2 class="prompt">${esc(prompt)}</h2>
      <div class="numdisplay" id="numdisplay" aria-live="polite"></div>
      <p class="hint" id="numhint">${esc(t('num_need', { min: minLen, max: maxLen }))}</p>
      <div class="keypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="key" data-k="${n}">${n}</button>`).join('')}
        <button class="key key-del" data-k="del" aria-label="Delete">⌫</button>
        <button class="key" data-k="0">0</button>
        <button class="key key-ok" data-k="ok" aria-label="${esc(t('next'))}">✔</button>
      </div>`);
    let value = '';
    const show = () => { document.getElementById('numdisplay').textContent = value ? value.replace(/(\d{4})(?=\d)/g, '$1 ') : '—'; };
    show();
    const valid = v => v.length >= minLen && v.length <= maxLen;
    return this.interact({
      speech: prompt,
      hint: () => ({ sentence: t('digits_hint') }),
      setup: ctl => {
        this.stage().querySelectorAll('.key').forEach(k => k.addEventListener('click', () => {
          const key = k.dataset.k;
          if (key === 'del') value = value.slice(0, -1);
          else if (key === 'ok') {
            if (valid(value)) return ctl.resolve(value);
            say(t('num_invalid'));
            document.getElementById('numhint').classList.add('warn');
            return;
          } else if (value.length < maxLen) value += key;
          show();
        }));
        ctl.device = b => { if (b === 'yes' && valid(value)) ctl.resolve(value); };
      },
      onVoice: async (alts, ctl) => {
        const nums = Match.digits(alts).filter(Boolean);
        const good = nums.find(valid);
        if (good) { value = good; show(); ctl.resolve(good); return true; }
        if (nums.length) {
          value = nums[0].slice(0, maxLen); show();
          logEvent('not_understood', { heard: alts[0], reason: 'digits_' + nums[0].length });
          await say(t('num_invalid'));
          return true;
        }
        return false;
      },
    });
  },

  loading(text) {
    this.render(`<div class="loading"><div class="spinner" aria-hidden="true"></div><h2 class="prompt">${esc(text)}</h2></div>`);
    say(text);
  },

  /* A message with a single big button (e.g. errors, results). */
  info({ title, html = '', speech, button, cls = '' }) {
    this.render(`<div class="info ${cls}"><h2 class="prompt">${esc(title)}</h2>${html}
      <button class="btn-primary big" id="info-ok">${esc(button || t('ok'))}</button></div>`);
    return this.interact({
      speech: speech || title,
      setup: ctl => {
        document.getElementById('info-ok').onclick = () => ctl.resolve(true);
        ctl.device = b => { if (b === 'yes') ctl.resolve(true); };
      },
      onVoice: (alts, ctl) => {
        if (Match.yesNo(alts) === 'yes' || Match.anyOf(alts, [t('ok'), 'ok', 'next', 'home', 'हो गया', 'సరే'])) { ctl.resolve(true); return true; }
        return false;
      },
    });
  },

  /* ---------- SAFE CONFIRMATION before any payment ----------
     1. prepare on server → safety warnings
     2. read the summary aloud → "Yes" (voice or tap)
     3. press-and-hold the green button for 2 s (stops accidental taps / tremor)
     4. 5-second countdown with a big CANCEL
     5. server confirms only if 2 + 3 both happened */
  async confirmAndPay({ type, payee, amount, purpose, account, details }) {
    UI.loading(t('please_wait'));
    let prep;
    try { prep = await api('/api/action/prepare', { user_id: App.userId, type, payee, amount, details }); }
    catch (e) { await UI.info({ title: t('pay_failed'), cls: 'bad' }); throw CANCEL; }

    const warnHtml = prep.warnings.map(w => {
      logEvent('payment_warning', { key: w.key });
      return `<div class="warning ${w.blocking ? 'block' : ''}"><span aria-hidden="true">⚠️</span> ${esc(t('warn_' + w.key, { payee, limit: w.limit, usual: w.usual }))}</div>`;
    }).join('');
    const summary = `
      <div class="summary">
        <div class="row"><span>${esc(t('lbl_pay_to'))}</span><strong>${esc(payee)}</strong></div>
        <div class="row"><span>${esc(t('lbl_for'))}</span><strong>${esc(purpose)}</strong></div>
        ${account ? `<div class="row"><span>${esc(t('lbl_account'))}</span><strong>${esc(account)}</strong></div>` : ''}
        <div class="row amount"><span>${esc(t('lbl_amount'))}</span><strong>₹${amount}</strong></div>
      </div>
      ${warnHtml}
      <p class="tip">🔒 ${esc(t('safety_tip'))}</p>`;

    const cancelOut = async (at = 'confirm') => {
      api('/api/action/cancel', { pending_id: prep.pending_id, stage: at }).catch(() => {});
      logEvent('cancel', { at });
      await UI.info({ title: t('cancelled'), button: t('go_home') });
      throw HOME;
    };

    if (prep.blocked) {
      const tr = App.user && App.user.trusted;
      await UI.info({ title: t('blocked_limit'), cls: 'bad', button: t('go_home'),
        html: summary + (tr ? `<button class="btn-primary big" data-call-trusted>📞 ${esc(t('hs_family', { name: tr.name }))}</button>` : '') });
      throw HOME;
    }

    // The payment goes through stages. BACK on any stage returns to the stage before it
    // (BACK on the first one goes to the previous task step); CANCEL / HOME cancels the payment.
    //   yes  → spoken or tapped YES on the summary
    //   hold → press and hold the green button for 2 s
    //   pin  → 4-digit PIN, only for payments of ₹1,000 or more (security)
    //   count→ 5-second countdown with a big CANCEL
    const warnSpeech = prep.warnings.map(w => t('warn_' + w.key, { payee, limit: w.limit, usual: w.usual })).join(' ');
    let stage = 'yes', first = null, pin = '', triesLeft = null;
    for (;;) {
      if (stage === 'yes') {
        try {
          first = await UI.askYesNo({
            prompt: t('confirm_title'), extra: summary,
            speech: t('confirm_say', { amount, payee, purpose }) + ' ' + warnSpeech,
          });
        } catch (e) { api('/api/action/cancel', { pending_id: prep.pending_id, stage: 'confirm', reason: e === BACK ? 'left' : '' }).catch(() => {}); throw e; }
        if (!first.yes) return cancelOut();
        stage = 'hold'; continue;
      }
      if (stage === 'hold') {
        try { await UI.hold(amount, summary); stage = prep.pin_required ? 'pin' : 'count'; }
        catch (e) { if (e === BACK) { stage = 'yes'; continue; } if (e === CANCEL || e === HOME) return cancelOut('hold'); throw e; }
        continue;
      }
      if (stage === 'pin') {
        try { pin = await UI.askPin({ amount, triesLeft }); stage = 'count'; }
        catch (e) { if (e === BACK) { stage = 'hold'; continue; } if (e === CANCEL || e === HOME) return cancelOut('pin'); throw e; }
        continue;
      }
      // stage 'count'
      const go = await UI.countdown(5);
      if (go === 'back') { stage = prep.pin_required ? 'pin' : 'hold'; continue; }
      if (!go) return cancelOut('countdown');
      try {
        return await api('/api/action/confirm', { pending_id: prep.pending_id, first_confirm: true, hold_confirm: true, voice: first.byVoice, pin });
      } catch (e) {
        const err = e.data && e.data.error;
        if (err === 'wrong_pin') { triesLeft = e.data.tries_left; stage = 'pin'; continue; }
        if (err === 'pin_blocked') { await UI.info({ title: t('pin_blocked'), cls: 'bad', button: t('go_home') }); throw HOME; }
        if (err === 'needs_family_approval') { await UI.info({ title: t('blocked_limit'), cls: 'bad', button: t('go_home') }); throw HOME; }
        await UI.info({ title: t('pay_failed'), cls: 'bad' });
        throw HOME;
      }
    }
  },

  /* 4-digit PIN for bigger payments. Typed only — never spoken aloud. */
  askPin({ amount, triesLeft }) {
    this.render(`
      <h2 class="prompt">🔒 ${esc(t('pin_ask', { amount }))}</h2>
      ${triesLeft != null ? `<div class="warning block">⚠️ ${esc(t('pin_wrong', { n: triesLeft }))}</div>` : ''}
      <div class="pin-dots" id="pin-dots" aria-live="polite">${'<span></span>'.repeat(4)}</div>
      <p class="hint">${esc(t('pin_hint'))}</p>
      <div class="keypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="key" data-k="${n}">${n}</button>`).join('')}
        <button class="key key-del" data-k="del" aria-label="Delete">⌫</button>
        <button class="key" data-k="0">0</button>
        <button class="key key-ok" data-k="ok" aria-label="${esc(t('next'))}">✔</button>
      </div>`);
    let value = '';
    const paint = () => document.querySelectorAll('#pin-dots span').forEach((d, i) => d.classList.toggle('on', i < value.length));
    return this.interact({
      speech: (triesLeft != null ? t('pin_wrong', { n: triesLeft }) + ' ' : '') + t('pin_ask', { amount }),
      setup: ctl => {
        this.stage().querySelectorAll('.key').forEach(k => k.addEventListener('click', () => {
          const key = k.dataset.k;
          if (key === 'del') value = value.slice(0, -1);
          else if (key === 'ok') { if (value.length === 4) return ctl.resolve(value); }
          else if (value.length < 4) value += key;
          paint();
          if (value.length === 4) setTimeout(() => ctl.resolve(value), 250);
        }));
      },
      onVoice: async () => { await say(t('pin_no_voice')); return true; },   // never accept a PIN by voice
    });
  },

  hold(amount, summary) {
    this.render(`
      <h2 class="prompt">${esc(t('hold_to_pay'))}</h2>
      ${summary}
      <button class="hold" id="hold"><span class="hold-fill"></span><span class="hold-text">${esc(t('hold_btn', { amount }))}</span></button>
      <button class="btn-cancel" id="hold-cancel">✖ ${esc(t('cancel'))}</button>`);
    const HOLD_MS = 2000;
    return this.interact({
      speech: t('hold_to_pay'),
      setup: ctl => {
        const btn = document.getElementById('hold');
        const fill = btn.querySelector('.hold-fill');
        const label = btn.querySelector('.hold-text');
        let start = 0, raf = 0;
        const tick = () => {
          const p = Math.min(1, (performance.now() - start) / HOLD_MS);
          fill.style.width = (p * 100) + '%';
          if (p >= 1) { btn.classList.add('full'); ctl.resolve(true); return; }
          raf = requestAnimationFrame(tick);
        };
        const down = e => { e.preventDefault(); if (start) return; start = performance.now(); btn.classList.add('holding'); label.textContent = t('hold_keep'); raf = requestAnimationFrame(tick); };
        const up = () => { if (!ctl.active) return; cancelAnimationFrame(raf); start = 0; btn.classList.remove('holding'); fill.style.width = '0%'; label.textContent = t('hold_btn', { amount }); };
        btn.addEventListener('pointerdown', down);
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, up));
        btn.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) down(e); });
        btn.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') up(); });
        btn.addEventListener('contextmenu', e => e.preventDefault());
        document.getElementById('hold-cancel').onclick = () => ctl.reject(CANCEL);
        ctl.device = b => { if (b === 'yes') ctl.resolve(true); if (b === 'no') ctl.reject(CANCEL); };   // hardware YES = physical hold
      },
      onVoice: () => false,
    });
  },

  countdown(seconds) {
    this.render(`
      <div class="countdown">
        <div class="count" id="count" aria-live="assertive">${seconds}</div>
        <h2 class="prompt" id="count-text">${esc(t('countdown', { n: seconds }))}</h2>
        <button class="btn-cancel huge" id="cd-cancel">✖ ${esc(t('cancel'))}</button>
      </div>`);
    return new Promise(resolve => {
      let n = seconds, finished = false;
      const end = v => { if (finished) return; finished = true; clearInterval(iv); Voice.stop(); resolve(v); };
      const ctl = { device: b => { if (b === 'no') end(false); }, get active() { return !finished; }, resolve: () => end(false), reject: e => end(e === BACK ? 'back' : false), repeat() {}, listen() {} };
      App.current = ctl;
      turnCounter++;
      document.getElementById('cd-cancel').onclick = () => end(false);
      say(t('countdown', { n: seconds }));
      const iv = setInterval(() => {
        n--;
        if (n <= 0) return end(true);
        document.getElementById('count').textContent = n;
        document.getElementById('count-text').textContent = t('countdown', { n });
      }, 1000);
    });
  },

  done({ title, lines, speech }) {
    return this.info({
      title: title || t('done_title'),
      cls: 'good',
      html: `<div class="big-tick" aria-hidden="true">✅</div><div class="summary">${lines.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}</div>`,
      speech,
      button: t('go_home'),
    });
  },
};
