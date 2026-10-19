# 🤝 Saathi — Voice-first Digital Assistant for Senior Citizens

**SIH 2026 prototype · Team Tech Innovators**

Saathi helps senior citizens pay bills, book tickets and make video calls by **speaking in their own language** (English, हिन्दी, తెలుగు). It guides them one step at a time, reads everything aloud, warns about scams and **never moves money without a double confirmation**. Volunteers get a live dashboard showing where users get stuck.

| What | Where |
|---|---|
| Welcome / login page | `http://localhost:5000/` — choose **Senior Citizen** or **Volunteer** |
| Senior app (after senior login) | `http://localhost:5000/app` |
| Volunteer dashboard (after volunteer login) | `http://localhost:5000/volunteer` |
| Speech accuracy testing (volunteer login) | `http://localhost:5000/speech-test` |
| ESP32 help remote | `hardware/` |
| Docs (architecture, DFD, user guide, test report) | `docs/` |

### 🎤 Voice not working? Open **`localhost:5000/voice-check`**
It tests the browser, safe address, speech recognition, microphone permission, microphone sound level, internet, a live recognition test in English/Hindi/Telugu, and the speaking voices — and shows the exact fix (including Mac System Settings steps). It is also linked from the welcome page, the senior login page and the senior app (🎤 Voice check).

### 🔑 Demo logins

| Role | Login with | Accounts |
|---|---|---|
| 👵 Senior citizen | mobile number + 4-digit PIN | Lakshmi `9000000001` · Ramesh `9000000002` · Joseph `9000000003` · Sarojini `9000000004` — PIN **1234** for all |
| 🤝 Volunteer | email + password | `volunteer@saathi.in` / `saathi123` · `rahul@saathi.in` / `saathi123` |

The login pages have "tap to fill" buttons for these. PINs and passwords are stored hashed; each role can only open its own pages (a senior cannot open the dashboard, a volunteer cannot make payments). Change the demo accounts in `db.py` before any real use.

### 🔒 Security (see `security.py`)
| Protection | What it does |
|---|---|
| Hashed PINs & passwords | PBKDF2-SHA256, never stored in plain text |
| Login lockout | 5 wrong PINs/passwords in 15 min → that login is locked for 15 min (also limits guessing from one device) |
| CSRF protection | every change request carries a secret per-session token, so another website cannot act as the user |
| Payment PIN | payments of **₹1,000 or more** also need the 4-digit PIN (typed, never spoken); 3 wrong PINs block that payment |
| Server-enforced confirmation | YES + 2-second hold + countdown + minimum 3 s, checked on the server; a payment belongs to the logged-in senior only |
| Idle auto-logout | seniors after 20 min without use, volunteers after 30 min |
| Roles | seniors cannot open the dashboard; volunteers cannot make payments |
| Security headers | Content-Security-Policy, no framing (click-jacking), no MIME sniffing, strict referrer, mic/camera only for Saathi + video call |
| Device token | set `DEVICE_TOKEN` so only your ESP32 remote is accepted |
| Audit log | logins, failed logins, lockouts, logouts and wrong payment PINs are saved in `security_events` |

---

## 1. Features

**Senior app**
- 🎤 Voice in + 🔊 voice out in English, Hindi and Telugu. Saathi speaks every question; the microphone **only listens when you tap 🎤** (tap again to stop). Buttons always work too
- Three guided tasks: **🧾 bill payment**, **🎫 bus/train ticket booking**, **📹 video call family**, plus **🛡️ "Is this message a scam?"**
- **📄 Bill / letter reader**: take a photo, choose a PDF, or paste the text → Saathi says in plain words *who it is from, how much, by when (and how many days are left), which consumer number, units used* — and warns if it looks like a scam. For electricity, water or mobile bills, **"Pay this bill"** opens bill payment with the number already filled in (still read back and confirmed). Nothing is saved; the file is read in memory and thrown away.
- **🆘 Trusted-contact help sheet** (Help button / "help" / SOS on the remote): one calm screen with three choices — **📞 call my son/daughter** (the trusted contact, with a confirm screen showing the number, then phone call or video call), **🤝 ask a volunteer** (they see your task and step), **🚨 I think I'm being cheated** (4 clear steps: don't share OTP, hang up, call **1930** cyber-crime helpline, tell family — with a one-tap 1930 call). If a big payment is blocked, a "call my son/daughter" button appears right there.
- **Lavender card design** matching the team mockup, light and dark, with a notes bell for volunteer hints
- **Works on laptop and phone**: on a laptop/desktop (1024 px and wider) the navigation runs **across the top** (Home · Back · Repeat · History · Help, messages bell, user/logout), display settings sit just below it, the options use a wide card grid and a big microphone panel on the right never covers them. On a phone it is the single-column card. The login pages get a side-by-side info panel on desktop.
- **📜 History** (top bar button, or say *"show my payments"*, *"पिछले भुगतान दिखाओ"*, *"నా చెల్లింపులు చూపించు"*): every payment with a clear status — **Paid**, **Failed** (over the daily limit / wrong PIN 3 times) or **Stopped** (cancelled at confirm, hold-to-pay, PIN or countdown, or left before confirming) — always saying *"No money was taken"* when nothing was paid. Below that, **tasks left half-way** with the exact step where the senior stopped. Filter by tapping or by saying *paid / failed / stopped / all*; it reads the results aloud. Stopped bills have a **Try again** button.
- **Volunteer payment & session log**: the same history for all seniors (or one senior) on the dashboard, with why/where each payment stopped and where tasks were abandoned.
- Global voice commands at any step: *back / repeat / help / home / cancel* (in all three languages)
- **Reliable listening**: the words appear live while you speak; Saathi waits for slow speakers (stops after ~2 s of silence); tapping 🎤 again **finishes and uses** what you said; 5 alternative guesses are compared; if something is wrong (mic blocked, no internet, wrong browser, nothing heard) Saathi says exactly what and how to fix it
- **Sound-alike matching across scripts**: Telugu/Hindi speech is transliterated to Roman letters and compared by sound, so "ఎలక్ట్రిసిటీ" = Electricity, "वाटर" = Water, "మొబైల్" = Mobile, "రవికి కాల్" = Ravi, "tirupathi" = Tirupati; polite answers like "అవునండి", "వద్దండి", "नहीं जी" are understood
- When Saathi still does not understand, it says what it heard and lists what you can say
- **Smart voice understanding on every option screen** (English / Hindi / Telugu):
  - *"read option 2"* · *"दूसरा विकल्प बताओ"* · *"రెండో ఎంపిక చెప్పండి"* → Saathi reads **only that option** (it does not choose it)
  - *"one by one"* · *"एक-एक करके"* · *"ఒక్కొక్కటిగా"* → reads one option at a time and asks *"Do you want this one? Say yes, or next"*
  - *"the cheapest"*, *"the fastest"*, *"the morning / evening / night one"*, *"सबसे सस्ता"*, *"సాయంత్రం బస్సు"* → picks the matching train/bus and asks to confirm
  - an unclear, close-sounding word (e.g. *"watter"*) → *"Did you mean Water?"* before choosing
  - every option has a 🔊 button to hear just that one
- Accent-tolerant matching: uses the top-3 speech alternatives, Hindi/Telugu/romanised synonyms, spoken digits ("nine eight…", "తొమ్మిది ఎనిమిది…", "double five") and small-typo tolerance
- Accessibility: text size A−/A+, **🌙 dark mode** (follows the device the first time), **🗣️ Voice settings** (talk / stay quiet, slow / normal, choose the most natural voice on the device), friendly local-style speech ("సరే అండీ…", "ठीक है जी…"), Back works on every step including payment screens, 6 rem tall buttons, big keypad, one question per screen, step progress bar, offline fonts for Telugu/Devanagari
- Hand-tremor support: **press-and-hold** to pay (an accidental tap does nothing), large gaps between targets, physical ESP32 buttons with tremor filtering
- 🆘 HELP button → volunteer sees exactly which task + step you are on and can send a hint that is **read aloud** on your phone

**Safety before any payment** (enforced by the server, not just the screen)
1. Summary read aloud: amount, payee, purpose → say/tap **YES**
2. **Press and hold** the green button for 2 seconds
3. **5-second countdown** with a giant CANCEL
4. Server refuses if either confirmation is missing, if it was confirmed faster than 3 s, if the same payment is confirmed twice, or if it exceeds the **daily safe limit** (needs family approval)
5. Warnings: new payee, unusually high amount, late-night payment
6. Scam detector for SMS/WhatsApp text: OTP/PIN requests, KYC/account-block threats, lottery/cashback, urgency, screen-sharing apps, fake police/courier/"digital arrest", shortened or suspicious links — in English, Hindi and Telugu. If a senior *says* something like "someone asked for my OTP", the app warns immediately.

**Volunteer dashboard** — KPIs, live "needs help" queue with hint sending, "struggling right now", task funnels (where people drop off), trouble-spot ranking, voice failures per language, and the exact phrases the system did not understand (to add to the vocabulary).

**Speech test page** — testers read fixed sentences; the app saves what it heard and computes **WER, CER and intent accuracy** grouped by language × accent × noise level, with CSV export for the test report.

**Hardware** — ESP32 remote with SPEAK / YES / NO / SOS buttons, vibration feedback and LEDs (see `hardware/`).

---

## 2. Setup

Requirements: **Python 3.9+** and **Google Chrome** (desktop or Android) — Chrome provides the speech recognition used in this prototype.

**macOS (Terminal)**
```bash
cd ~/Desktop/senior-assist
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```
> If you see *"Address already in use"*, macOS AirPlay Receiver is using port 5000: run `PORT=5001 python app.py` and open `localhost:5001` (or turn off AirPlay Receiver in System Settings → General → AirDrop & Handoff).

**Windows (Command Prompt)**
```bat
cd senior-assist
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open `http://localhost:5000` in Chrome, choose **Senior Citizen** or **Volunteer**, sign in with a demo account, and allow the microphone.

**Use it on a phone:** connect the phone and laptop to the same Wi-Fi, find the laptop's IP (`ipconfig` / `ifconfig`, e.g. `192.168.1.10`) and open `http://192.168.1.10:5000`.
> Chrome only allows the microphone on `localhost` or HTTPS. On a phone, either open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add `http://192.168.1.10:5000` and relaunch, **or** run a tunnel such as `ngrok http 5000` and open the https link.

**Options (environment variables)**

| Variable | Default | Meaning |
|---|---|---|
| `DEMO_DATA` | `1` | `0` = start without sample dashboard activity |
| `PORT` | `5000` | server port |
| `SAATHI_DB` | `saathi.db` | database file |
| `JITSI_DOMAIN` | `meet.jit.si` | video-call server (use your own Jitsi for production) |
| `PAYMENT_PIN_THRESHOLD` | `1000` | payments from this amount (₹) need the PIN |
| `DEVICE_TOKEN` | *(empty)* | secret the ESP32 must send (`X-Device-Token`) |
| `HTTPS` | `0` | set `1` when served over https (secure cookies) |

Reset everything: stop the server and delete `saathi.db`.

**Run the tests**
```bash
python -m pytest -q                 # 69 backend tests (incl. login, roles and security)
node tests/test_voice_matching.js       # 23 voice-matching tests
node tests/test_voice_understanding.js  # 51 tests: read one option, one-by-one, smart picks, did-you-mean, cross-script sound matching
```

---

**Reading photos of bills (optional).** PDFs work out of the box. To read *photos*, install the Tesseract OCR engine once:
```bash
brew install tesseract tesseract-lang     # macOS (needs Homebrew: https://brew.sh)
```
Without it, Saathi politely says it can't read photos yet and offers PDF or paste instead. Try it with the samples in `docs/samples/` (an electricity bill PDF, a water-bill photo and a scam letter).

## 3. Demo script (5 minutes)

0. Open `localhost:5000` → show the welcome page with the two roles. In **one Chrome window** sign in as the volunteer; in an **Incognito window** (or on the phone) sign in as senior *Lakshmi* (9000000001 / 1234). *(Two logins need two separate windows because they share cookies.)*
1. Senior app opens in Telugu (Lakshmi's saved language). **Tap 🎤** and say *"కరెంట్ బిల్లు కట్టాలి"* → bill flow starts.
2. Tap 🎤, say *"అవును"* to use the saved number → bill ₹840 is read out → *"అవును"* → confirmation screen → **hold** the green button → countdown → receipt.
3. Home → *"Tirupati ki train ticket"* (Hindi/English) → choose city, *"రేపు"* (tomorrow), *"రెండో"* (second option), lower seat → confirm.
4. Home → tap **Check a message** → paste *"Your account will be blocked, update KYC at bit.ly/x and share OTP"* → red DANGER screen.
5. Press **HELP** mid-task → open `/volunteer` on the laptop → the request appears → send a hint → the phone reads it aloud.
6. Show the funnel / trouble spots / not-understood phrases on the dashboard, then the `/speech-test` results table.
7. Press the ESP32 **YES** button on a yes/no screen → the app moves on.

---

## 4. Project structure

```
senior-assist/
├── app.py               Flask server: pages + all APIs
├── config.py            task steps, limits, cities
├── db.py                SQLite schema + demo seed data
├── intents.py           multilingual intent + yes/no detection
├── scam_checker.py      scam text rules + payment safety checks
├── speech_eval.py       WER / CER for accuracy testing
├── security.py          CSRF, lockout, idle logout, headers, audit
├── doc_reader.py        bill/letter reader: PDF text, photo OCR, amount/due-date/number extraction
├── templates/           landing.html · login_senior.html · login_volunteer.html · senior.html · volunteer.html · speech_test.html
├── static/js/           icons.js · i18n.js (all text + vocabulary) · voice.js · core.js · ui.js · flows.js · volunteer.js
├── static/css/          auth.css · senior.css · volunteer.css · fonts.css   static/fonts/ (Noto Sans, offline)
├── hardware/            ESP32 sketch + wiring diagram (SVG/PNG)
├── docs/samples/        sample bill PDF, bill photo, scam letter for the reader
├── docs/                ARCHITECTURE.md · USER_GUIDE.md · HARDWARE.md · TEST_REPORT.md
└── tests/               test_backend.py · test_voice_matching.js · test_voice_understanding.js
```

## 5. What is mocked in this prototype

Bills, journeys and payments are **simulated** (no real money moves, no IRCTC/BBPS/UPI connection — those need licensed partner APIs). Video calls use a real Jitsi room. Speech uses the browser's Web Speech API; `voice.js` is the single place to swap in **Bhashini / AI4Bharat** ASR & TTS for production-grade accent and noise robustness.

## 6. Adding a language or accent words

- New words for an accent: add them to `VOCAB` in `static/js/i18n.js` (option words) and `INTENT_KEYWORDS` in `intents.py` (home-screen intents). The dashboard's *"Phrases the system did not understand"* table tells you what to add.
- New language: copy the `en` block in `STRINGS`, translate, add it to `LANGS`, and add its words to `VOCAB`/`intents.py`.
