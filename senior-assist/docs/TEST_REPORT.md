# Test Report — Saathi Prototype

**Version:** prototype v0.1 · **Team:** Tech Innovators

This report has two parts:
- **Part 1** — automated and functional tests already run on the prototype (results below are real).
- **Part 2** — the speech-recognition field test with accents and noise. It **must be run with real testers**; the tables are a template that the `/speech-test` page fills in for you. Do not report numbers you have not measured.

---

## Part 1 · Automated & functional tests

### 1.1 Backend unit/integration tests — `python -m pytest -q`

**Result: 75 / 75 passed** (incl. document reader: PDF, pasted text, empty/bad files, scam letter; help kinds family/volunteer/fraud; trusted contact)

| Area | What is tested | Cases |
|---|---|---|
| Intent detection | English, Hindi (Devanagari + romanised), Telugu sentences → bill / ticket / call / scam_check / help; unknown text → none | 15 |
| Yes / No | yes/no words in 3 languages, ambiguous input | 7 |
| Scam detection | KYC/block + link + OTP, lottery, Hindi & Telugu scams, AnyDesk, fake customs/"digital arrest" → flagged; normal family/bill messages → safe | 7 |
| WER / CER | identical, deletion, number words vs digits, Telugu suffix variation | 2 |
| **Payment safety** | needs **both** confirmations; refused if confirmed in < 3 s; cannot pay twice; cancelled payment cannot be confirmed; over-limit payment blocked; new-payee warning | 6 |
| Mock services | bill lookup + invalid number; journeys + same-city rejection | 2 |
| Dashboard | drop-off step, retries, failed phrase and open help request computed correctly | 1 |
| Help & devices | hint delivered exactly once; ESP32 button delivered to app; invalid button rejected | 2 |
| Speech test API | WER + intent accuracy saved and summarised | 1 |
| **Security** | CSRF token required (API + login forms); lockout after 5 wrong PINs (other accounts unaffected); security headers; idle logout after inactivity; payment PIN needed for ₹1,000+ (wrong PIN → tries left, 3 wrong → payment blocked); ESP32 device token; audit log of logins | 9 |
| **Login & roles** | pages redirect to the right login when signed out; correct/wrong PIN; volunteer login; senior cannot open dashboard or another senior's data; volunteer cannot make payments; a payment cannot be confirmed by a different user; logout; language saved per user | 8 |

> A bug found by these tests and fixed: on a fresh database the first ESP32 button press was never delivered to the app (first-poll id = 0 clash).

### 1.2 Voice-matching tests — `node tests/test_voice_matching.js`

**Result: 23 / 23 passed** — e.g. "hydrabad" → Hyderabad (typo tolerance), "vizag" → Visakhapatnam, "बैंगलोर जाना है" / "banglore" → Bengaluru, "నీళ్ళ బిల్లు కట్టాలి" → water, "second one" → option 2, "double five six seven" → 5567, Telugu/Hindi number words → digits, "వెనక్కి" → back, long sentence containing "back" is *not* treated as a command.

### 1.2b Voice-understanding tests — `node tests/test_voice_understanding.js`

**Result: 51 / 51 passed** — "read option 2", "repeat option two", "दूसरा विकल्प बताओ", "తీసరా పढ़ो", "రెండో ఎంపిక చెప్పండి", "tell me about Konark Mail" read only that option; "option 2" alone still chooses; "one by one" / "एक-एक करके" / "ఒక్కొక్కటిగా"; "next" / "अगला" / "తర్వాత"; "cheapest" / "सबसे सस्ता" / "తక్కువ ధర"; "fastest"; "morning"; "రాత్రి"/"रात"; "the last one" (not confused with "least"); "watter" → asks "Did you mean water?".

Browser check (simulated speech on the journey screen): read option 2 → only option 2 spoken and nothing chosen; one by one → option 1 + "Do you want this one?"; next → option 2; "which is the cheapest" → cheapest offered; "yes" → chosen, moves to seat; "lowr seat" → "Did you mean Lower seat?"; "no" → "Please choose again"; 🔊 on option 2 → reads only option 2. No JavaScript errors.

Cross-script sound matching (option words in English only): "ఎలక్ట్రిసిటీ బిల్లు" → Electricity, "वाटर बिल" → Water, "మొబైల్"/"मोबाइल" → Mobile, "తిరుపతి వెళ్ళాలి" → Tirupati, "हैदराबाद से" → Hyderabad, "చెన్నై", "बेंगलुरु", "విశాఖపట్నం", "రవికి కాల్ చేయండి" → Ravi, "प्रिया को फोन करो" → Priya. No false matches for "hello how are you", "the weather is nice today", "bus".

### 1.2c Voice capture with a simulated Chrome speech engine
| Situation | Result |
|---|---|
| Slow Telugu speaker, words arrive in pieces, then silence | live words shown; finished after ~2 s silence; bill screen opened ✅ |
| User taps 🎤 again while speaking | what was said is **used** (water chosen) — previously it was discarded ✅ |
| Microphone blocked | spoken + on-screen fix with Voice Check link ✅ |
| No internet (network error) | spoken explanation ✅ |
| Nothing said | gentle "I did not hear anything…" ✅ |
| Sentence that is not a task | "I heard '…'. Say one of: Pay a bill, Book a ticket, …" ✅ |
| Voice Check page live test | transcript shown, "Saathi understood: Pay a bill" ✅ |

### 1.3 End-to-end browser tests (headless Chrome, 420 px phone width)

| Flow | Language | Result |
|---|---|---|
| Bill payment: category → new number on keypad → read-back → review → confirm → hold 2 s → countdown → receipt | English, Telugu | ✅ |
| Bill payment with saved number | Telugu | ✅ |
| Ticket booking: train → Hyderabad → Tirupati → tomorrow → option 2 → lower seat → new-payee warning → hold → ticket with seat | Hindi | ✅ |
| Video call: contact → confirm → Jitsi room → End call | Hindi | ✅ |
| Scam check: Hindi KYC/OTP/bit.ly message → DANGER with reasons | Hindi | ✅ |
| HELP mid-task → appears on dashboard → hint sent → delivered to app | — | ✅ |
| High contrast + larger text | Hindi | ✅ |
| Welcome page → senior login (keypad PIN) → app → payment → HELP seen by logged-in volunteer → logout | Telugu | ✅ |
| Microphone stays **off** until tapped (checked after 6 s idle and on yes/no screens); second tap stops it | — | ✅ |
| No JavaScript errors in any flow | — | ✅ |

### 1.3b Round-5 browser checks
| Check | Result |
|---|---|
| Back from *hold to pay* → confirmation screen (was: cancelled whole payment) | ✅ |
| Back from PIN → hold screen; Back from countdown → PIN screen | ✅ |
| Back from number keypad → "use saved number?" question | ✅ |
| ₹1,788 bill → PIN screen; wrong PIN → "2 tries left"; right PIN → paid | ✅ |
| Friendly speech with acknowledgement: "अच्छा जी, बिजली। बिल पर लिखा उपभोक्ता नंबर बोलिए…" | ✅ |
| Dark mode on, remembered after reload | ✅ |
| Voice panel: stay quiet (mute) remembered after reload | ✅ |
| Volunteer hint + speech-test save still work with CSRF tokens | ✅ |

### 1.3c Design + document reader + help sheet (round 7)
| Check | Result |
|---|---|
| New lavender card UI in light and dark; home shows 5 task cards | ✅ |
| Sample electricity-bill PDF → read aloud in Telugu: amount ₹840, due date + days left, 142 units, consumer no. 1234567890 | ✅ |
| "Pay this bill" from reader → number read-back → review shows ₹840 | ✅ |
| Scam letter PDF → scam warning, Pay button hidden | ✅ |
| Water-bill **photo** (OCR) → ₹410, consumer 55667788 | ✅ |
| Voice: "बिजली का बिल पढ़कर सुनाओ" opens the reader, not bill payment | ✅ |
| Help sheet: family confirm shows `tel:` link to trusted contact + video option; fraud screen has `tel:1930`; volunteer request reaches dashboard (fraud requests sorted first) | ✅ |
| Previous regressions (login, voice, real-voice simulation, Back navigation, PIN, dark mode) re-run | ✅ |
| No JavaScript errors | ✅ |

### 1.3d Top navigation + History (round 9)
| Check | Result |
|---|---|
| Desktop (1470 × 830): Home · Back · Repeat · History · Help in one top bar, settings row below, mic panel on the right; phone layout unchanged | ✅ |
| History shows paid / failed / stopped counts, total paid, and tasks left half-way (English, Hindi, Telugu) | ✅ |
| Failed reasons: over daily limit, PIN wrong 3 times; stopped reasons with stage (confirm / hold / PIN / countdown) and "left before confirming" | ✅ (backend tests) |
| Voice: "show my payments", "मेरे पिछले भुगतान दिखाओ", "నా చెల్లింపులు చూపించు" open History; "failed / नहीं हुए / కాలేదు", "stopped", "paid", "all" filter it and read it aloud | ✅ |
| History pressed in the middle of a bill → task recorded as "left half-way at Enter consumer no." | ✅ |
| "Try again" on a stopped bill → bill payment with the number already filled and read back | ✅ |
| A senior sees only their own history; volunteer sees all or one senior | ✅ |
| Volunteer dashboard payment & session log with filters | ✅ |
| All earlier browser regressions + 23 / 51 voice tests | ✅ |

### 1.4 Accessibility checklist

| Check | Status |
|---|---|
| All prompts spoken aloud; Repeat always available | ✅ |
| Every action possible by voice **and** by touch | ✅ |
| Text scalable 100–200 % (A−/A+) | ✅ |
| Dark mode (soft dark theme, readable contrast) | ✅ |
| Main touch targets ≥ 64 px (settings ≥ 48 px); yes/no ≥ 96 px; generous spacing | ✅ |
| Hold-to-confirm prevents accidental payment taps | ✅ |
| Physical buttons with tremor filtering (ESP32) | ✅ |
| Works offline for fonts (bundled Noto Sans Telugu/Devanagari) | ✅ |
| Reduced-motion respected | ✅ |

---

## Part 2 · Speech recognition field test (to run)

### 2.1 Method
- **Testers:** at least 20 people, ideally 60+ years old, across: Telangana Telugu, Coastal Andhra Telugu, Rayalaseema Telugu, Hyderabadi Hindi/Urdu, North-Indian Hindi, South-Indian English.
- **Sentences:** the 9 fixed sentences per language in `/speech-test` (task commands, a 10-digit number, yes, no).
- **Noise levels** (measure with a phone dB meter at the speaker's position):
  - Quiet < 40 dB · Fan/TV 50–60 dB · Street/market 65–75 dB
- **Device:** same phone model, held at ~30 cm.
- **Metrics:**
  - **Word accuracy** = 1 − WER
  - **Character accuracy** = 1 − CER (fairer for Telugu, where suffixes join words)
  - **Intent accuracy** = % of command sentences where the detected task is correct — *the metric that matters most for the user*
  - **Task success** (separately): % of seniors who finish each task without volunteer help, and time taken.

### 2.2 Results by accent × noise (fill from the `/speech-test` table)

| Language | Accent | Noise | Recordings | Word acc. | Char acc. | Intent acc. |
|---|---|---|---|---|---|---|
| Telugu | Telangana | Quiet | | | | |
| Telugu | Telangana | Fan/TV | | | | |
| Telugu | Telangana | Street | | | | |
| Telugu | Coastal Andhra | Quiet | | | | |
| Telugu | Rayalaseema | Quiet | | | | |
| Hindi | Hyderabadi | Quiet | | | | |
| Hindi | Hyderabadi | Fan/TV | | | | |
| Hindi | North Indian | Quiet | | | | |
| English | South Indian | Quiet | | | | |
| English | South Indian | Street | | | | |

### 2.3 Task success with seniors

| Task | Testers | Completed without help | Avg. time | Most common stuck step (from dashboard) |
|---|---|---|---|---|
| Bill payment | | | | |
| Ticket booking | | | | |
| Video call | | | | |

### 2.4 What to write in the conclusion
- Which accent/noise combinations fell below your target (e.g. intent accuracy < 90 %).
- Which phrases appeared in the dashboard's *not understood* list, and which words you added to the vocabulary.
- Re-test after adding vocabulary and show the before/after improvement — this demonstrates the system learning from the dashboard.
