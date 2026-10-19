# System Design & Data Flow — Saathi

> Diagrams are written in Mermaid. They render directly on GitHub, or paste them into https://mermaid.live to export PNG/SVG for slides.

## 1. Architecture

```mermaid
flowchart LR
  subgraph Senior["👵 Senior citizen"]
    PH["Phone / tablet<br/>(Chrome)"]
    RM["ESP32 Help Remote<br/>SPEAK · YES · NO · SOS"]
  end

  subgraph Client["Senior app (HTML/CSS/JS)"]
    UI["Accessible UI<br/>large text · contrast · hold-to-pay"]
    VO["voice.js<br/>Speech-to-Text · Text-to-Speech"]
    MT["core.js Match<br/>options · yes/no · digits · commands"]
    FL["flows.js Task engine<br/>bill · ticket · call · scam check"]
  end

  subgraph Server["Flask backend (Python)"]
    NLU["intents.py<br/>intent detection (en/hi/te)"]
    SC["scam_checker.py<br/>scam text + payment safety"]
    PAY["Safe payment API<br/>prepare → confirm/cancel"]
    MOCK["Mock services<br/>bills · journeys"]
    LOG["Event log + help queue"]
    DASH["Dashboard analytics"]
    EV["speech_eval.py<br/>WER / CER"]
  end

  DB[("SQLite")]
  JIT["Jitsi video call"]
  VOL["🧑‍🤝‍🧑 Volunteer dashboard"]
  TST["Speech test page"]

  PH <--> UI
  UI --- VO
  VO --> MT --> FL
  FL -->|text| NLU
  FL -->|message| SC
  FL --> PAY --> SC
  FL --> MOCK
  FL -->|every step| LOG
  FL --> JIT
  RM -->|Wi-Fi POST| LOG
  LOG -->|poll: buttons + hints| FL
  NLU & SC & PAY & MOCK & LOG & DASH & EV --- DB
  DASH --> VOL
  VOL -->|hint / resolve| LOG
  TST --> EV
```

**Layers (as in the proposal):** Accessibility interface → AI & language layer (STT, TTS, intent, translation via per-language strings) → Task manager (`flows.js` step engine) → Safety & scam checker → Guided workflow with confirmation → External services (mocked) → Database → Volunteer dashboard & analytics.

## 2. Data-flow diagram — Level 0 (context)

```mermaid
flowchart LR
  S(["Senior citizen"]) -- "voice / taps / remote buttons" --> P(("0<br/>Saathi system"))
  P -- "spoken prompts, screens, warnings, receipts" --> S
  V(["Volunteer"]) -- "hints, resolve help" --> P
  P -- "stuck users, funnels, failed phrases" --> V
  P -- "bill / booking / payment requests" --> E(["Service providers<br/>(mocked)"])
  E -- "bill amount, journeys, payment status" --> P
  F(["Family member"]) -. "approval for over-limit payments (future)" .-> P
```

## 3. Data-flow diagram — Level 1

```mermaid
flowchart TB
  S(["Senior"]) -->|speech| P1["1.0 Capture & recognise speech"]
  S -->|tap / remote| P3
  P1 -->|top-3 transcripts| P2["2.0 Understand<br/>(intent, option, yes/no, digits)"]
  P2 -->|intent + values| P3["3.0 Guide task step-by-step"]
  P3 -->|prompt text| P8["8.0 Speak & display"] --> S
  P3 -->|message text| P4["4.0 Scam check"]
  P4 -->|level + reasons| P3
  P3 -->|payee, amount| P5["5.0 Safe payment<br/>prepare → confirm"]
  P5 -->|warnings, receipt| P3
  P5 <--> D2[("D2 Transactions")]
  P3 -->|lookup| P6["6.0 Service gateway (mock)"]
  P6 <--> D3[("D3 Bills / journeys")]
  P3 -->|events: step, not_understood, stuck, help, abandon, complete| D1[("D1 Task logs & help requests")]
  D1 --> P7["7.0 Analyse & show dashboard"] --> V(["Volunteer"])
  V -->|hint| D1
  D1 -->|hint, device buttons| P3
  D4[("D4 Users & contacts")] --> P3
  T(["Tester"]) --> P9["9.0 Accuracy evaluation (WER/CER)"] <--> D5[("D5 Speech tests")]
```

## 4. Safe payment sequence

```mermaid
sequenceDiagram
  actor Senior
  participant App as Senior app
  participant API as Flask
  participant DB as SQLite
  App->>API: POST /api/action/prepare (payee, amount)
  API->>DB: insert pending + safety checks
  API-->>App: pending_id, warnings, blocked?
  App->>Senior: 🔊 "You are paying ₹840 to … Is this correct?"
  Senior->>App: "Yes" (voice or tap)
  App->>Senior: "Press and HOLD the green button"
  Senior->>App: holds 2 s (or ESP32 YES)
  App->>Senior: 5-second countdown · CANCEL
  App->>API: POST /api/action/confirm (first_confirm, hold_confirm)
  API->>API: both confirmations? ≥3 s since prepare? still pending? under limit?
  API->>DB: status = success, receipt ref
  API-->>App: receipt
  App->>Senior: 🔊 "Done! Receipt number …"
```

## 5. Database (SQLite)

| Table | Purpose |
|---|---|
| `users` | name, language, text size, family contact, daily limit, mobile number, hashed PIN |
| `volunteers` | name, email, hashed password |
| `contacts` | video-call contacts (name, relation, colour) |
| `saved_billers` | saved consumer numbers per bill type |
| `bills` | mock biller data |
| `transactions` | every payment attempt: pending / success / cancelled / blocked, warnings, both confirmation flags |
| `task_logs` | every step event — the source for funnels, drop-offs, stuck detection |
| `help_requests` | HELP presses (kind volunteer/family/fraud), volunteer hints, resolved status |
| `transactions.reason`, `transactions.stop_stage` | why a payment did not go through (limit · pin_blocked · user_cancelled · left) and where (confirm · hold · pin · countdown) — shown on the History page |
| `contacts.trusted` | the senior's trusted contact for the help sheet |
| `device_events` | ESP32 button presses |
| `speech_tests` | accuracy test recordings with WER/CER and intents |

## 6. API summary

| Method | Path | Use |
|---|---|---|
| GET | `/` | welcome page — choose Senior Citizen or Volunteer |
| GET/POST | `/login/senior` · `/login/volunteer` · `/logout` | sign in (mobile + PIN / email + password, both hashed) — Flask session holds the role |
| GET | `/app` (senior) · `/volunteer`, `/speech-test` (volunteer) | role-protected pages |
| GET/POST | `/api/me`, `/api/me/language` | the logged-in senior's profile and saved language |
| GET | `/api/user/<id>`, `/api/contacts/<id>` | profile, saved billers, contacts |
| POST | `/api/intent` | text → intent + scam check |
| POST | `/api/scam/check` | message → danger / caution / safe + reasons |
| GET | `/api/bill`, `/api/journeys` | mock services |
| POST | `/api/action/prepare` · `/confirm` · `/cancel` | safe payment (PIN for ₹1,000+) |
| GET | `/api/history` | senior: own payments (paid / failed / stopped + reason + stage) and tasks left half-way · volunteer: everyone, or `?user_id=` |
| POST | `/api/doc/read` | bill/letter reader — PDF (pypdf), photo (Tesseract OCR), or text → kind, biller, amount, due date, days left, number, units, scam check. In-memory only, 8 MB limit |
| POST | `/api/log`, `/api/help` (kind: volunteer · family · fraud), `/api/help/<id>/hint`, `/api/help/<id>/resolve` | events & help |
| POST/GET | `/api/device/button`, `/api/poll` | ESP32 remote & hint delivery |
| GET | `/api/dashboard` | dashboard analytics |
| POST/GET | `/api/speechtest`, `/summary`, `/export.csv` | accuracy testing |

## 7. Security layer (`security.py`)

```mermaid
flowchart LR
  R[Request] --> I{Idle > 20/30 min?} -->|yes| L[Logged out]
  I -->|no| C{POST? CSRF token OK?} -->|no| X[403 refused]
  C -->|yes| A{Role allowed?} -->|no| Y[401/403]
  A -->|yes| H[Route] --> S[Security headers added] --> Resp[Response]
  H -->|login| LK{Locked? 5 fails / 15 min} -->|yes| Z[Locked message]
  H -->|payment ≥ ₹1000| P{PIN correct? 3 tries} -->|no| B[Payment blocked]
```

## 8. Production path

| Prototype | Production |
|---|---|
| Web Speech API (Chrome) | Bhashini / AI4Bharat IndicConformer ASR + Indic TTS, on-device noise suppression (RNNoise) |
| Keyword intent rules | Fine-tuned IndicBERT / small LLM with the same intent set; rules kept as fallback |
| Mock bills & journeys | BBPS (Bharat BillPay), IRCTC/APSRTC/TSRTC partner APIs, UPI via a licensed PSP |
| SQLite | PostgreSQL, encrypted PII, audit log |
| Polling | WebSockets / push notifications |
