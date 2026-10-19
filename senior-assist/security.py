"""Security layer for Saathi.

1. CSRF protection      – every POST must carry the secret per-session token (form field, header or JSON "_csrf"),
                          so another website cannot make a logged-in senior's browser pay a bill.
2. Login lockout        – 5 wrong PINs/passwords for the same account (or from the same device) within
                          15 minutes locks that login for 15 minutes. Stops PIN guessing.
3. Idle auto-logout     – seniors are logged out after 20 minutes without activity, volunteers after 30.
4. Payment PIN          – payments of ₹1,000 or more also need the senior's 4-digit PIN (3 wrong tries
                          block that payment), on top of YES + hold + countdown.
5. Security headers     – Content-Security-Policy, no framing, no MIME sniffing, strict referrer,
                          microphone/camera only for Saathi and the video-call site.
6. Device token         – the ESP32 remote can be required to send a secret token (DEVICE_TOKEN).
7. Audit log            – logins, failed logins, lockouts, logouts and wrong payment PINs are recorded.
"""
import hmac
import os
import secrets
from datetime import datetime, timedelta

from flask import abort, jsonify, request, session

MAX_ATTEMPTS = 5
LOCK_MINUTES = 15
IDLE_MINUTES = {"senior": 20, "volunteer": 30}
PAYMENT_PIN_THRESHOLD = int(os.environ.get("PAYMENT_PIN_THRESHOLD", 1000))   # ₹
PAYMENT_PIN_TRIES = 3
DEVICE_TOKEN = os.environ.get("DEVICE_TOKEN", "")

# endpoints that do not need a CSRF token
CSRF_EXEMPT = {"device_button", "static"}


# ---------------------------------------------------------------- CSRF
def csrf_token():
    tok = session.get("_csrf")
    if not tok:
        tok = secrets.token_urlsafe(32)
        session["_csrf"] = tok
    return tok


def _sent_token():
    tok = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token")
    if not tok and request.is_json:
        tok = (request.get_json(silent=True) or {}).get("_csrf")
    if not tok and request.data and not request.form:            # navigator.sendBeacon (text/plain JSON)
        try:
            import json
            tok = json.loads(request.data).get("_csrf")
        except Exception:
            tok = None
    return tok or ""


def check_csrf():
    if request.method not in ("POST", "PUT", "PATCH", "DELETE") or request.endpoint in CSRF_EXEMPT:
        return None
    good = session.get("_csrf", "")
    if not good or not hmac.compare_digest(good, _sent_token()):
        if request.path.startswith("/api/"):
            return jsonify(error="csrf_failed"), 403
        abort(400, description="Security check failed. Please reload the page and try again.")
    return None


# ---------------------------------------------------------------- idle timeout
def check_idle():
    role = session.get("role")
    if not role:
        return None
    now = datetime.now()
    last = session.get("_seen")
    if last:
        try:
            if now - datetime.fromisoformat(last) > timedelta(minutes=IDLE_MINUTES.get(role, 20)):
                session.clear()
                session["_expired"] = True
                return None
        except ValueError:
            pass
    # polling every 1.5 s should not count as "activity"
    if request.endpoint not in ("api_poll", "dashboard_data", "static"):
        session["_seen"] = now.isoformat(timespec="seconds")
    return None


# ---------------------------------------------------------------- headers
def add_headers(resp, jitsi_domain):
    jitsi = f"https://{jitsi_domain}"
    resp.headers.setdefault("Content-Security-Policy", "; ".join([
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "media-src 'self' blob:",
        f"frame-src {jitsi}",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]))
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault("Permissions-Policy",
                            f'microphone=(self "{jitsi}"), camera=(self "{jitsi}"), geolocation=(), payment=()')
    if request.path.startswith("/api/") or session.get("role"):
        resp.headers.setdefault("Cache-Control", "no-store")
    return resp


# ---------------------------------------------------------------- lockout + audit
def client_ip():
    return request.headers.get("X-Forwarded-For", request.remote_addr or "?").split(",")[0].strip()


def locked_for(conn, account_key):
    """Seconds left on a lock for this account or this device, or 0."""
    since = (datetime.now() - timedelta(minutes=LOCK_MINUTES)).isoformat(timespec="seconds")
    worst = 0
    for key in (account_key, "ip:" + client_ip()):
        rows = conn.execute("SELECT created_at FROM login_attempts WHERE key=? AND ok=0 AND created_at>=? "
                            "ORDER BY created_at", (key, since)).fetchall()
        limit = MAX_ATTEMPTS if not key.startswith("ip:") else MAX_ATTEMPTS * 4
        if len(rows) >= limit:
            unlock = datetime.fromisoformat(rows[-limit]["created_at"]) + timedelta(minutes=LOCK_MINUTES)
            worst = max(worst, int((unlock - datetime.now()).total_seconds()))
    return max(worst, 0)


def record_login(conn, account_key, ok):
    now = datetime.now().isoformat(timespec="seconds")
    conn.execute("INSERT INTO login_attempts (key, ok, created_at) VALUES (?,?,?)", (account_key, int(ok), now))
    conn.execute("INSERT INTO login_attempts (key, ok, created_at) VALUES (?,?,?)", ("ip:" + client_ip(), int(ok), now))
    if ok:   # a successful login clears the account's failed count
        conn.execute("DELETE FROM login_attempts WHERE key=? AND ok=0", (account_key,))
    conn.commit()


def audit(conn, actor, event, detail=""):
    conn.execute("INSERT INTO security_events (actor, event, detail, ip, created_at) VALUES (?,?,?,?,?)",
                 (actor, event, detail[:200], client_ip(), datetime.now().isoformat(timespec="seconds")))
    conn.commit()


def device_ok():
    return not DEVICE_TOKEN or hmac.compare_digest(request.headers.get("X-Device-Token", ""), DEVICE_TOKEN)
