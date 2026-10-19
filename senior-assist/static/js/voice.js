/* Voice input (speech-to-text) and voice output (text-to-speech) using the
   browser's Web Speech API. Works best in Google Chrome (Mac, Windows, Android).
   For production, swap these functions for Bhashini / AI4Bharat APIs —
   the rest of the app only calls Voice.speak(), Voice.listen(), Voice.finish(), Voice.stop().

   Listening is built for seniors:
   • shows the words live while you speak (onInterim)
   • waits for slow speakers — it only stops after ~2 s of silence (or when you tap 🎤 again)
   • tapping 🎤 again FINISHES and uses what you said (it does not throw it away)
   • returns up to 5 alternative guesses so accents still match
   • every failure comes back with a clear reason code (see ERROR_CODES) */
const Voice = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isAndroid = /Android/i.test(navigator.userAgent || '');
  let rec = null;          // the running recogniser
  let voices = [];
  const loadVoices = () => { try { voices = speechSynthesis.getVoices(); } catch (e) { voices = []; } };
  if ('speechSynthesis' in window) {
    loadVoices();
    try { speechSynthesis.addEventListener('voiceschanged', loadVoices); } catch (e) { /* ignore */ }
  }

  /* ---------- choosing a NATURAL voice ----------
     Macs and Chrome come with many voices; some are robotic or joke voices.
     We score every installed voice and pick the most natural one for the language:
     Premium/Enhanced/Neural voices first, then Google voices, then Indian-English for English.
     The senior (or a helper) can also choose a voice in 🗣️ Voice settings — that choice wins. */
  const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|superstar|trinoids|whisper|wobble|zarvox|pipe organ|fred|junior|ralph|kathy|grandma|grandpa|rocko|shelley|eddy|flo|reed|sandy/i;
  const WANT = { en: ['en-IN', 'en-GB', 'en-US', 'en-AU'], hi: ['hi-IN'], te: ['te-IN'] };
  const norm = l => (l || '').replace('_', '-').toLowerCase();

  function scoreVoice(v, lang) {
    const want = WANT[lang] || [LANGS[lang].code];
    const vl = norm(v.lang);
    let score = -1;
    want.forEach((code, i) => { if (vl === code.toLowerCase()) score = Math.max(score, 100 - i * 15); });
    if (score < 0 && vl.startsWith(want[0].slice(0, 2).toLowerCase())) score = 40;
    if (score < 0) return -1;                                    // wrong language: never use it
    const n = v.name || '';
    if (NOVELTY.test(n)) return -1;
    if (/premium/i.test(n)) score += 60;
    if (/enhanced|neural|natural|wavenet/i.test(n)) score += 45;
    if (/google/i.test(n)) score += 35;                         // Chrome's Google voices sound natural
    if (/siri/i.test(n)) score += 30;
    if (/rishi|veena|isha|lekha|kiyara|neel|aditi|raveena/i.test(n)) score += 20;   // Indian voices
    if (/samantha|daniel|karen|moira|tessa/i.test(n)) score += 10;
    return score;
  }
  function voicesFor(lang) {
    return voices.map(v => ({ v, s: scoreVoice(v, lang) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s).map(x => x.v);
  }
  function chosenName(lang) { try { return localStorage.getItem('saathi_voice_' + lang) || ''; } catch (e) { return ''; } }
  function setVoice(lang, name) { try { localStorage.setItem('saathi_voice_' + lang, name || ''); } catch (e) { /* ignore */ } }
  function voiceFor(lang) {
    const list = voicesFor(lang);
    const want = chosenName(lang);
    return (want && list.find(v => v.name === want)) || list[0] || null;
  }
  // old name kept for other pages: pickVoice('te-IN')
  function pickVoice(code) {
    const lang = Object.keys(LANGS).find(k => LANGS[k].code === code) || 'en';
    return voiceFor(lang);
  }
  const hasVoiceFor = lang => !!voiceFor(lang);

  /* Split long text into short sentences: sounds more natural, and Chrome stops very long utterances. */
  function sentences(text) {
    const parts = text.replace(/₹\s?/g, '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').split(/(?<=[.!?।])\s+/);
    const out = [];
    for (const p of parts) {
      if (p.length <= 170) { if (p.trim()) out.push(p.trim()); continue; }
      let buf = '';
      for (const piece of p.split(/(?<=,)\s+/)) {
        if ((buf + ' ' + piece).length > 170 && buf) { out.push(buf.trim()); buf = piece; } else buf += ' ' + piece;
      }
      if (buf.trim()) out.push(buf.trim());
    }
    return out;
  }

  let speakToken = 0;
  let muted = false;
  let onNoVoice = null;                 // called once when a language has no voice on this device
  const warned = {};

  function speakOne(text, voice, code, rate, token) {
    return new Promise(resolve => {
      if (token !== speakToken) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = voice ? voice.lang : code;
      if (voice) u.voice = voice;
      u.rate = rate || 0.95;
      u.pitch = 1.0;
      u.volume = 1;
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      u.onend = finish;
      u.onerror = finish;
      setTimeout(finish, Math.min(20000, 1200 + text.length * 80 / (u.rate || 1)));   // never hang
      try { speechSynthesis.speak(u); } catch (e) { finish(); }
    });
  }

  async function speak(text, lang, rate) {
    if (!('speechSynthesis' in window) || !text || muted) return;
    try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    const token = ++speakToken;
    const voice = voiceFor(lang);
    if (!voice) {
      // Reading Telugu with an English voice sounds terrible — show text only instead.
      if (!warned[lang] && voices.length) { warned[lang] = true; if (onNoVoice) onNoVoice(lang); }
      if (voices.length) return;
    }
    for (const part of sentences(text)) {
      if (token !== speakToken) return;
      await speakOne(part, voice, LANGS[lang].code, rate, token);
      if (token !== speakToken) return;
      await new Promise(r => setTimeout(r, 120));            // small natural pause between sentences
    }
  }
  function stopSpeaking() { speakToken++; try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } }

  /* Build the list of alternative transcripts from the recognised segments. */
  function combine(finals, interim) {
    const best = finals.map(f => f[0]).concat(interim ? [interim] : []).join(' ').replace(/\s+/g, ' ').trim();
    const out = best ? [best] : [];
    if (finals.length) {
      const last = finals[finals.length - 1];
      const head = finals.slice(0, -1).map(f => f[0]).join(' ');
      for (let k = 1; k < last.length; k++) out.push((head + ' ' + last[k]).trim());
      if (finals.length > 1) finals.forEach(f => f.forEach(a => out.push(a)));   // each piece on its own too
    }
    return [...new Set(out.filter(Boolean))].slice(0, 8);
  }

  /* Listen once. Resolves with alternatives (best first); rejects with an error code string. */
  function listen(lang, opts = {}) {
    const { onInterim, maxMs = 15000, silenceMs = 2000 } = opts;
    return new Promise((resolve, reject) => {
      if (!SR) return reject('unsupported');
      if (window.isSecureContext === false) return reject('insecure');
      stop();
      stopSpeaking();
      const r = new SR();
      r.lang = LANGS[lang].code;
      r.interimResults = true;
      r.maxAlternatives = 5;
      r.continuous = !isAndroid;           // Android Chrome ends by itself; desktop waits for our silence timer
      const finals = [];
      let interim = '', error = null, settled = false, silenceTimer = null;
      const clear = () => { clearTimeout(silenceTimer); clearTimeout(maxTimer); };
      const done = () => {
        if (settled) return;
        settled = true; clear();
        if (rec === r) rec = null;
        const alts = combine(finals, interim);
        if (alts.length) resolve(alts);
        else reject(error || 'no-speech');
      };
      const graceful = () => { try { r.stop(); } catch (e) { done(); } };
      r.onresult = e => {
        interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) {
            const alts = [];
            for (let k = 0; k < res.length; k++) if (res[k].transcript.trim()) alts.push(res[k].transcript.trim());
            if (alts.length) finals.push(alts);
          } else interim += res[0].transcript;
        }
        if (onInterim) try { onInterim(combine(finals, interim)[0] || ''); } catch (err) { /* ignore */ }
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(graceful, silenceMs);     // ~2 s quiet after speaking → finish
      };
      r.onerror = e => {
        error = e.error || 'error';
        // hard failures: stop right away with the reason
        if (['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported'].includes(error)) {
          if (!settled) { settled = true; clear(); if (rec === r) rec = null; reject(error); }
        }
      };
      r.onend = done;
      const maxTimer = setTimeout(graceful, maxMs);
      rec = r;
      try { r.start(); } catch (e) { settled = true; clear(); rec = null; reject('start-failed'); }
    });
  }

  /* Tap 🎤 again while listening → finish now and USE what was said. */
  function finish() { if (rec) { try { rec.stop(); } catch (e) { /* ignore */ } } }
  /* Throw away the current listening (screen changed, payment cancelled …). */
  function stop() {
    if (rec) { const r = rec; rec = null; try { r.abort(); } catch (e) { /* ignore */ } }
  }
  const isListening = () => !!rec;

  return {
    supported: !!SR, speak, stopSpeaking, listen, finish, stop, isListening, hasVoiceFor, pickVoice,
    voicesFor, voiceFor, setVoice, chosenName,
    setMuted(m) { muted = !!m; if (muted) stopSpeaking(); },
    get muted() { return muted; },
    set onNoVoice(fn) { onNoVoice = fn; },
    refreshVoices: loadVoices,
  };
})();
