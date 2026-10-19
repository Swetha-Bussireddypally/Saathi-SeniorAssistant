"""SQLite database: schema, connection helper and demo seed data."""
import json
import os
import random
import sqlite3
import uuid
from datetime import datetime, timedelta

from werkzeug.security import generate_password_hash

from config import TASK_STEPS, DEFAULT_DAILY_LIMIT

DB_PATH = os.environ.get(
    "SAATHI_DB", os.path.join(os.path.dirname(os.path.abspath(__file__)), "saathi.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    language TEXT DEFAULT 'en',
    text_size REAL DEFAULT 1.25,
    family_contact TEXT,
    daily_limit INTEGER DEFAULT 5000
);
CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    name TEXT,
    relation TEXT,
    phone TEXT,
    color TEXT
);
CREATE TABLE IF NOT EXISTS saved_billers (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    category TEXT,
    consumer_no TEXT
);
CREATE TABLE IF NOT EXISTS bills (
    consumer_no TEXT,
    category TEXT,
    board TEXT,
    customer_name TEXT,
    amount INTEGER,
    due_date TEXT,
    PRIMARY KEY (consumer_no, category)
);
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    type TEXT,               -- bill | ticket
    payee TEXT,
    amount INTEGER,
    details TEXT,            -- JSON
    status TEXT,             -- pending | success | cancelled | blocked
    ref TEXT,
    warnings TEXT,           -- JSON list
    first_confirm INTEGER DEFAULT 0,
    hold_confirm INTEGER DEFAULT 0,
    created_at TEXT,
    completed_at TEXT
);
CREATE TABLE IF NOT EXISTS task_logs (
    id INTEGER PRIMARY KEY,
    session_id TEXT,
    user_id INTEGER,
    task TEXT,
    step TEXT,
    event TEXT,              -- start | step | not_understood | stuck | help | abandon | complete | scam_warning | payment_warning
    detail TEXT,
    lang TEXT,
    created_at TEXT,
    is_demo INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS help_requests (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    session_id TEXT,
    task TEXT,
    step TEXT,
    lang TEXT,
    status TEXT DEFAULT 'open',   -- open | resolved
    hint TEXT,
    hint_delivered INTEGER DEFAULT 0,
    created_at TEXT,
    is_demo INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS device_events (
    id INTEGER PRIMARY KEY,
    device_id TEXT,
    button TEXT,             -- speak | yes | no | sos
    created_at TEXT
);
CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY,
    key TEXT,                -- "senior:9000000001", "volunteer:x@y", or "ip:1.2.3.4"
    ok INTEGER,
    created_at TEXT
);
CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY,
    actor TEXT,
    event TEXT,              -- login_ok | login_fail | locked | logout | pin_fail | pin_blocked | idle_logout
    detail TEXT,
    ip TEXT,
    created_at TEXT
);
CREATE TABLE IF NOT EXISTS speech_tests (
    id INTEGER PRIMARY KEY,
    tester TEXT,
    age_group TEXT,
    language TEXT,
    accent TEXT,
    noise TEXT,
    expected TEXT,
    heard TEXT,
    expected_intent TEXT,
    detected_intent TEXT,
    wer REAL,
    cer REAL,
    created_at TEXT
);
"""


def now_iso():
    return datetime.now().isoformat(timespec="seconds")


def connect(path=None):
    conn = sqlite3.connect(path or DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(path=None, demo=True):
    conn = connect(path)
    conn.executescript(SCHEMA)
    fresh = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
    if fresh:
        seed_base(conn)
    migrate(conn)
    if fresh and demo:
        seed_demo_activity(conn)
        seed_demo_payments(conn)
    conn.commit()
    conn.close()


# Demo login accounts (shown on the login page). Change before any real use.
DEMO_SENIORS = {1: "9000000001", 2: "9000000002", 3: "9000000003", 4: "9000000004"}
DEMO_PIN = "1234"
# pbkdf2 works on every Python build (macOS system Python 3.9 has no hashlib.scrypt)
HASH_METHOD = "pbkdf2:sha256"
DEMO_VOLUNTEERS = [("Anita Reddy", "volunteer@saathi.in", "saathi123"),
                   ("Rahul Verma", "rahul@saathi.in", "saathi123")]


def migrate(conn):
    """Adds login support to databases created by earlier versions (safe to run every start)."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)")}
    if "phone" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN phone TEXT")
    if "pin_hash" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN pin_hash TEXT")
    if "avatar" not in cols:                      # picture shown next to Saathi's questions
        conn.execute("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT 'grandpa'")
        conn.execute("UPDATE users SET avatar='grandma' WHERE name IN ('Lakshmi', 'Sarojini')")
    tcols = {r["name"] for r in conn.execute("PRAGMA table_info(transactions)")}
    if "pin_attempts" not in tcols:
        conn.execute("ALTER TABLE transactions ADD COLUMN pin_attempts INTEGER DEFAULT 0")
    tcols = {r["name"] for r in conn.execute("PRAGMA table_info(transactions)")}
    if "reason" not in tcols:                     # why a payment did not go through (for the history page)
        conn.execute("ALTER TABLE transactions ADD COLUMN reason TEXT")
    if "stop_stage" not in tcols:                 # where it was stopped: confirm | hold | pin | countdown
        conn.execute("ALTER TABLE transactions ADD COLUMN stop_stage TEXT")
    conn.execute("""CREATE TABLE IF NOT EXISTS volunteers (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL)""")
    for uid, phone in DEMO_SENIORS.items():
        conn.execute("UPDATE users SET phone=?, pin_hash=? WHERE id=? AND phone IS NULL",
                     (phone, generate_password_hash(DEMO_PIN, method=HASH_METHOD), uid))
    if conn.execute("SELECT COUNT(*) FROM volunteers").fetchone()[0] == 0:
        conn.executemany("INSERT INTO volunteers (name,email,password_hash) VALUES (?,?,?)",
                         [(n, e, generate_password_hash(pw, method=HASH_METHOD)) for n, e, pw in DEMO_VOLUNTEERS])
    ccols = {r["name"] for r in conn.execute("PRAGMA table_info(contacts)")}
    if "trusted" not in ccols:                    # the family member Saathi calls when the senior needs help
        conn.execute("ALTER TABLE contacts ADD COLUMN trusted INTEGER DEFAULT 0")
    hcols = {r["name"] for r in conn.execute("PRAGMA table_info(help_requests)")}
    if "kind" not in hcols:                       # volunteer | family | fraud
        conn.execute("ALTER TABLE help_requests ADD COLUMN kind TEXT DEFAULT 'volunteer'")
    # every senior gets a few contacts for the video-call demo
    family = [("Kiran", "son", "#2563eb"), ("Meena", "daughter", "#db2777"),
              ("Dr. Rao", "doctor", "#7c3aed"), ("Saathi Volunteer", "volunteer", "#ea580c")]
    for (uid,) in conn.execute("SELECT id FROM users").fetchall():
        if not conn.execute("SELECT 1 FROM contacts WHERE user_id=?", (uid,)).fetchone():
            conn.executemany("INSERT INTO contacts (user_id,name,relation,phone,color) VALUES (?,?,?,?,?)",
                             [(uid, n, r, "+91-90000-0000%d" % i, c) for i, (n, r, c) in enumerate(family)])
    # one trusted contact per senior: their son/daughter
    for (uid,) in conn.execute("SELECT id FROM users").fetchall():
        if not conn.execute("SELECT 1 FROM contacts WHERE user_id=? AND trusted=1", (uid,)).fetchone():
            row = conn.execute("SELECT id FROM contacts WHERE user_id=? AND relation IN ('son','daughter') ORDER BY id LIMIT 1", (uid,)).fetchone()
            if row:
                conn.execute("UPDATE contacts SET trusted=1 WHERE id=?", (row["id"],))


def seed_base(conn):
    users = [
        (1, "Lakshmi", "te", 1.5, "Ravi (son) 98xxxxxx10", DEFAULT_DAILY_LIMIT),
        (2, "Ramesh", "hi", 1.25, "Priya (daughter)", DEFAULT_DAILY_LIMIT),
        (3, "Joseph", "en", 1.25, "Anil (son)", DEFAULT_DAILY_LIMIT),
        (4, "Sarojini", "te", 1.75, "Kiran (grandson)", 3000),
    ]
    conn.executemany("INSERT INTO users (id,name,language,text_size,family_contact,daily_limit) VALUES (?,?,?,?,?,?)", users)

    contacts = [
        (1, "Ravi", "son", "+91-90000-00001", "#2563eb"),
        (1, "Priya", "daughter", "+91-90000-00002", "#db2777"),
        (1, "Arjun", "grandson", "+91-90000-00003", "#059669"),
        (1, "Dr. Rao", "doctor", "+91-90000-00004", "#7c3aed"),
        (1, "Saathi Volunteer", "volunteer", "+91-90000-00005", "#ea580c"),
    ]
    conn.executemany(
        "INSERT INTO contacts (user_id,name,relation,phone,color) VALUES (?,?,?,?,?)", contacts)

    conn.executemany(
        "INSERT INTO saved_billers (user_id,category,consumer_no) VALUES (?,?,?)",
        [(1, "electricity", "1234567890"), (1, "mobile", "9876543210")])

    due = (datetime.now() + timedelta(days=6)).date().isoformat()
    bills = [
        ("1234567890", "electricity", "City Electricity Board", "Lakshmi", 840, due),
        ("55667788", "water", "City Water Board", "Lakshmi", 410, due),
        ("9876543210", "mobile", "Mobile Postpaid", "Lakshmi", 299, due),
    ]
    conn.executemany("INSERT INTO bills VALUES (?,?,?,?,?,?)", bills)

    # one earlier payment so the bill payee is "known", not new
    conn.execute(
        "INSERT INTO transactions (user_id,type,payee,amount,details,status,ref,warnings,"
        "first_confirm,hold_confirm,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (1, "bill", "City Electricity Board", 790, json.dumps({"category": "electricity"}),
         "success", "SA-DEMO01", "[]", 1, 1,
         (datetime.now() - timedelta(days=31)).isoformat(timespec="seconds"),
         (datetime.now() - timedelta(days=31)).isoformat(timespec="seconds")))


def seed_demo_payments(conn):
    """A few past payments for the History page: paid, failed and stopped ones."""
    now = datetime.now()
    rows = [  # user, type, payee, amount, details, status, reason, stop_stage, days ago, ref
        (1, "bill", "City Water Board", 410, {"category": "water", "consumer_no": "55667788"}, "success", None, None, 24, "SA-DEMO02"),
        (1, "bill", "Mobile Postpaid", 299, {"category": "mobile", "consumer_no": "9876543210"}, "cancelled", "user_cancelled", "countdown", 9, "SA-DEMO03"),
        (1, "ticket", "Telangana RTC", 1260, {"mode": "bus", "from": "hyderabad", "to": "tirupati"}, "blocked", "pin_blocked", "pin", 6, "SA-DEMO04"),
        (1, "bill", "City Electricity Board", 6200, {"category": "electricity", "consumer_no": "1234567890"}, "blocked", "limit", "confirm", 3, "SA-DEMO05"),
        (1, "ticket", "Indian Railways", 655, {"mode": "train", "from": "hyderabad", "to": "vijayawada"}, "pending", None, None, 2, "SA-DEMO06"),
        (2, "bill", "City Electricity Board", 1120, {"category": "electricity"}, "cancelled", "user_cancelled", "hold", 4, "SA-DEMO07"),
        (3, "bill", "City Electricity Board", 640, {"category": "electricity", "consumer_no": "44556677"}, "success", None, None, 12, "SA-DEMO10"),
        (3, "ticket", "Indian Railways", 485, {"mode": "train", "from": "hyderabad", "to": "tirupati"}, "success", None, None, 20, "SA-DEMO11"),
        (3, "bill", "Mobile Postpaid", 349, {"category": "mobile", "consumer_no": "9000000003"}, "cancelled", "user_cancelled", "hold", 7, "SA-DEMO12"),
        (3, "ticket", "Indian Railways", 540, {"mode": "train", "from": "hyderabad", "to": "warangal"}, "pending", None, None, 1, "SA-DEMO08"),
        (4, "bill", "City Water Board", 3500, {"category": "water"}, "blocked", "limit", "confirm", 5, "SA-DEMO09"),
    ]
    for u, ty, payee, amt, det, st, reason, stage, ago, ref in rows:
        t = (now - timedelta(days=ago, hours=2)).isoformat(timespec="seconds")
        conn.execute(
            "INSERT INTO transactions (user_id,type,payee,amount,details,status,ref,warnings,first_confirm,hold_confirm,"
            "created_at,completed_at,reason,stop_stage) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (u, ty, payee, amt, json.dumps(det), st, ref, "[]", int(st == "success"), int(st == "success"),
             t, t if st == "success" else None, reason, stage))


# Phrases the speech engine "misheard" in the demo data, per language.
_DEMO_FAILS = {
    "bill": {"en": ["pay the karent bill", "number nine eight seven", "that one only"],
             "hi": ["बिल भरना है वो वाला", "नौ आठ सात छह", "लाइट वाला"],
             "te": ["కరెంటు బిల్లు కట్టాలి", "తొమ్మిది ఎనిమిది", "అదే అదే"]},
    "ticket": {"en": ["book for tirupathi", "day after day", "the morning one"],
               "hi": ["तिरुपति वाली गाड़ी", "परसो के दिन", "सुबह वाली"],
               "te": ["తిరుపతి బండి", "ఎల్లుండి పొద్దున", "పొద్దున్నే ఉన్నది"]},
    "call": {"en": ["video call to my boy", "the doctor sir"],
             "hi": ["बेटे से बात", "डाक्टर साहब"],
             "te": ["మా వాడికి ఫోను", "డాక్టరు గారు"]},
    "scam_check": {"en": ["what is this", "they sent some link"],
                   "hi": ["ये क्या आया है", "कोई लिंक भेजा"],
                   "te": ["ఇదేంటి", "ఏదో లింకు పంపారు"]},
}

# Probability that a user drops off at each step (demo data only).
_DROP = {
    "bill": {"consumer": 0.14, "verify_number": 0.10, "confirm": 0.06},
    "ticket": {"from": 0.05, "date": 0.12, "choose_option": 0.16, "confirm": 0.05},
    "call": {"choose_contact": 0.05},
    "scam_check": {"message": 0.08},
}
_RETRY = {
    "bill": {"consumer": 0.45, "verify_number": 0.25, "category": 0.1},
    "ticket": {"from": 0.25, "to": 0.25, "date": 0.3, "choose_option": 0.35},
    "call": {"choose_contact": 0.2},
    "scam_check": {"message": 0.3},
}


def seed_demo_activity(conn, sessions=70, seed=7):
    """Synthetic activity so the dashboard has something to show on first run.
    Every row is flagged is_demo=1 and can be cleared from the dashboard."""
    rnd = random.Random(seed)
    tasks = ["bill"] * 4 + ["ticket"] * 3 + ["call"] * 3 + ["scam_check"]
    langs = ["te"] * 5 + ["hi"] * 3 + ["en"] * 2
    rows = []
    helps = []
    for _ in range(sessions):
        task = rnd.choice(tasks)
        lang = rnd.choice(langs)
        user = rnd.randint(1, 4)
        sid = "demo-" + uuid.uuid4().hex[:8]
        t = datetime.now() - timedelta(days=rnd.uniform(0, 13), hours=rnd.uniform(0, 10))
        steps = TASK_STEPS[task]
        rows.append((sid, user, task, "start", "start", None, lang, t.isoformat(timespec="seconds")))
        for step in steps[1:]:
            t += timedelta(seconds=rnd.randint(6, 40))
            if step == "complete":
                rows.append((sid, user, task, step, "complete", None, lang, t.isoformat(timespec="seconds")))
                break
            rows.append((sid, user, task, step, "step", None, lang, t.isoformat(timespec="seconds")))
            p_retry = _RETRY[task].get(step, 0.04)
            n = 0
            while rnd.random() < p_retry and n < 4:
                n += 1
                t += timedelta(seconds=rnd.randint(5, 15))
                rows.append((sid, user, task, step, "not_understood",
                             json.dumps({"heard": rnd.choice(_DEMO_FAILS[task][lang])}), lang,
                             t.isoformat(timespec="seconds")))
            if n >= 3:
                rows.append((sid, user, task, step, "stuck", None, lang, t.isoformat(timespec="seconds")))
                if rnd.random() < 0.6:
                    rows.append((sid, user, task, step, "help", None, lang, t.isoformat(timespec="seconds")))
                    helps.append((user, sid, task, step, lang, "resolved", t.isoformat(timespec="seconds")))
            if task == "scam_check" and step == "result" and rnd.random() < 0.6:
                rows.append((sid, user, task, step, "scam_warning",
                             json.dumps({"level": "danger"}), lang, t.isoformat(timespec="seconds")))
            if rnd.random() < _DROP[task].get(step, 0.0):
                rows.append((sid, user, task, step, "abandon", None, lang, t.isoformat(timespec="seconds")))
                break
    conn.executemany(
        "INSERT INTO task_logs (session_id,user_id,task,step,event,detail,lang,created_at,is_demo)"
        " VALUES (?,?,?,?,?,?,?,?,1)", rows)
    conn.executemany(
        "INSERT INTO help_requests (user_id,session_id,task,step,lang,status,created_at,is_demo)"
        " VALUES (?,?,?,?,?,?,?,1)", helps)


def clear_demo(conn):
    conn.execute("DELETE FROM task_logs WHERE is_demo=1")
    conn.execute("DELETE FROM help_requests WHERE is_demo=1")
    conn.execute("DELETE FROM transactions WHERE ref LIKE 'SA-DEMO%' AND ref != 'SA-DEMO01'")
    conn.commit()
