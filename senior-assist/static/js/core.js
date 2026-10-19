/* App state, settings, translation, API calls, event logging, help button,
   hardware/volunteer polling and voice-matching helpers. */
const store = {
  get(k, d) { try { const v = localStorage.getItem('saathi_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('saathi_' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};

const App = {
  userId: parseInt(document.body.dataset.userId, 10),     // the logged-in senior (set by the server)
  user: null,
  lang: document.body.dataset.lang || null,                // saved per user on the server
  settings: {
    size: store.get('size', 1.25),
    dark: store.get('dark', !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)),   // follows the device the first time
    slow: store.get('slow', true),
    mute: store.get('mute', false),
  },
  task: null,          // current task id (bill/ticket/call/scam_check) or null on home
  step: null,          // current step id
  session: null,       // session id of the current task run
  current: null,       // the interaction currently waiting for input (see ui.js)
  lastDevice: -1,     // -1 = first poll (learn latest id, do not replay old presses)
};

/* ---------- translation ---------- */
function t(key, vars) {
  let s = (STRINGS[App.lang || 'en'] || STRINGS.en)[key];
  if (s === undefined) s = STRINGS.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(v);
  return s;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function say(text) {
  // a short friendly "okay" for the last answer is added in front of the next question
  if (App.ack) { text = App.ack + ' ' + text; App.ack = null; }
  return Voice.speak(text, App.lang, App.settings.slow ? 0.88 : 1.0);
}

/* a short, varied "okay" so Saathi sounds like a person, not a machine: "సరే అండీ, కరెంట్." */
function ackFor(label) {
  const oks = t('acks').split('|');
  const ok = oks[Math.floor(Math.random() * oks.length)];
  return label ? t('ack_with', { ok, x: label }) : ok + (App.lang === 'hi' ? '।' : '.');
}
function greetingWord() {
  const h = new Date().getHours();
  return t(h < 12 ? 'greet_morning' : h < 17 ? 'greet_afternoon' : 'greet_evening');
}

/* ---------- 🗣️ voice settings panel ---------- */
function openVoicePanel() {
  const panel = document.getElementById('vpanel');
  const paint = () => {
    document.getElementById('vp-on').setAttribute('aria-pressed', !App.settings.mute);
    document.getElementById('vp-off').setAttribute('aria-pressed', !!App.settings.mute);
    document.getElementById('btn-slow').setAttribute('aria-pressed', !!App.settings.slow);
    document.getElementById('vp-normal').setAttribute('aria-pressed', !App.settings.slow);
    const list = Voice.voicesFor(App.lang);
    const cur = Voice.voiceFor(App.lang);
    const box = document.getElementById('vp-list');
    box.innerHTML = list.slice(0, 8).map((v, i) => `
      <button class="vitem ${cur && v.name === cur.name ? 'sel' : ''}" data-name="${esc(v.name)}">
        <span class="vname">${esc(v.name)}</span>
        <span class="vtag">${esc(v.lang)}${i === 0 ? ' · ' + esc(t('vp_best')) : ''}</span><span aria-hidden="true">▶</span>
      </button>`).join('');
    const none = document.getElementById('vp-none');
    none.hidden = list.length > 0;
    none.textContent = t('no_voice_lang', { lang: LANGS[App.lang].name });
    box.querySelectorAll('.vitem').forEach(b => b.onclick = () => {
      Voice.setVoice(App.lang, b.dataset.name); paint();
      const wasMuted = App.settings.mute; Voice.setMuted(false);
      Voice.speak(t('vp_sample', { name: App.user ? App.user.name : '' }), App.lang, App.settings.slow ? 0.88 : 1.0)
        .then(() => Voice.setMuted(wasMuted));
    });
  };
  const setMute = m => { App.settings.mute = m; store.set('mute', m); Voice.setMuted(m); paint(); };
  document.getElementById('vp-on').onclick = () => { setMute(false); say(t('vp_on_said')); };
  document.getElementById('vp-off').onclick = () => setMute(true);
  document.getElementById('btn-slow').onclick = () => { App.settings.slow = true; store.set('slow', true); paint(); say(t('vp_sample', { name: App.user ? App.user.name : '' })); };
  document.getElementById('vp-normal').onclick = () => { App.settings.slow = false; store.set('slow', false); paint(); say(t('vp_sample', { name: App.user ? App.user.name : '' })); };
  document.getElementById('vp-close').onclick = () => { panel.hidden = true; document.getElementById('btn-voice').focus(); };
  panel.onclick = e => { if (e.target === panel) panel.hidden = true; };
  Voice.refreshVoices();
  paint();
  panel.hidden = false;
  document.getElementById('vp-close').focus();
}
function spaced(num) { return String(num).split('').join(' '); }
function fmtDate(iso) {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString(LANGS[App.lang].code, { day: 'numeric', month: 'long' }); }
  catch (e) { return iso; }
}
function cityName(id) { const c = CITY_LIST.find(c => c.id === id); return c ? (c[App.lang] || c.en) : id; }

/* ---------- server ---------- */
// security token sent with every change request (stops other websites from acting as the user)
const CSRF = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
async function api(path, data) {
  const opt = data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF }, body: JSON.stringify(data) };
  const r = await fetch(path, opt);
  let j = null;
  try { j = await r.json(); } catch (e) { /* empty */ }
  if (r.status === 401) { window.location.href = '/login/senior?next=/app'; throw new Error('login_required'); }
  if (!r.ok) { const err = new Error((j && j.error) || r.statusText); err.data = j; err.status = r.status; throw err; }
  return j;
}

function logEvent(event, detail) {
  if (!App.session && event !== 'help') return;
  const payload = { session_id: App.session, user_id: App.userId, task: App.task, step: App.step, event, detail, lang: App.lang };
  fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF }, body: JSON.stringify(payload), keepalive: true }).catch(() => {});
}

/* If the page is closed in the middle of a task, record where the user left. */
window.addEventListener('pagehide', () => {
  if (App.session && App.task && App.step !== 'complete') {
    const payload = { session_id: App.session, user_id: App.userId, task: App.task, step: App.step, event: 'abandon', lang: App.lang, _csrf: CSRF };
    try { navigator.sendBeacon('/api/log', JSON.stringify(payload)); } catch (e) { /* ignore */ }
  }
});

/* ---------- settings ---------- */
function applySettings() {
  document.documentElement.style.setProperty('--scale', App.settings.size);
  document.body.classList.toggle('dark', !!App.settings.dark);
  document.documentElement.lang = App.lang || 'en';
  const b = id => document.getElementById(id);
  if (b('btn-dark')) b('btn-dark').setAttribute('aria-pressed', App.settings.dark);
  translateChrome();
}
function translateChrome() {
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
  const md = document.getElementById('main-date');
  if (md) { try { md.textContent = new Date().toLocaleDateString(LANGS[App.lang].code, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { md.textContent = ''; } }
  paintIcons(document);
  Mic.idle();
}
/* <span class="ico" data-icon="home"></span> → the SVG icon */
function paintIcons(root) {
  if (typeof ICONS === 'undefined') return;
  root.querySelectorAll('[data-icon]').forEach(el => {
    if (el.dataset.painted) return;
    const svg = ICONS[el.dataset.icon];
    if (typeof svg === 'string') { el.innerHTML = svg; el.dataset.painted = '1'; }
  });
}

/* ---------- 🔔 messages (volunteer hints, help requests) ---------- */
App.notes = [];
function addNote(text, kind) {
  App.notes.unshift({ text, kind, time: new Date() });
  App.notes = App.notes.slice(0, 20);
  const dot = document.getElementById('bell-dot');
  if (dot) dot.hidden = false;
}
function openMenu() {
  const panel = document.getElementById('menu');
  const list = document.getElementById('notes');
  const time = d => d.toLocaleTimeString(LANGS[App.lang || 'en'].code, { hour: 'numeric', minute: '2-digit' });
  list.innerHTML = App.notes.length
    ? App.notes.map(n => `<div class="note ${n.kind}">${esc(n.text)}<small>${esc(time(n.time))}</small></div>`).join('')
    : `<p class="empty">${esc(t('no_notes'))}</p>`;
  document.getElementById('bell-dot').hidden = true;
  document.getElementById('menu-close').onclick = () => { panel.hidden = true; document.getElementById('btn-menu').focus(); };
  panel.onclick = e => { if (e.target === panel) panel.hidden = true; };
  panel.hidden = false;
  document.getElementById('menu-close').focus();
}
function changeSize(delta) {
  App.settings.size = Math.min(2, Math.max(1, Math.round((App.settings.size + delta) * 100) / 100));
  store.set('size', App.settings.size); applySettings();
}

/* ---------- microphone button state ---------- */
const Mic = {
  el() { return document.getElementById('mic'); },
  idle() { const m = this.el(); if (!m) return; m.classList.remove('listening'); m.querySelector('.mic-label').textContent = Voice.supported ? t('mic_tap') : t('mic_off'); },
  listening() { const m = this.el(); if (!m) return; m.classList.add('listening'); m.querySelector('.mic-label').textContent = t('mic_listening'); },
};
function showHeard(text, live) {
  const h = document.getElementById('heard');
  if (!h) return;
  h.classList.toggle('live', !!live);
  h.innerHTML = text ? `<span>${esc(live ? t('hearing') : t('you_said'))}:</span> “${esc(text)}”` : '';
}

/* Explain WHY voice did not work, in the user's language, with the fix. */
const VOICE_ERRORS = {
  'not-allowed': 'err_mic_blocked', 'service-not-allowed': 'err_mic_blocked', 'audio-capture': 'err_no_mic',
  'network': 'err_network', 'language-not-supported': 'err_lang', 'unsupported': 'voice_unsupported',
  'insecure': 'err_insecure', 'no-speech': 'err_no_speech', 'start-failed': 'err_no_speech', 'error': 'err_no_speech',
};
async function voiceProblem(code) {
  const key = VOICE_ERRORS[code] || 'err_no_speech';
  logEvent('not_understood', { heard: '', voice_error: code });
  const serious = key !== 'err_no_speech';
  banner(t(key), serious ? 'error' : 'info', serious ? 25000 : 7000, serious ? { href: '/voice-check', label: t('voice_check') } : null);
  await say(t(key));
}

/* ---------- help / SOS ---------- */
async function requestHelp() {
  try { await api('/api/help', { user_id: App.userId, session_id: App.session, task: App.task, step: App.step, lang: App.lang }); } catch (e) { /* offline */ }
  banner(t('help_sent'), 'help');
  addNote(t('help_sent'), 'help');
  await say(t('help_sent'));
}
function banner(text, kind = 'info', ms = 9000, link) {
  const b = document.getElementById('banner');
  b.className = 'banner show ' + kind;
  b.innerHTML = `<p>${esc(text)}${link ? ` <a class="banner-link" href="${esc(link.href)}" target="_blank" rel="noopener">${esc(link.label)} ↗</a>` : ''}</p><button class="banner-close" aria-label="${esc(t('ok'))}">${esc(t('ok'))}</button>`;
  b.querySelector('button').onclick = () => b.classList.remove('show');
  clearTimeout(banner._t);
  banner._t = setTimeout(() => b.classList.remove('show'), ms);
}

/* ---------- polling: ESP32 help-remote buttons + volunteer hints ---------- */
async function poll() {
  try {
    const r = await api(`/api/poll?user_id=${App.userId}&after=${App.lastDevice}`);
    App.lastDevice = r.last_id;
    for (const b of r.buttons) onDeviceButton(b);
    for (const h of r.hints) { banner(`${t('volunteer_says')}: ${h}`, 'hint', 15000); addNote(`${t('volunteer_says')}: ${h}`, 'hint'); await say(h); }
  } catch (e) { /* server not reachable — try again later */ }
  setTimeout(poll, 1500);
}
function onDeviceButton(btn) {
  if (btn === 'sos') { requestHelp(); return openHelpSheet(); }   // SOS: alert a volunteer AND show the help choices
  if (btn === 'speak') return document.getElementById('mic').click();
  if (App.current && App.current.device) App.current.device(btn);
}

/* ---------- sound-alike matching across scripts ----------
   Speech engines often write the same word in different scripts or spellings:
   "current" / "కరెంట్" / "करंट", "water" / "वाटर", "Tirupati" / "తిరుపతి" / "tirupathi".
   Translit.roman() turns Telugu and Hindi script into Roman letters, and
   Translit.key() reduces any word to how it SOUNDS (ph=f, w=v, aa=a, double letters …),
   so words can be compared by sound instead of by spelling. */
const Translit = (() => {
  const TE = {
    cons: { 'క': 'k', 'ఖ': 'kh', 'గ': 'g', 'ఘ': 'gh', 'ఙ': 'ng', 'చ': 'ch', 'ఛ': 'chh', 'జ': 'j', 'ఝ': 'jh', 'ఞ': 'ny', 'ట': 't', 'ఠ': 'th', 'డ': 'd', 'ఢ': 'dh', 'ణ': 'n',
      'త': 't', 'థ': 'th', 'ద': 'd', 'ధ': 'dh', 'న': 'n', 'ప': 'p', 'ఫ': 'ph', 'బ': 'b', 'భ': 'bh', 'మ': 'm', 'య': 'y', 'ర': 'r', 'ఱ': 'r', 'ల': 'l', 'ళ': 'l', 'వ': 'v',
      'శ': 'sh', 'ష': 'sh', 'స': 's', 'హ': 'h' },
    vowels: { 'అ': 'a', 'ఆ': 'aa', 'ఇ': 'i', 'ఈ': 'ii', 'ఉ': 'u', 'ఊ': 'uu', 'ఋ': 'ru', 'ఎ': 'e', 'ఏ': 'ee', 'ఐ': 'ai', 'ఒ': 'o', 'ఓ': 'oo', 'ఔ': 'au' },
    signs: { 'ా': 'aa', 'ి': 'i', 'ీ': 'ii', 'ు': 'u', 'ూ': 'uu', 'ృ': 'ru', 'ె': 'e', 'ే': 'ee', 'ై': 'ai', 'ొ': 'o', 'ో': 'oo', 'ౌ': 'au' },
    virama: '్', nasal: ['ం', 'ఁ'], visarga: 'ః', dropFinalA: false,
  };
  const HI = {
    cons: { 'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny', 'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
      'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n', 'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v',
      'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h', 'ज़': 'z', 'फ़': 'f', 'ड़': 'r', 'ढ़': 'rh', 'क़': 'k', 'ख़': 'kh', 'ग़': 'g' },
    vowels: { 'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ii', 'उ': 'u', 'ऊ': 'uu', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o' },
    signs: { 'ा': 'aa', 'ि': 'i', 'ी': 'ii', 'ु': 'u', 'ू': 'uu', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o' },
    virama: '्', nasal: ['ं', 'ँ'], visarga: 'ः', nukta: '़', dropFinalA: true,   // Hindi: "बिल" = bil, not bila
  };
  const NUKTA = { 'j': 'z', 'ph': 'f', 'd': 'r', 'dh': 'rh', 'k': 'k', 'kh': 'kh', 'g': 'g' };
  const scriptOf = ch => (ch >= 'ఀ' && ch <= '౿') ? TE : (ch >= 'ऀ' && ch <= 'ॿ') ? HI : null;

  function roman(text) {
    let out = '', pending = null, lastCons = '';
    const flush = (atWordEnd) => {
      if (pending) out += (atWordEnd && pending.dropFinalA) ? '' : 'a';
      pending = null;
    };
    for (const ch of (text || '').normalize('NFC')) {
      const S = scriptOf(ch);
      if (!S) { flush(true); out += ch; continue; }
      if (S.cons[ch]) { flush(false); out += S.cons[ch]; lastCons = S.cons[ch]; pending = S; }
      else if (S.signs[ch]) { out += S.signs[ch]; pending = null; }
      else if (ch === S.virama) { pending = null; }
      else if (S.nukta && ch === S.nukta) {
        if (NUKTA[lastCons] && out.endsWith(lastCons)) out = out.slice(0, -lastCons.length) + NUKTA[lastCons];
      }
      else if (S.nasal.includes(ch)) { flush(false); out += 'n'; }
      else if (ch === S.visarga) { flush(false); out += 'h'; }
      else if (S.vowels[ch]) { flush(false); out += S.vowels[ch]; }
      else { flush(true); }            // digits / danda etc. inside the script blocks
    }
    flush(true);
    return out;
  }

  /* how a (Roman) word sounds — spelling differences removed */
  function key(word) {
    let w = roman(word).toLowerCase();
    w = w.replace(/chh/g, '9').replace(/ch/g, '9');
    w = w.replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/9/g, 'c');
    w = w.replace(/ph/g, 'f').replace(/sh/g, 's').replace(/([kgtdbjp])h/g, '$1')
         .replace(/q/g, 'k').replace(/x/g, 'ks').replace(/z/g, 'j').replace(/w/g, 'v').replace(/y/g, 'i');
    w = w.replace(/[^a-z0-9]/g, '');
    w = w.replace(/ee|ii/g, 'i').replace(/oo|uu/g, 'u').replace(/aa/g, 'a').replace(/ai|ei/g, 'e').replace(/ou|au/g, 'o');
    w = w.replace(/(.)\1+/g, '$1');
    if (w.length > 3) w = w.replace(/[aeiou]$/, '');
    return w;
  }
  const skeleton = k => k.slice(0, 1) + k.slice(1).replace(/[aeiou]/g, '');

  function dist(a, b) {
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length][b.length];
  }

  /* 2 = sounds the same, 1 = sounds close, 0 = different */
  function soundsLike(a, b) {
    const ka = key(a), kb = key(b);
    if (!ka || !kb) return 0;
    if (ka === kb) return ka.length >= 2 ? 2 : 0;
    if (Math.min(ka.length, kb.length) < 3) return 0;
    const ratio = dist(ka, kb) / Math.max(ka.length, kb.length);
    if (ratio <= 0.2 && Math.min(ka.length, kb.length) >= 5) return 2;
    if (ratio <= 0.34) return 1;
    const sa = skeleton(ka), sb = skeleton(kb);
    if (sa.length >= 3 && sa === sb) return 1;
    return 0;
  }

  /* best sound-match of a (possibly multi-word) phrase anywhere inside an utterance */
  /* Telugu adds case endings to words: రవికి = "to Ravi", తిరుపతికి = "to Tirupati", హైదరాబాద్‌లో = "in Hyderabad" */
  const TE_SUFFIX = ['గారికి', 'గారు', 'కి', 'కు', 'ని', 'ను', 'లో', 'తో', 'కే', 'నుండి', 'నుంచి', 'కీ', 'దే', 'ది'];
  function stripSuffix(tok) {
    for (const suf of TE_SUFFIX) if (tok.length > suf.length + 1 && tok.endsWith(suf)) return tok.slice(0, -suf.length).replace(/\u200c$/, '');
    return tok;
  }
  function phraseScore(utterance, phrase) {
    const u = utterance.split(/\s+/).filter(Boolean).map(stripSuffix);
    const n = Math.max(1, phrase.split(/\s+/).filter(Boolean).length);
    const target = phrase.replace(/\s+/g, '');
    let best = 0;
    for (let size = Math.max(1, n - 1); size <= n + 1; size++)
      for (let i = 0; i + size <= u.length; i++) {
        best = Math.max(best, soundsLike(u.slice(i, i + size).join(''), target));
        if (best === 2) return 2;
      }
    return best;
  }

  return { roman, key, soundsLike, phraseScore };
})();

/* ---------- matching what was heard ---------- */
const Match = {
  norm(s) { return (s || '').toLowerCase().normalize('NFC').replace(/[.,!?।॥"“”'’:;()\-]/g, ' ').replace(/\s+/g, ' ').trim(); },
  has(text, word) {
    const w = this.norm(word);
    if (!w) return false;
    if (/^[\x00-\x7f]+$/.test(w)) return new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])').test(text);
    return text.includes(w);    // Indic words carry suffixes, so substring match
  },
  // small typo tolerance for romanised words ("hydrabad" ≈ "hyderabad")
  similar(a, b) {
    if (a.length < 4 || b.length < 4) return false;
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length][b.length] / Math.max(a.length, b.length) <= 0.25;
  },
  anyOf(alts, words) {
    for (const alt of alts) {
      const n = this.norm(alt);
      for (const w of words) if (this.has(n, w)) return true;
      const toks = n.split(' ');
      for (const w of words) { const wn = this.norm(w); if (/^[a-z]+$/.test(wn) && toks.some(tk => this.similar(tk, wn))) return true; }
    }
    return false;
  },
  /* exact (no typo-tolerance) — used for command words, where "last" must not become "least" */
  hasAny(alts, words) {
    return alts.some(alt => { const n = this.norm(alt); return words.some(w => this.has(n, w)); });
  },
  command(alts) {
    // only treat as a command if the utterance is short (avoid "go back to Tirupati")
    // and does not point at an option ("repeat option two" = read that option, not repeat all)
    if (this.ordinal(alts, 8) >= 0 || this.hasAny(alts, VOCAB.option_word)) return null;
    const short = alts.filter(a => this.norm(a).split(' ').length <= 3);
    if (!short.length) return null;
    for (const c of ['cancel', 'back', 'repeat', 'help', 'home']) if (this.anyOf(short, VOCAB['cmd_' + c])) return c;
    return null;
  },
  /* Which option did the user mean?  Returns {option, index, strength}
     strength: 'strong' = a word of the option was clearly heard, or its number/ordinal
               'weak'   = only a close-sounding word (typo / accent) → we ask "Did you mean…?" */
  optionScored(alts, options) {
    let best = -1, bestScore = 0;
    options.forEach((o, i) => {
      const words = [o.label, ...(o.words || [])];
      let score = 0;
      for (const alt of alts) {
        const n = this.norm(alt);
        for (const w of words) if (this.has(n, w)) score = Math.max(score, 2 + this.norm(w).length / 100);
      }
      if (!score) {
        // compare by SOUND, across scripts: "ఎలక్ట్రిసిటీ" ≈ "electricity", "वाटर" ≈ "water", "hydrabad" ≈ "Hyderabad"
        let ph = 0;
        for (const alt of alts) for (const w of words) { ph = Math.max(ph, Translit.phraseScore(this.norm(alt), this.norm(w))); if (ph === 2) break; }
        score = ph === 2 ? 1.9 : ph === 1 ? 1 : 0;
      }
      if (!score && this.anyOf(alts, words)) score = 1;
      if (score > bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0) return { option: options[best], index: best, strength: bestScore >= 1.9 ? 'strong' : 'weak' };
    const k = this.ordinal(alts, options.length);
    return k >= 0 ? { option: options[k], index: k, strength: 'strong' } : null;
  },
  option(alts, options) { const r = this.optionScored(alts, options); return r ? r.option : null; },

  /* "second", "option 2", "दूसरा", "రెండో" → 1 (index), or -1. Longest matching word wins ("second one" → 2nd). */
  ordinal(alts, count) {
    let pick = -1, len = 0;
    for (let i = 0; i < Math.min(count, VOCAB.ord.length); i++)
      for (const w of VOCAB.ord[i]) if (alts.some(a => this.has(this.norm(a), w)) && w.length > len) { pick = i; len = w.length; }
    return pick;
  },

  /* "read option 2", "दूसरा विकल्प बताओ", "రెండో ఎంపిక చెప్పండి", "tell me about Godavari"
     → index of the option to read aloud, or -1 */
  readRequest(alts, options) {
    if (!this.hasAny(alts, VOCAB.read_words)) return -1;
    const k = this.ordinal(alts, options.length);
    if (k >= 0) return k;
    const r = this.optionScored(alts, options);
    return r && r.strength === 'strong' ? r.index : -1;
  },
  wantsOneByOne(alts) { return this.hasAny(alts, VOCAB.one_by_one); },
  wantsNext(alts) { return this.hasAny(alts, VOCAB.next_words); },

  /* Understands "the cheapest", "the morning one", "సాయంత్రం బస్సు", "सबसे जल्दी पहुँचने वाली"
     for options that carry meta {fare, hour, hours}. Returns {index, kind} or {index: -1, kind} or null. */
  smartPick(alts, options) {
    if (!options.length || !options[0].meta) return null;
    const m = options.map(o => o.meta);
    const argmin = f => m.reduce((b, x, i) => (f(x) < f(m[b]) ? i : b), 0);
    if (this.hasAny(alts, VOCAB.smart_cheapest)) return { index: argmin(x => x.fare), kind: 'cheapest' };
    if (this.hasAny(alts, VOCAB.smart_fastest)) return { index: argmin(x => x.hours), kind: 'fastest' };
    const buckets = { morning: h => h >= 4 && h < 12, afternoon: h => h >= 12 && h < 16, evening: h => h >= 16 && h < 20, night: h => h >= 20 || h < 4 };
    for (const kind of ['morning', 'afternoon', 'evening', 'night'])
      if (this.hasAny(alts, VOCAB['smart_' + kind])) return { index: m.findIndex(x => buckets[kind](x.hour)), kind };
    if (this.hasAny(alts, VOCAB.smart_last)) return { index: options.length - 1, kind: 'last' };
    return null;
  },
  yesNo(alts) {
    const yes = ['yes', 'yeah', 'yep', 'ok', 'okay', 'correct', 'right', 'confirm', 'sure', 'haan', 'han', 'ji', 'sahi', 'avunu', 'sare',
      'हाँ', 'हां', 'हा', 'जी', 'ठीक', 'सही', 'बिल्कुल', 'అవును', 'అవున', 'సరే', 'ఔను', 'ఔన', 'కరెక్ట్', 'ఓకే', 'అలాగే', 'yup', 'yes please', 'of course'];
    const no = ['no', 'nope', 'wrong', 'cancel', 'nahi', 'nahin', 'vaddu', 'kaadu', 'नहीं', 'नही', 'ना', 'गलत', 'मत', 'రద్దు', 'వద్దు', 'వద్ద', 'కాదు', 'కాద', 'లేదు', 'తప్పు', 'not this', 'no thanks'];
    for (const alt of alts) {
      const n = this.norm(alt);
      const isNo = no.some(w => this.has(n, w));
      // "जी"/"ji" is only politeness: "नहीं जी" = no, "हाँ जी" = yes
      const polite = ['जी', 'ji', 'sir', 'madam', 'అండి', 'గారు'];
      const isYes = yes.some(w => !(isNo && polite.includes(w)) && this.has(n, w));
      if (isNo && !isYes) return 'no';
      if (isYes && !isNo) return 'yes';
    }
    return null;
  },
  digits(alts) {
    const map = {
      zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
      'शून्य': 0, 'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'छः': 6, 'सात': 7, 'आठ': 8, 'नौ': 9,
      'సున్నా': 0, 'ఒకటి': 1, 'రెండు': 2, 'మూడు': 3, 'నాలుగు': 4, 'ఐదు': 5, 'ఆరు': 6, 'ఏడు': 7, 'ఎనిమిది': 8, 'తొమ్మిది': 9,
    };
    const indic = { '०': 0, '१': 1, '२': 2, '३': 3, '४': 4, '५': 5, '६': 6, '७': 7, '८': 8, '९': 9, '౦': 0, '౧': 1, '౨': 2, '౩': 3, '౪': 4, '౫': 5, '౬': 6, '౭': 7, '౮': 8, '౯': 9 };
    return alts.map(alt => {
      let out = '';
      const toks = this.norm(alt).replace(/[०-९౦-౯]/g, c => indic[c]).split(' ');
      for (let i = 0; i < toks.length; i++) {
        const tk = toks[i];
        if (/^\d+$/.test(tk)) out += tk;
        else if (tk in map) out += map[tk];
        else if ((tk === 'double' || tk === 'triple') && i + 1 < toks.length) {
          const nx = toks[i + 1]; const d = /^\d$/.test(nx) ? nx : (nx in map ? String(map[nx]) : '');
          if (d) { out += d.repeat(tk === 'double' ? 2 : 3); i++; }
        }
      }
      return out;
    });
  },
};
