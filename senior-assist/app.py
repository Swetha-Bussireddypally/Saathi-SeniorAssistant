"""Saathi — voice-first digital assistant for senior citizens (SIH prototype).

Run:  python app.py      then open  http://localhost:5000            (login page)
      Senior citizens sign in with mobile number + 4-digit PIN  →  /app
      Volunteers sign in with email + password                  →  /volunteer, /speech-test
"""
import csv
import hashlib
import io
import json
import math
import os
import random
import secrets
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, Response, g, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash

import db
import doc_reader
import security
from config import (APP_NAME, CITIES, CONFIRM_MIN_SECONDS, JITSI_DOMAIN, LANG_LABELS,
                    STEP_LABELS, STUCK_RETRY_THRESHOLD, TASK_LABELS, TASK_STEPS)
from intents import detect_intent, detect_yes_no
from scam_checker import check_payment, check_text
from speech_eval import cer, wer

app = Flask(__name__)


def _secret_key():
    """Keeps logins valid across restarts: read SECRET_KEY or a key file created on first run."""
    if os.environ.get("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".secret_key")
    if not os.path.exists(path):
        with open(path, "w") as f:
            f.write(secrets.token_hex(32))
    with open(path) as f:
        return f.read().strip()


app.secret_key = _secret_key()
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                  SESSION_COOKIE_SECURE=os.environ.get("HTTPS", "0") == "1",   # set HTTPS=1 when served over https
                  PERMANENT_SESSION_LIFETIME=timedelta(days=7),
                  MAX_CONTENT_LENGTH=8 * 1024 * 1024)                         # bill photos/PDFs up to 8 MB


@app.before_request
def _security_checks():
    security.check_idle()
    return security.check_csrf()


@app.after_request
def _security_headers(resp):
    return security.add_headers(resp, JITSI_DOMAIN)


@app.context_processor
def _inject_csrf():
    return {"csrf_token": security.csrf_token}


# ---------------------------------------------------------------- database helpers
def get_db():
    if "db" not in g:
        g.db = db.connect(app.config.get("DB_PATH"))
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def body():
    return request.get_json(silent=True) or {}


def new_ref(prefix="SA"):
    return f"{prefix}-{uuid.uuid4().hex[:6].upper()}"


# ---------------------------------------------------------------- login & roles
def role():
    return session.get("role")


def senior_id():
    return session.get("uid") if role() == "senior" else None


def _wants_json():
    return request.path.startswith("/api/")


def login_required(*roles):
    """Protects a page (redirects to the right login page) or an API (401/403 JSON)."""
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            if role() not in roles:
                if _wants_json():
                    return jsonify(error="login_required"), 401
                target = "login_volunteer" if roles == ("volunteer",) else "login_senior"
                return redirect(url_for(target, next=request.path))
            return fn(*a, **kw)
        return wrapper
    return deco


def _safe_next(default):
    nxt = request.args.get("next") or request.form.get("next") or ""
    return nxt if nxt.startswith("/") and not nxt.startswith("//") else default


@app.route("/")
def landing():
    who = None
    if role() == "senior":
        u = get_db().execute("SELECT name FROM users WHERE id=?", (senior_id(),)).fetchone()
        who = ("senior", u["name"] if u else "")
    elif role() == "volunteer":
        who = ("volunteer", session.get("name", ""))
    return render_template("landing.html", app_name=APP_NAME, who=who)


@app.route("/login/senior", methods=["GET", "POST"])
def login_senior():
    error = None
    phone = ""
    if request.method == "POST":
        phone = "".join(ch for ch in request.form.get("phone", "") if ch.isdigit())[-10:]
        pin = request.form.get("pin", "").strip()
        conn = get_db()
        key = "senior:" + phone
        wait = security.locked_for(conn, key)
        if wait:
            security.audit(conn, key, "locked", f"{wait}s left")
            error = "locked"
            lock_minutes = max(1, (wait + 59) // 60)
        else:
            u = conn.execute("SELECT * FROM users WHERE phone=?", (phone,)).fetchone()
            ok = bool(u and u["pin_hash"] and check_password_hash(u["pin_hash"], pin))
            security.record_login(conn, key, ok)
            security.audit(conn, key, "login_ok" if ok else "login_fail")
            if ok:
                session.clear()                       # new session = no session-fixation
                session.permanent = True
                session.update(role="senior", uid=u["id"], name=u["name"])
                return redirect(_safe_next(url_for("senior_app")))
            error = "wrong"
    expired = session.pop("_expired", False)
    return render_template("login_senior.html", app_name=APP_NAME, error=error, phone=phone,
                           expired=expired, lock_minutes=locals().get("lock_minutes", security.LOCK_MINUTES),
                           demo=[(r["name"], r["phone"]) for r in get_db().execute(
                               "SELECT name, phone FROM users WHERE phone IS NOT NULL ORDER BY id")],
                           demo_pin=db.DEMO_PIN, next=request.args.get("next", ""))


@app.route("/login/volunteer", methods=["GET", "POST"])
def login_volunteer():
    error = None
    email = ""
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        conn = get_db()
        key = "volunteer:" + email
        wait = security.locked_for(conn, key)
        if wait:
            security.audit(conn, key, "locked", f"{wait}s left")
            error = f"Too many wrong attempts. Please wait {max(1, (wait + 59) // 60)} minute(s) and try again."
        else:
            v = conn.execute("SELECT * FROM volunteers WHERE email=?", (email,)).fetchone()
            ok = bool(v and check_password_hash(v["password_hash"], request.form.get("password", "")))
            security.record_login(conn, key, ok)
            security.audit(conn, key, "login_ok" if ok else "login_fail")
            if ok:
                session.clear()
                session.permanent = True
                session.update(role="volunteer", uid=v["id"], name=v["name"])
                return redirect(_safe_next(url_for("volunteer")))
            error = "Email or password is not correct."
    if session.pop("_expired", False) and not error:
        error = "You were logged out because there was no activity for a while. Please sign in again."
    return render_template("login_volunteer.html", app_name=APP_NAME, error=error, email=email,
                           demo=db.DEMO_VOLUNTEERS[0], next=request.args.get("next", ""))


@app.route("/voice-check")
def voice_check():
    """Public page: tests browser, microphone, internet, speech recognition and voices, with fixes."""
    return render_template("voice_check.html", app_name=APP_NAME)


@app.route("/logout")
def logout():
    if session.get("role"):
        security.audit(get_db(), f'{session.get("role")}:{session.get("uid")}', "logout")
    session.clear()
    return redirect(url_for("landing"))


# ---------------------------------------------------------------- pages
@app.route("/app")
@login_required("senior")
def senior_app():
    u = get_db().execute("SELECT id, name, language, avatar FROM users WHERE id=?", (senior_id(),)).fetchone()
    if not u:
        session.clear()
        return redirect(url_for("login_senior"))
    return render_template("senior.html", app_name=APP_NAME, jitsi_domain=JITSI_DOMAIN, user=u)


@app.route("/volunteer")
@login_required("volunteer")
def volunteer():
    return render_template("volunteer.html", app_name=APP_NAME, volunteer_name=session.get("name"))


@app.route("/speech-test")
@login_required("volunteer")
def speech_test():
    return render_template("speech_test.html", app_name=APP_NAME, volunteer_name=session.get("name"))


# ---------------------------------------------------------------- user & contacts
@app.get("/api/me")
@login_required("senior")
def me():
    return get_user(senior_id())


@app.post("/api/me/language")
@login_required("senior")
def me_language():
    lang = body().get("language")
    if lang not in LANG_LABELS:
        return jsonify(error="bad language"), 400
    conn = get_db()
    conn.execute("UPDATE users SET language=? WHERE id=?", (lang, senior_id()))
    conn.commit()
    return jsonify(ok=True)


def _own_or_volunteer(user_id):
    return role() == "volunteer" or senior_id() == user_id


@app.get("/api/user/<int:user_id>")
@login_required("senior", "volunteer")
def get_user(user_id):
    if not _own_or_volunteer(user_id):
        return jsonify(error="forbidden"), 403
    conn = get_db()
    u = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not u:
        return jsonify(error="not found"), 404
    saved = {r["category"]: r["consumer_no"] for r in conn.execute(
        "SELECT category, consumer_no FROM saved_billers WHERE user_id=?", (user_id,))}
    u = {k: u[k] for k in u.keys() if k != "pin_hash"}
    t = conn.execute("SELECT id, name, relation, phone, color FROM contacts WHERE user_id=? AND trusted=1",
                     (user_id,)).fetchone()
    return jsonify(u | {"saved_billers": saved, "trusted": dict(t) if t else None})


@app.get("/api/contacts/<int:user_id>")
@login_required("senior", "volunteer")
def contacts(user_id):
    if not _own_or_volunteer(user_id):
        return jsonify(error="forbidden"), 403
    rows = get_db().execute("SELECT * FROM contacts WHERE user_id=? ORDER BY id", (user_id,))
    return jsonify([dict(r) for r in rows])


# ---------------------------------------------------------------- AI layer
@app.post("/api/intent")
@login_required("senior", "volunteer")
def api_intent():
    text = body().get("text", "")
    intent, conf, matched = detect_intent(text)
    return jsonify(intent=intent, confidence=conf, matched=matched, scam=check_text(text))


@app.post("/api/yesno")
@login_required("senior", "volunteer")
def api_yesno():
    return jsonify(answer=detect_yes_no(body().get("text", "")))


@app.post("/api/scam/check")
@login_required("senior", "volunteer")
def api_scam():
    return jsonify(check_text(body().get("text", "")))


# ---------------------------------------------------------------- mock bill service
BOARDS = {"electricity": "City Electricity Board", "water": "City Water Board",
          "mobile": "Mobile Postpaid"}


@app.get("/api/bill")
@login_required("senior", "volunteer")
def api_bill():
    cat = request.args.get("category", "electricity")
    num = "".join(ch for ch in request.args.get("consumer", "") if ch.isdigit())
    if cat not in BOARDS or not (6 <= len(num) <= 12):
        return jsonify(error="invalid"), 400
    row = get_db().execute("SELECT * FROM bills WHERE consumer_no=? AND category=?",
                           (num, cat)).fetchone()
    if row:
        return jsonify(dict(row))
    # Any other number gets a stable pretend bill so the demo works with any input.
    h = int(hashlib.sha1(f"{cat}{num}".encode()).hexdigest(), 16)
    amount = {"electricity": 300 + h % 1700, "water": 150 + h % 600, "mobile": 199 + h % 500}[cat]
    due = (datetime.now() + timedelta(days=3 + h % 12)).date().isoformat()
    return jsonify(consumer_no=num, category=cat, board=BOARDS[cat], customer_name=None,
                   amount=amount, due_date=due)


# ---------------------------------------------------------------- mock ticket service
def _distance_km(a, b):
    (_, la1, lo1), (_, la2, lo2) = CITIES[a], CITIES[b]
    p1, p2 = math.radians(la1), math.radians(la2)
    dphi, dl = math.radians(la2 - la1), math.radians(lo2 - lo1)
    x = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(x)) * 1.25        # road/rail is ~25% longer


@app.get("/api/journeys")
@login_required("senior", "volunteer")
def api_journeys():
    mode = request.args.get("mode", "train")
    src, dst = request.args.get("from"), request.args.get("to")
    date = request.args.get("date", datetime.now().date().isoformat())
    if src not in CITIES or dst not in CITIES or src == dst or mode not in ("bus", "train"):
        return jsonify(error="invalid"), 400
    km = _distance_km(src, dst)
    rnd = random.Random(f"{mode}{src}{dst}{date}")
    speed = 55 if mode == "train" else 50
    names = (["Deccan Express", "Godavari Superfast", "Konark Mail", "Charminar Express",
              "Krishna Passenger"] if mode == "train" else
             ["Garuda AC Sleeper", "Super Luxury", "Express Non-AC", "Rajadhani AC", "Indra AC Seater"])
    rnd.shuffle(names)
    opts = []
    for i, dep_h in enumerate(sorted(rnd.sample([6, 8, 11, 14, 17, 20, 22], 3))):
        dep = datetime.fromisoformat(date) + timedelta(hours=dep_h, minutes=rnd.choice([0, 15, 30, 45]))
        dur = timedelta(hours=km / speed * rnd.uniform(0.95, 1.15))
        arr = dep + dur
        fare = int(km * (0.55 if mode == "train" else 1.5) * rnd.uniform(0.9, 1.4) / 5) * 5 + 60
        opts.append({
            "id": f"{mode[0].upper()}{rnd.randint(10000, 99999)}",
            "name": names[i] + " (Demo)", "mode": mode,
            "from": src, "to": dst, "date": date,
            "depart": dep.strftime("%H:%M"), "arrive": arr.strftime("%H:%M"),
            "next_day": arr.date() > dep.date(),
            "hours": round(dur.total_seconds() / 3600, 1),
            "fare": fare, "seats_left": rnd.randint(4, 60), "lower_available": rnd.random() > 0.2,
        })
    return jsonify(opts)


# ---------------------------------------------------------------- safe payment: prepare → confirm
@app.post("/api/action/prepare")
@login_required("senior")
def action_prepare():
    """Step 1 of every payment. Nothing is paid here — it only registers the intent
    and returns the safety warnings for the confirmation screen."""
    b = body()
    user_id = senior_id()                       # never trust a user_id sent by the browser
    kind, payee = b.get("type"), (b.get("payee") or "").strip()
    try:
        amount = int(b.get("amount"))
    except (TypeError, ValueError):
        return jsonify(error="invalid amount"), 400
    if kind not in ("bill", "ticket") or not payee or amount <= 0:
        return jsonify(error="invalid"), 400
    conn = get_db()
    warnings = check_payment(conn, user_id, payee, amount, b.get("details", {}).get("category"))
    blocked = any(w["blocking"] for w in warnings)
    cur = conn.execute(
        "INSERT INTO transactions (user_id,type,payee,amount,details,status,ref,warnings,created_at,reason,stop_stage)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (user_id, kind, payee, amount, json.dumps(b.get("details", {})), "blocked" if blocked else "pending", new_ref(),
         json.dumps(warnings), db.now_iso(), "limit" if blocked else None, "confirm" if blocked else None))
    conn.commit()
    return jsonify(pending_id=cur.lastrowid, warnings=warnings,
                   blocked=blocked,
                   min_seconds=CONFIRM_MIN_SECONDS,
                   pin_required=amount >= security.PAYMENT_PIN_THRESHOLD)


@app.post("/api/action/confirm")
@login_required("senior")
def action_confirm():
    """Step 2. The server itself refuses to pay unless BOTH confirmations happened
    (spoken/tapped YES + press-and-hold) and enough time passed for the user to read."""
    b = body()
    conn = get_db()
    tx = conn.execute("SELECT * FROM transactions WHERE id=?", (b.get("pending_id"),)).fetchone()
    if tx and tx["user_id"] == senior_id() and tx["status"] == "blocked" and tx["reason"] == "limit":
        return jsonify(ok=False, error="needs_family_approval"), 403
    if not tx or tx["status"] != "pending" or tx["user_id"] != senior_id():
        return jsonify(ok=False, error="not_pending"), 409
    if not (b.get("first_confirm") and b.get("hold_confirm")):
        return jsonify(ok=False, error="confirmation_missing"), 400
    elapsed = (datetime.now() - datetime.fromisoformat(tx["created_at"])).total_seconds()
    if elapsed < CONFIRM_MIN_SECONDS:
        return jsonify(ok=False, error="too_fast"), 400
    if any(w["blocking"] for w in json.loads(tx["warnings"])):
        conn.execute("UPDATE transactions SET status='blocked', reason='limit', stop_stage='countdown' WHERE id=?", (tx["id"],))
        conn.commit()
        return jsonify(ok=False, error="needs_family_approval"), 403
    if tx["amount"] >= security.PAYMENT_PIN_THRESHOLD:          # bigger payments also need the senior's PIN
        u = conn.execute("SELECT pin_hash FROM users WHERE id=?", (senior_id(),)).fetchone()
        if not (u and u["pin_hash"] and check_password_hash(u["pin_hash"], str(b.get("pin", "")))):
            tries = (tx["pin_attempts"] or 0) + 1
            left = security.PAYMENT_PIN_TRIES - tries
            if left <= 0:
                conn.execute("UPDATE transactions SET status='blocked', reason='pin_blocked', stop_stage='pin', pin_attempts=? WHERE id=?",
                             (tries, tx["id"]))
                security.audit(conn, f"senior:{senior_id()}", "pin_blocked", tx["ref"])
                conn.commit()
                return jsonify(ok=False, error="pin_blocked"), 403
            conn.execute("UPDATE transactions SET pin_attempts=? WHERE id=?", (tries, tx["id"]))
            security.audit(conn, f"senior:{senior_id()}", "pin_fail", tx["ref"])
            conn.commit()
            return jsonify(ok=False, error="wrong_pin", tries_left=left), 422
    conn.execute("UPDATE transactions SET status='success', first_confirm=1, hold_confirm=1, "
                 "completed_at=? WHERE id=?", (db.now_iso(), tx["id"]))
    conn.commit()
    extra = {}
    if tx["type"] == "ticket":
        d = json.loads(tx["details"])
        rnd = random.Random(tx["ref"])
        coach = rnd.choice(["S2", "S4", "S7", "B1"]) if d.get("mode") == "train" else ""
        berth = rnd.choice([1, 4, 9, 12, 17, 20]) if d.get("seat") == "lower" else rnd.randint(1, 40)
        extra["seat"] = (f"{coach}-{berth}" if coach else f"{berth}") + (" (Lower)" if d.get("seat") == "lower" else "")
    return jsonify(ok=True, ref=tx["ref"], amount=tx["amount"], payee=tx["payee"],
                   time=datetime.now().strftime("%d %b %Y, %I:%M %p"), **extra)


@app.post("/api/action/cancel")
@login_required("senior")
def action_cancel():
    b = body()
    stage = b.get("stage") if b.get("stage") in ("confirm", "hold", "pin", "countdown") else "confirm"
    reason = "left" if b.get("reason") == "left" else "user_cancelled"
    conn = get_db()
    conn.execute("UPDATE transactions SET status='cancelled', reason=?, stop_stage=? WHERE id=? AND status='pending' AND user_id=?",
                 (reason, stage, b.get("pending_id"), senior_id()))
    conn.commit()
    return jsonify(ok=True)


# ---------------------------------------------------------------- history: payments + unfinished tasks
PENDING_STALE_SECONDS = 120     # a payment still "pending" after this was left half-way


def _history(conn, user_id=None, limit=60):
    now = datetime.now()
    where, args = ("WHERE t.user_id=?", (user_id,)) if user_id else ("", ())
    pays = []
    for r in conn.execute(f"SELECT t.*, u.name AS user_name FROM transactions t LEFT JOIN users u ON u.id=t.user_id "
                          f"{where} ORDER BY t.created_at DESC, t.id DESC LIMIT ?", (*args, limit)):
        st, reason = r["status"], r["reason"]
        age = (now - datetime.fromisoformat(r["created_at"])).total_seconds()
        if st == "success":
            outcome = "paid"
        elif st == "blocked":
            outcome = "failed"
            reason = reason or ("pin_blocked" if (r["pin_attempts"] or 0) >= security.PAYMENT_PIN_TRIES else "limit")
        elif st == "cancelled":
            outcome = "stopped"
            reason = reason or "user_cancelled"
        elif age > PENDING_STALE_SECONDS:
            outcome, reason = "stopped", "left"
        else:
            outcome = "in_progress"
        try:
            details = json.loads(r["details"] or "{}")
        except ValueError:
            details = {}
        pays.append({"id": r["id"], "user_id": r["user_id"], "user_name": r["user_name"], "type": r["type"],
                     "payee": r["payee"], "amount": r["amount"], "outcome": outcome, "reason": reason,
                     "stage": r["stop_stage"], "ref": r["ref"], "category": details.get("category"),
                     "mode": details.get("mode"), "from": details.get("from"), "to": details.get("to"),
                     "from_name": CITIES.get(details.get("from") or "", [details.get("from")])[0],
                     "to_name": CITIES.get(details.get("to") or "", [details.get("to")])[0],
                     "consumer_no": details.get("consumer_no"),
                     "created_at": r["created_at"], "completed_at": r["completed_at"]})
    # task sessions that never reached the end
    lw, la = ("WHERE user_id=?", (user_id,)) if user_id else ("", ())
    sessions = {}
    for r in conn.execute(f"SELECT l.*, u.name AS user_name FROM task_logs l LEFT JOIN users u ON u.id=l.user_id "
                          f"{lw.replace('user_id', 'l.user_id')} ORDER BY l.id", la):
        s = sessions.setdefault(r["session_id"], {"session_id": r["session_id"], "task": r["task"], "user_id": r["user_id"],
                                                  "user_name": r["user_name"], "started_at": r["created_at"], "step": "start",
                                                  "done": False, "reason": None, "help": False, "retries": 0})
        s["last_at"] = r["created_at"]
        if r["event"] in ("start", "step", "stuck", "not_understood") and r["step"] not in (None, "complete"):
            s["step"] = r["step"]
        if r["event"] == "complete":
            s["done"] = True
        if r["event"] == "not_understood":
            s["retries"] += 1
        if r["event"] == "help":
            s["help"] = True
        if r["event"] == "abandon":
            try:
                s["reason"] = (json.loads(r["detail"] or "{}") or {}).get("reason") or "closed"
            except ValueError:
                s["reason"] = "closed"
    unfinished = []
    for s in sessions.values():
        if s["done"] or not s["task"]:
            continue
        idle = (now - datetime.fromisoformat(s["last_at"])).total_seconds()
        if not s["reason"] and idle < PENDING_STALE_SECONDS:
            continue                                  # still going on right now
        s["reason"] = s["reason"] or "closed"
        s["step_label"] = STEP_LABELS.get(s["step"], s["step"])
        s["task_label"] = TASK_LABELS.get(s["task"], s["task"])
        steps = TASK_STEPS.get(s["task"], [])
        s["step_no"] = steps.index(s["step"]) if s["step"] in steps else 0
        s["step_total"] = max(len(steps) - 1, 1)
        unfinished.append(s)
    unfinished.sort(key=lambda s: s["last_at"], reverse=True)
    summary = {k: sum(1 for p in pays if p["outcome"] == k) for k in ("paid", "failed", "stopped", "in_progress")}
    summary["paid_amount"] = sum(p["amount"] for p in pays if p["outcome"] == "paid")
    summary["unfinished"] = len(unfinished)
    return {"payments": pays, "unfinished": unfinished[:limit], "summary": summary}


@app.get("/api/history")
@login_required("senior", "volunteer")
def api_history():
    """Senior: their own payments and unfinished tasks. Volunteer: everyone's, or ?user_id=…"""
    if role() == "senior":
        uid = senior_id()
    else:
        uid = request.args.get("user_id", type=int)
    data = _history(get_db(), uid)
    return jsonify(**data)


# ---------------------------------------------------------------- logging, help, polling
VALID_EVENTS = {"start", "step", "not_understood", "stuck", "help", "abandon", "complete",
                "scam_warning", "payment_warning", "cancel", "voice_assist"}


@app.post("/api/log")
@login_required("senior")
def api_log():
    b = body() or json.loads(request.data or b"{}")      # sendBeacon posts text/plain
    if b.get("event") not in VALID_EVENTS:
        return jsonify(error="bad event"), 400
    conn = get_db()
    conn.execute(
        "INSERT INTO task_logs (session_id,user_id,task,step,event,detail,lang,created_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (b.get("session_id"), senior_id(), b.get("task"), b.get("step"), b["event"],
         json.dumps(b.get("detail")) if b.get("detail") is not None else None,
         b.get("lang"), db.now_iso()))
    conn.commit()
    return jsonify(ok=True)


@app.post("/api/help")
@login_required("senior")
def api_help():
    b = body()
    conn = get_db()
    kind = b.get("kind") if b.get("kind") in ("volunteer", "family", "fraud") else "volunteer"
    # calling family is recorded for the dashboard but does not wait in the volunteer queue
    cur = conn.execute(
        "INSERT INTO help_requests (user_id,session_id,task,step,lang,created_at,kind,status) VALUES (?,?,?,?,?,?,?,?)",
        (senior_id(), b.get("session_id"), b.get("task"), b.get("step"), b.get("lang"),
         db.now_iso(), kind, "resolved" if kind == "family" else "open"))
    conn.execute(
        "INSERT INTO task_logs (session_id,user_id,task,step,event,lang,created_at) VALUES (?,?,?,?,?,?,?)",
        (b.get("session_id"), senior_id(), b.get("task"), b.get("step"), "help",
         b.get("lang"), db.now_iso()))
    conn.commit()
    return jsonify(ok=True, id=cur.lastrowid)


@app.post("/api/doc/read")
@login_required("senior", "volunteer")
def doc_read():
    """Upload a bill/letter (PDF or photo) or paste its text → the key facts, explained. Nothing is stored."""
    f = request.files.get("file")
    data = f.read(8 * 1024 * 1024 + 1) if f else b""
    try:
        text, source = doc_reader.read_upload(data, request.form.get("text", ""))
    except doc_reader.ReadError as e:
        return jsonify(error=e.code, ocr=doc_reader.ocr_available()), 422
    info = doc_reader.explain(text)
    if role() == "senior" and info["scam"]["level"] != "safe":
        conn = get_db()
        conn.execute("INSERT INTO task_logs (session_id,user_id,task,step,event,detail,lang,created_at) VALUES (?,?,?,?,?,?,?,?)",
                     (request.form.get("session_id"), senior_id(), "doc", "result", "scam_warning",
                      json.dumps({"level": info["scam"]["level"], "source": "document"}), request.form.get("lang"), db.now_iso()))
        conn.commit()
    return jsonify(info | {"source": source})


@app.post("/api/help/<int:hid>/hint")
@login_required("volunteer")
def help_hint(hid):
    conn = get_db()
    conn.execute("UPDATE help_requests SET hint=?, hint_delivered=0 WHERE id=?",
                 (body().get("hint", "")[:300], hid))
    conn.commit()
    return jsonify(ok=True)


@app.post("/api/help/<int:hid>/resolve")
@login_required("volunteer")
def help_resolve(hid):
    conn = get_db()
    conn.execute("UPDATE help_requests SET status='resolved' WHERE id=?", (hid,))
    conn.commit()
    return jsonify(ok=True)


@app.post("/api/device/button")
def device_button():
    """Called by the ESP32 help remote: {"device_id": "...", "button": "speak|yes|no|sos"}"""
    if not security.device_ok():
        return jsonify(error="bad device token"), 401
    b = body()
    if b.get("button") not in ("speak", "yes", "no", "sos"):
        return jsonify(error="bad button"), 400
    conn = get_db()
    cur = conn.execute("INSERT INTO device_events (device_id,button,created_at) VALUES (?,?,?)",
                       (b.get("device_id", "esp32"), b["button"], db.now_iso()))
    conn.commit()
    return jsonify(ok=True, id=cur.lastrowid)


@app.get("/api/poll")
@login_required("senior")
def api_poll():
    """Senior app polls this every ~1.5 s for hardware button presses and volunteer hints."""
    user_id = senior_id()
    after = int(request.args.get("after", -1))
    conn = get_db()
    if after < 0:       # first poll: just learn the latest id, don't replay old presses
        last = conn.execute("SELECT COALESCE(MAX(id),0) FROM device_events").fetchone()[0]
        return jsonify(last_id=last, buttons=[], hints=[])
    rows = conn.execute("SELECT id, button FROM device_events WHERE id>? ORDER BY id", (after,)).fetchall()
    hints = conn.execute("SELECT id, hint FROM help_requests WHERE user_id=? AND hint IS NOT NULL "
                         "AND hint_delivered=0", (user_id,)).fetchall()
    if hints:
        conn.executemany("UPDATE help_requests SET hint_delivered=1 WHERE id=?", [(h["id"],) for h in hints])
        conn.commit()
    return jsonify(last_id=rows[-1]["id"] if rows else after,
                   buttons=[r["button"] for r in rows], hints=[h["hint"] for h in hints])


# ---------------------------------------------------------------- volunteer dashboard
@app.get("/api/dashboard")
@login_required("volunteer")
def dashboard_data():
    days = int(request.args.get("days", 14))
    since = (datetime.now() - timedelta(days=days)).isoformat(timespec="seconds")
    conn = get_db()
    logs = [dict(r) for r in conn.execute(
        "SELECT * FROM task_logs WHERE created_at>=? ORDER BY created_at, id", (since,))]
    users = {r["id"]: r["name"] for r in conn.execute("SELECT id,name FROM users")}

    sessions = defaultdict(list)
    for r in logs:
        if r["session_id"]:
            sessions[r["session_id"]].append(r)

    funnels = {t: Counter() for t in TASK_STEPS}
    drop = Counter()
    retries = Counter()
    lang_sessions = Counter()
    lang_fails = Counter()
    task_counts = Counter()
    completed = Counter()
    durations = defaultdict(list)
    stale = datetime.now() - timedelta(minutes=10)
    stuck_sessions = 0

    for sid, evs in sessions.items():
        task = evs[0]["task"]
        if task not in TASK_STEPS:
            continue
        lang = evs[0]["lang"] or "en"
        task_counts[task] += 1
        lang_sessions[lang] += 1
        reached = {e["step"] for e in evs if e["event"] in ("start", "step", "complete")}
        for s in reached:
            funnels[task][s] += 1
        if any(e["event"] == "stuck" for e in evs):
            stuck_sessions += 1
        for e in evs:
            if e["event"] == "not_understood":
                retries[(task, e["step"])] += 1
                lang_fails[e["lang"] or "en"] += 1
        done = any(e["event"] == "complete" for e in evs)
        if done:
            completed[task] += 1
            t0 = datetime.fromisoformat(evs[0]["created_at"])
            t1 = datetime.fromisoformat(evs[-1]["created_at"])
            durations[task].append((t1 - t0).total_seconds())
        else:
            ab = [e for e in evs if e["event"] == "abandon"]
            if ab:
                drop[(task, ab[-1]["step"])] += 1
            elif datetime.fromisoformat(evs[-1]["created_at"]) < stale:
                drop[(task, evs[-1]["step"])] += 1    # went silent → counts as a drop-off

    def lbl(task, step):
        return {"task": task, "task_label": TASK_LABELS[task], "step": step,
                "step_label": STEP_LABELS.get(step, step)}

    funnel_out = {t: [{"step": s, "label": STEP_LABELS[s], "count": funnels[t][s]}
                      for s in TASK_STEPS[t]] for t in TASK_STEPS}
    trouble = []
    for (task, step), n in retries.items():
        trouble.append(lbl(task, step) | {"retries": n, "dropoffs": drop.get((task, step), 0)})
    for (task, step), n in drop.items():
        if (task, step) not in retries:
            trouble.append(lbl(task, step) | {"retries": 0, "dropoffs": n})
    trouble.sort(key=lambda x: (x["dropoffs"] * 3 + x["retries"]), reverse=True)

    fails = []
    for r in reversed(logs):
        if r["event"] == "not_understood" and len(fails) < 15:
            heard = json.loads(r["detail"]).get("heard") if r["detail"] else ""
            fails.append({"heard": heard, "lang": LANG_LABELS.get(r["lang"], r["lang"]),
                          "task": TASK_LABELS.get(r["task"], r["task"]),
                          "step": STEP_LABELS.get(r["step"], r["step"]), "time": r["created_at"]})

    help_rows = [dict(r) | {"user": users.get(r["user_id"], "?"),
                            "task_label": TASK_LABELS.get(r["task"], r["task"] or "Home"),
                            "step_label": STEP_LABELS.get(r["step"], r["step"] or "-"),
                            "lang_label": LANG_LABELS.get(r["lang"], r["lang"])}
                 for r in conn.execute("SELECT * FROM help_requests WHERE status='open' ORDER BY (kind='fraud') DESC, id DESC")]

    # live: sessions active in the last 30 min that are struggling and not finished
    live_cut = datetime.now() - timedelta(minutes=30)
    live = []
    for sid, evs in sessions.items():
        last = evs[-1]
        if datetime.fromisoformat(last["created_at"]) < live_cut or last["task"] not in TASK_STEPS:
            continue
        if any(e["event"] in ("complete", "abandon") for e in evs):
            continue
        n_fail = sum(1 for e in evs if e["event"] == "not_understood" and e["step"] == last["step"])
        live.append({"session_id": sid, "user": users.get(last["user_id"], "?"),
                     "task_label": TASK_LABELS[last["task"]],
                     "step_label": STEP_LABELS.get(last["step"], last["step"]),
                     "retries_here": n_fail, "stuck": n_fail >= STUCK_RETRY_THRESHOLD,
                     "lang": LANG_LABELS.get(last["lang"], last["lang"]),
                     "last_seen": last["created_at"]})
    live.sort(key=lambda x: (not x["stuck"], x["last_seen"]), reverse=False)

    total = sum(task_counts.values())
    return jsonify(
        server_now=db.now_iso(),
        has_demo=conn.execute("SELECT COUNT(*) FROM task_logs WHERE is_demo=1").fetchone()[0] > 0,
        days=days,
        kpis={
            "sessions": total,
            "completed": sum(completed.values()),
            "completion_rate": round(100 * sum(completed.values()) / total) if total else 0,
            "stuck_sessions": stuck_sessions,
            "open_help": len(help_rows),
            "scam_warnings": sum(1 for r in logs if r["event"] == "scam_warning"),
            "not_understood": sum(retries.values()),
        },
        tasks=[{"task": t, "label": TASK_LABELS[t], "sessions": task_counts[t],
                "completed": completed[t],
                "avg_minutes": round(sum(durations[t]) / len(durations[t]) / 60, 1) if durations[t] else None}
               for t in TASK_STEPS],
        funnels=funnel_out,
        trouble=trouble[:10],
        languages=[{"lang": LANG_LABELS.get(l, l), "sessions": n,
                    "not_understood": lang_fails[l],
                    "fails_per_session": round(lang_fails[l] / n, 2) if n else 0}
                   for l, n in lang_sessions.most_common()],
        asr_fails=fails,
        help=help_rows,
        live=live[:10],
    )


@app.post("/api/dashboard/clear-demo")
@login_required("volunteer")
def clear_demo():
    db.clear_demo(get_db())
    return jsonify(ok=True)


# ---------------------------------------------------------------- speech accuracy testing
@app.post("/api/speechtest")
@login_required("volunteer")
def speechtest_save():
    b = body()
    expected, heard = b.get("expected", ""), b.get("heard", "")
    detected, _, _ = detect_intent(heard)
    w, c = wer(expected, heard), cer(expected, heard)
    conn = get_db()
    conn.execute(
        "INSERT INTO speech_tests (tester,age_group,language,accent,noise,expected,heard,"
        "expected_intent,detected_intent,wer,cer,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (b.get("tester"), b.get("age_group"), b.get("language"), b.get("accent"), b.get("noise"),
         expected, heard, b.get("expected_intent"), detected, w, c, db.now_iso()))
    conn.commit()
    return jsonify(wer=w, cer=c, detected_intent=detected,
                   intent_ok=(b.get("expected_intent") in (None, "", detected)))


@app.get("/api/speechtest/summary")
@login_required("volunteer")
def speechtest_summary():
    rows = [dict(r) for r in get_db().execute("SELECT * FROM speech_tests")]
    groups = defaultdict(list)
    for r in rows:
        groups[(r["language"], r["accent"] or "-", r["noise"])].append(r)
    out = []
    for (lang, accent, noise), rs in sorted(groups.items()):
        with_intent = [r for r in rs if r["expected_intent"]]
        out.append({
            "language": LANG_LABELS.get(lang, lang), "accent": accent, "noise": noise, "n": len(rs),
            "word_accuracy": round(100 * (1 - min(1, sum(r["wer"] for r in rs) / len(rs))), 1),
            "char_accuracy": round(100 * (1 - min(1, sum(r["cer"] for r in rs) / len(rs))), 1),
            "intent_accuracy": round(100 * sum(r["expected_intent"] == r["detected_intent"]
                                              for r in with_intent) / len(with_intent), 1)
            if with_intent else None,
        })
    return jsonify(groups=out, total=len(rows))


@app.get("/api/speechtest/export.csv")
@login_required("volunteer")
def speechtest_export():
    rows = get_db().execute("SELECT * FROM speech_tests ORDER BY id").fetchall()
    buf = io.StringIO()
    w = csv.writer(buf)
    cols = ["id", "tester", "age_group", "language", "accent", "noise", "expected", "heard",
            "expected_intent", "detected_intent", "wer", "cer", "created_at"]
    w.writerow(cols)
    for r in rows:
        w.writerow([r[c] for c in cols])
    return Response("﻿" + buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=speech_test_results.csv"})


@app.post("/api/speechtest/clear")
@login_required("volunteer")
def speechtest_clear():
    conn = get_db()
    conn.execute("DELETE FROM speech_tests")
    conn.commit()
    return jsonify(ok=True)


if __name__ == "__main__":
    db.init_db(demo=os.environ.get("DEMO_DATA", "1") != "0")
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
