"""Automated tests for the Saathi backend.  Run:  python -m pytest -q"""
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as saathi  # noqa: E402
import db  # noqa: E402
from intents import detect_intent, detect_yes_no  # noqa: E402
from scam_checker import check_text  # noqa: E402
from speech_eval import cer, wer  # noqa: E402


TOKEN = "test-csrf-token"


def pin_csrf(c):
    """Give the test browser a known CSRF token (sent automatically as the X-CSRF-Token header)."""
    with c.session_transaction() as sess:
        sess["_csrf"] = TOKEN
    c.environ_base["HTTP_X_CSRF_TOKEN"] = TOKEN


def as_senior(c, phone="9000000001", pin="1234"):
    pin_csrf(c)
    r = c.post("/login/senior", data={"phone": phone, "pin": pin})
    pin_csrf(c)                    # login starts a fresh session
    return r


def as_volunteer(c, email="volunteer@saathi.in", password="saathi123"):
    pin_csrf(c)
    r = c.post("/login/volunteer", data={"email": email, "password": password})
    pin_csrf(c)
    return r


@pytest.fixture()
def anon(tmp_path):
    """A client that is not logged in."""
    path = str(tmp_path / "test.db")
    db.HASH_METHOD = "pbkdf2:sha256:1000"      # fast hashing in tests only; the app uses the strong default
    db.init_db(path, demo=False)
    saathi.app.config.update(TESTING=True, DB_PATH=path)
    with saathi.app.test_client() as c:
        yield c


@pytest.fixture()
def client(anon):
    """A client logged in as the demo senior citizen (Lakshmi, user 1)."""
    as_senior(anon)
    return anon


# ---------------- security ----------------
def test_csrf_required(client):
    client.environ_base.pop("HTTP_X_CSRF_TOKEN")
    r = client.post("/api/action/prepare", json={"type": "bill", "payee": "X", "amount": 50})
    assert r.status_code == 403 and r.get_json()["error"] == "csrf_failed"
    client.environ_base["HTTP_X_CSRF_TOKEN"] = "wrong"
    assert client.post("/api/log", json={"event": "start"}).status_code == 403


def test_login_form_needs_csrf(anon):
    r = anon.post("/login/senior", data={"phone": "9000000001", "pin": "1234"})
    assert r.status_code == 400


def test_lockout_after_5_wrong_pins(anon):
    for _ in range(5):
        r = as_senior(anon, pin="0000")
        assert b"Mobile number or PIN is wrong" in r.data
    r = as_senior(anon, pin="1234")                      # even the right PIN is refused while locked
    assert r.status_code == 200 and b"locked" in r.data
    assert anon.get("/api/me").status_code == 401
    as_senior(anon, phone="9000000002")                  # other accounts are not affected
    assert anon.get("/api/me").get_json()["name"] == "Ramesh"


def test_security_headers(anon):
    h = anon.get("/").headers
    assert "frame-ancestors 'none'" in h["Content-Security-Policy"]
    assert h["X-Frame-Options"] == "DENY" and h["X-Content-Type-Options"] == "nosniff"
    assert "microphone=(self" in h["Permissions-Policy"]


def test_idle_logout(client):
    with client.session_transaction() as sess:
        sess["_seen"] = "2020-01-01T00:00:00"
    assert client.get("/api/me").status_code == 401
    r = client.get("/login/senior")
    assert b"logged out after some time" in r.data


def test_payment_pin_for_big_amounts(client, monkeypatch):
    monkeypatch.setattr(saathi, "CONFIRM_MIN_SECONDS", 0)
    small = prepare(client, amount=500)
    assert small["pin_required"] is False
    big = prepare(client, amount=1500)
    assert big["pin_required"] is True
    ok = {"pending_id": big["pending_id"], "first_confirm": True, "hold_confirm": True}
    r = client.post("/api/action/confirm", json=ok | {"pin": "0000"})
    assert r.status_code == 422 and r.get_json()["tries_left"] == 2
    assert client.post("/api/action/confirm", json=ok | {"pin": "1234"}).status_code == 200


def test_payment_blocked_after_3_wrong_pins(client, monkeypatch):
    monkeypatch.setattr(saathi, "CONFIRM_MIN_SECONDS", 0)
    big = prepare(client, amount=2000)
    ok = {"pending_id": big["pending_id"], "first_confirm": True, "hold_confirm": True, "pin": "1111"}
    assert client.post("/api/action/confirm", json=ok).status_code == 422
    assert client.post("/api/action/confirm", json=ok).status_code == 422
    r = client.post("/api/action/confirm", json=ok)
    assert r.status_code == 403 and r.get_json()["error"] == "pin_blocked"
    assert client.post("/api/action/confirm", json=ok | {"pin": "1234"}).status_code == 409   # stays blocked


def test_device_token(anon, monkeypatch):
    import security
    monkeypatch.setattr(security, "DEVICE_TOKEN", "s3cret")
    assert anon.post("/api/device/button", json={"button": "yes"}).status_code == 401
    assert anon.post("/api/device/button", json={"button": "yes"}, headers={"X-Device-Token": "s3cret"}).status_code == 200


def test_audit_log(anon):
    as_senior(anon, pin="0000"); as_senior(anon)
    conn = db.connect(saathi.app.config["DB_PATH"])
    events = [r["event"] for r in conn.execute("SELECT event FROM security_events ORDER BY id")]
    assert events[:2] == ["login_fail", "login_ok"]


# ---------------- login & roles ----------------
def test_pages_need_login(anon):
    assert anon.get("/").status_code == 200                      # landing page is public
    assert "/login/senior" in anon.get("/app").headers["Location"]
    assert "/login/volunteer" in anon.get("/volunteer").headers["Location"]
    assert "/login/volunteer" in anon.get("/speech-test").headers["Location"]
    assert anon.get("/api/me").status_code == 401
    assert anon.post("/api/action/prepare", json={}).status_code == 403   # no CSRF token → refused first
    pin_csrf(anon)
    assert anon.post("/api/action/prepare", json={}).status_code == 401   # token but not logged in


def test_voice_check_is_public(anon):
    r = anon.get("/voice-check")
    assert r.status_code == 200 and b"Voice Check" in r.data


def test_senior_login(anon):
    r = as_senior(anon)
    assert r.status_code == 302 and r.headers["Location"].endswith("/app")
    assert anon.get("/app").status_code == 200
    me = anon.get("/api/me").get_json()
    assert me["name"] == "Lakshmi" and "pin_hash" not in me


def test_wrong_pin_rejected(anon):
    r = as_senior(anon, pin="0000")
    assert r.status_code == 200 and b"Mobile number or PIN is wrong" in r.data
    assert anon.get("/api/me").status_code == 401


def test_volunteer_login(anon):
    assert as_volunteer(anon, password="nope").status_code == 200
    r = as_volunteer(anon)
    assert r.status_code == 302 and r.headers["Location"].endswith("/volunteer")
    assert anon.get("/volunteer").status_code == 200
    assert anon.get("/api/dashboard").status_code == 200


def test_roles_are_separate(anon):
    as_senior(anon)
    assert anon.get("/api/dashboard").status_code == 401          # senior cannot open dashboard
    assert anon.get("/api/contacts/2").status_code == 403         # nor another senior's contacts
    as_volunteer(anon)
    assert anon.post("/api/action/prepare", json={"type": "bill", "payee": "X", "amount": 5}).status_code == 401


def test_logout(client):
    client.get("/logout")
    assert client.get("/api/me").status_code == 401


def test_language_saved(client):
    assert client.post("/api/me/language", json={"language": "hi"}).status_code == 200
    assert client.get("/api/me").get_json()["language"] == "hi"


def test_payment_is_for_logged_in_user(client, monkeypatch):
    monkeypatch.setattr(saathi, "CONFIRM_MIN_SECONDS", 0)
    p = prepare(client)
    client.get("/logout")
    as_senior(client, phone="9000000002")                         # someone else
    r = client.post("/api/action/confirm", json={"pending_id": p["pending_id"], "first_confirm": True, "hold_confirm": True})
    assert r.status_code == 409


# ---------------- intent detection (multilingual) ----------------
@pytest.mark.parametrize("text,intent", [
    ("I want to pay my electricity bill", "bill"),
    ("mujhe bijli ka bill bharna hai", "bill"),
    ("मुझे बिजली का बिल भरना है", "bill"),
    ("నేను కరెంట్ బిల్లు చెల్లించాలి", "bill"),
    ("నీళ్ళ బిల్లు కట్టాలి", "bill"),
    ("Book a train ticket to Tirupati", "ticket"),
    ("तिरुपति के लिए ट्रेन का टिकट बुक करो", "ticket"),
    ("రేపటికి బస్సు టికెట్ బుక్ చేయండి", "ticket"),
    ("Make a video call to my son", "call"),
    ("मेरे बेटे को वीडियो कॉल करो", "call"),
    ("మా అబ్బాయికి వీడియో కాల్ చేయండి", "call"),
    ("Check this message for fraud", "scam_check"),
    ("ఈ మెసేజ్ మోసమా చూడండి", "scam_check"),
    ("मदद चाहिए", "help"),
])
def test_intents(text, intent):
    assert detect_intent(text)[0] == intent


def test_unknown_intent():
    assert detect_intent("the weather is nice")[0] is None


@pytest.mark.parametrize("text,ans", [("yes", "yes"), ("हाँ", "yes"), ("అవును", "yes"), ("no", "no"),
                                      ("नहीं", "no"), ("వద్దు", "no"), ("hmm", None)])
def test_yes_no(text, ans):
    assert detect_yes_no(text) == ans


# ---------------- scam detection ----------------
@pytest.mark.parametrize("msg", [
    "Dear customer your account will be blocked today. Update KYC at http://bit.ly/abc and share OTP",
    "Congratulations! You have won a lottery of Rs 25 lakh. Call this number immediately",
    "प्रिय ग्राहक, आपका खाता आज बंद हो जाएगा। तुरंत KYC अपडेट करें और OTP बताएं",
    "మీ ఖాతా బ్లాక్ అవుతుంది. వెంటనే ఓటీపీ చెప్పండి",
    "Install AnyDesk so our bank officer can help you",
    "This is customs. A parcel in your name has drugs, you are under digital arrest",
])
def test_scams_detected(msg):
    assert check_text(msg)["level"] in ("danger", "caution")


def test_normal_messages_safe():
    for msg in ["Amma, I will reach home by 7 pm", "Your electricity bill of Rs 840 is due on 15th",
                "బాగున్నారా? రేపు కలుద్దాం"]:
        assert check_text(msg)["level"] == "safe", msg


# ---------------- WER / CER ----------------
def test_wer_basic():
    assert wer("pay my electricity bill", "pay my electricity bill") == 0
    assert wer("pay my electricity bill", "pay my bill") == 0.25
    assert wer("nine eight seven", "987") == 0          # number words and digits compare equal


def test_cer_telugu():
    assert cer("కరెంట్ బిల్లు", "కరెంటు బిల్లు") < 0.2


# ---------------- safe payment flow ----------------
def prepare(client, amount=840, payee="City Electricity Board"):
    return client.post("/api/action/prepare", json={"user_id": 1, "type": "bill", "payee": payee,
                                                     "amount": amount, "details": {"category": "electricity"}}).get_json()


def test_payment_needs_both_confirmations(client, monkeypatch):
    monkeypatch.setattr(saathi, "CONFIRM_MIN_SECONDS", 0)
    p = prepare(client)
    r = client.post("/api/action/confirm", json={"pending_id": p["pending_id"], "first_confirm": True, "hold_confirm": False})
    assert r.status_code == 400 and r.get_json()["error"] == "confirmation_missing"
    r = client.post("/api/action/confirm", json={"pending_id": p["pending_id"], "first_confirm": True, "hold_confirm": True})
    assert r.status_code == 200 and r.get_json()["ok"]


def test_payment_too_fast_is_refused(client):
    p = prepare(client)
    r = client.post("/api/action/confirm", json={"pending_id": p["pending_id"], "first_confirm": True, "hold_confirm": True})
    assert r.get_json()["error"] == "too_fast"


def test_cannot_pay_twice(client, monkeypatch):
    monkeypatch.setattr(saathi, "CONFIRM_MIN_SECONDS", 0)
    p = prepare(client)
    ok = {"pending_id": p["pending_id"], "first_confirm": True, "hold_confirm": True}
    assert client.post("/api/action/confirm", json=ok).status_code == 200
    assert client.post("/api/action/confirm", json=ok).status_code == 409


def test_cancelled_payment_cannot_be_confirmed(client, monkeypatch):
    monkeypatch.setattr(saathi, "CONFIRM_MIN_SECONDS", 0)
    p = prepare(client)
    client.post("/api/action/cancel", json={"pending_id": p["pending_id"]})
    r = client.post("/api/action/confirm", json={"pending_id": p["pending_id"], "first_confirm": True, "hold_confirm": True})
    assert r.status_code == 409


def test_over_limit_blocked(client, monkeypatch):
    monkeypatch.setattr(saathi, "CONFIRM_MIN_SECONDS", 0)
    p = prepare(client, amount=9000)
    assert p["blocked"] and any(w["key"] == "over_limit" for w in p["warnings"])
    r = client.post("/api/action/confirm", json={"pending_id": p["pending_id"], "first_confirm": True, "hold_confirm": True})
    assert r.status_code == 403


def test_new_payee_warning(client):
    keys = [w["key"] for w in prepare(client, payee="Unknown Person")["warnings"]]
    assert "new_payee" in keys
    keys = [w["key"] for w in prepare(client, payee="City Electricity Board")["warnings"]]
    assert "new_payee" not in keys


# ---------------- mock services ----------------
def test_bill_lookup(client):
    r = client.get("/api/bill?category=electricity&consumer=1234567890").get_json()
    assert r["amount"] == 840
    assert client.get("/api/bill?category=electricity&consumer=12").status_code == 400


def test_journeys(client):
    r = client.get("/api/journeys?mode=train&from=hyderabad&to=tirupati&date=2026-10-10").get_json()
    assert len(r) == 3 and all(o["fare"] > 0 for o in r)
    assert client.get("/api/journeys?mode=train&from=hyderabad&to=hyderabad").status_code == 400


# ---------------- logging, help, dashboard, device ----------------
def test_dashboard_tracks_dropoff_and_help(client):
    for ev, step in [("start", "start"), ("step", "category"), ("step", "consumer"),
                     ("not_understood", "consumer"), ("not_understood", "consumer"), ("abandon", "consumer")]:
        client.post("/api/log", json={"session_id": "s1", "user_id": 1, "task": "bill", "step": step, "event": ev, "lang": "te",
                                      "detail": {"heard": "తొమ్మిది"} if ev == "not_understood" else None})
    client.post("/api/help", json={"user_id": 1, "session_id": "s1", "task": "bill", "step": "consumer", "lang": "te"})
    as_volunteer(client)
    d = client.get("/api/dashboard").get_json()
    assert d["kpis"]["sessions"] == 1 and d["kpis"]["open_help"] == 1
    top = d["trouble"][0]
    assert top["step"] == "consumer" and top["dropoffs"] == 1 and top["retries"] == 2
    assert d["asr_fails"][0]["heard"] == "తొమ్మిది"


def test_hint_delivered_once(client):
    hid = client.post("/api/help", json={"user_id": 1, "task": "bill", "step": "consumer"}).get_json()["id"]
    as_volunteer(client)
    client.post(f"/api/help/{hid}/hint", json={"hint": "Press YES"})
    as_senior(client)
    assert client.get("/api/poll?user_id=1&after=1").get_json()["hints"] == ["Press YES"]
    assert client.get("/api/poll?user_id=1&after=1").get_json()["hints"] == []


def test_device_buttons(client):
    first = client.get("/api/poll?user_id=1&after=-1").get_json()["last_id"]
    client.post("/api/device/button", json={"device_id": "remote-01", "button": "yes"})
    r = client.get(f"/api/poll?user_id=1&after={first}").get_json()
    assert r["buttons"] == ["yes"]
    assert client.post("/api/device/button", json={"button": "explode"}).status_code == 400


def test_speech_test_endpoint(client):
    as_volunteer(client)
    r = client.post("/api/speechtest", json={"language": "te", "accent": "Telangana", "noise": "Quiet",
                                             "expected": "నేను కరెంట్ బిల్లు చెల్లించాలి",
                                             "heard": "నేను కరెంటు బిల్లు చెల్లించాలి", "expected_intent": "bill"}).get_json()
    assert r["intent_ok"] and r["wer"] == 0.25
    s = client.get("/api/speechtest/summary").get_json()
    assert s["total"] == 1 and s["groups"][0]["intent_accuracy"] == 100.0


# ---------------- bill / document reader ----------------
import io  # noqa: E402

SAMPLES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "samples")


def upload(c, name=None, text=None, data=None):
    form = {}
    if name:
        form["file"] = (open(os.path.join(SAMPLES, name), "rb"), name)
    if data is not None:
        form["file"] = (io.BytesIO(data), "x.bin")
    if text:
        form["text"] = text
    return c.post("/api/doc/read", data=form, content_type="multipart/form-data")


def test_reads_sample_pdf_bill(client):
    r = upload(client, "sample_electricity_bill.pdf")
    d = r.get_json()
    assert r.status_code == 200 and d["source"] == "pdf"
    assert d["kind"] == "electricity" and d["amount"] == 840 and d["number"] == "1234567890"
    assert d["units"] == 142 and d["days_left"] == 6 and d["payable"] is True
    assert d["scam"]["level"] == "safe" and "Electricity Board" in d["biller"]


def test_scam_letter_is_flagged(client):
    d = upload(client, "sample_scam_message.pdf").get_json()
    assert d["scam"]["level"] == "danger"


def test_pasted_text_and_dates():
    import doc_reader
    from datetime import date
    d = doc_reader.explain("Mobile Postpaid Bill\nMobile No: 9876543210\nBill Amount: Rs 299\nPay by 15-Oct-2026", today=date(2026, 10, 10))
    assert d["kind"] == "mobile" and d["amount"] == 299 and d["number"] == "9876543210" and d["days_left"] == 5


def test_photo_bill_or_clear_message(client):
    import doc_reader
    r = upload(client, "sample_water_bill_photo.png")
    if doc_reader.ocr_available():
        d = r.get_json()
        assert r.status_code == 200 and d["kind"] == "water" and d["amount"] == 410
    else:
        assert r.status_code == 422 and r.get_json()["error"] == "ocr_unavailable"


def test_bad_upload(client):
    assert upload(client, data=b"hello not a pdf").get_json()["error"] == "bad_type"
    assert upload(client).get_json()["error"] == "empty"


def test_doc_needs_login_and_csrf(anon):
    assert anon.post("/api/doc/read", data={"text": "x"}).status_code == 403     # no CSRF token
    pin_csrf(anon)
    assert anon.post("/api/doc/read", data={"text": "x"}).status_code == 401     # not logged in


# ---------------- trusted contact help ----------------
def test_trusted_contact_in_profile(client):
    me = client.get("/api/me").get_json()
    assert me["trusted"]["name"] == "Ravi" and me["trusted"]["relation"] == "son"


def test_help_kinds(client):
    client.post("/api/help", json={"task": "bill", "step": "confirm", "kind": "family"})
    client.post("/api/help", json={"task": "bill", "step": "confirm", "kind": "fraud"})
    client.post("/api/help", json={"task": "bill", "step": "confirm"})
    as_volunteer(client)
    queue = client.get("/api/dashboard").get_json()["help"]
    assert [h["kind"] for h in queue] == ["fraud", "volunteer"]      # family calls are not queued; fraud comes first


# ---------------- history: payments made, failed, stopped ----------------
def test_history_shows_paid_failed_and_stopped(client, monkeypatch):
    monkeypatch.setattr(saathi, "CONFIRM_MIN_SECONDS", 0)
    p = prepare(client, amount=200)                                   # paid
    assert client.post("/api/action/confirm", json={"pending_id": p["pending_id"], "first_confirm": True, "hold_confirm": True}).get_json()["ok"]
    p = prepare(client, amount=300)                                   # stopped at the countdown
    client.post("/api/action/cancel", json={"pending_id": p["pending_id"], "stage": "countdown"})
    prepare(client, amount=9000)                                      # failed: over the daily limit
    h = client.get("/api/history").get_json()
    by_amt = {x["amount"]: x for x in h["payments"]}
    assert by_amt[200]["outcome"] == "paid"
    assert by_amt[300]["outcome"] == "stopped" and by_amt[300]["stage"] == "countdown" and by_amt[300]["reason"] == "user_cancelled"
    assert by_amt[9000]["outcome"] == "failed" and by_amt[9000]["reason"] == "limit"
    assert h["summary"]["paid"] >= 1 and h["summary"]["failed"] >= 1 and h["summary"]["stopped"] >= 1


def test_history_pin_blocked_is_failed(client, monkeypatch):
    monkeypatch.setattr(saathi, "CONFIRM_MIN_SECONDS", 0)
    p = prepare(client, amount=1500)
    for _ in range(3):
        client.post("/api/action/confirm", json={"pending_id": p["pending_id"], "first_confirm": True, "hold_confirm": True, "pin": "0000"})
    x = next(x for x in client.get("/api/history").get_json()["payments"] if x["id"] == p["pending_id"])
    assert x["outcome"] == "failed" and x["reason"] == "pin_blocked" and x["stage"] == "pin"


def test_history_old_pending_counts_as_left(client):
    p = prepare(client, amount=250)
    conn = db.connect(saathi.app.config["DB_PATH"])
    conn.execute("UPDATE transactions SET created_at='2020-01-01T10:00:00' WHERE id=?", (p["pending_id"],)); conn.commit(); conn.close()
    x = next(x for x in client.get("/api/history").get_json()["payments"] if x["id"] == p["pending_id"])
    assert x["outcome"] == "stopped" and x["reason"] == "left"


def test_history_unfinished_task_and_privacy(client, anon):
    for ev, step in (("start", "start"), ("step", "category"), ("step", "consumer")):
        client.post("/api/log", json={"session_id": "s-hist1", "task": "bill", "step": step, "event": ev, "lang": "en"})
    client.post("/api/log", json={"session_id": "s-hist1", "task": "bill", "step": "consumer", "event": "abandon", "detail": {"reason": "home"}, "lang": "en"})
    h = client.get("/api/history").get_json()
    u = next(s for s in h["unfinished"] if s["session_id"] == "s-hist1")
    assert u["step"] == "consumer" and u["reason"] == "home" and u["task_label"] == "Bill Payment"
    assert all(x["user_id"] == 1 for x in h["payments"])            # a senior only sees their own


def test_history_volunteer_can_filter_by_senior(anon):
    as_volunteer(anon)
    h = anon.get("/api/history?user_id=1").get_json()
    assert all(x["user_id"] == 1 for x in h["payments"])
    assert anon.get("/api/history").status_code == 200


def test_history_needs_login(anon):
    assert anon.get("/api/history", headers={"Accept": "application/json"}).status_code == 401
