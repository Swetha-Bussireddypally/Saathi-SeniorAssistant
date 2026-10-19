"""Scam & payment safety checks.

check_text()    -> scans a message / spoken sentence for common Indian fraud patterns
check_payment() -> checks a payment before the confirmation screen is shown
"""
import re
from datetime import datetime

from intents import normalize, _contains

# reason key -> (weight, phrases). Reason keys are translated in the front end.
SCAM_RULES = {
    "otp": (5, ["otp", "one time password", "verification code", "share the code", "pin number",
                "upi pin", "cvv", "password", "ओटीपी", "पिन", "पासवर्ड", "ఓటీపీ", "పిన్", "పాస్‌వర్డ్"]),
    "kyc": (3, ["kyc", "account blocked", "account will be blocked", "account suspended",
                "will be blocked", "deactivated", "pan update", "aadhaar update", "sim blocked",
                "खाता बंद", "ब्लॉक", "केवाईसी", "ఖాతా బ్లాక్", "బ్లాక్ అవుతుంది", "కేవైసీ"]),
    "prize": (3, ["lottery", "you have won", "you won", "prize", "lucky draw", "cashback",
                  "reward points", "gift", "jackpot", "लॉटरी", "इनाम", "जीत", "कैशबैक",
                  "లాటరీ", "బహుమతి", "గెలుచుకున్నారు", "క్యాష్‌బ్యాక్"]),
    "urgent": (2, ["urgent", "immediately", "within 24 hours", "today only", "last chance",
                   "act now", "expire", "तुरंत", "जल्दी", "आज ही", "వెంటనే", "ఈరోజే", "అత్యవసరం"]),
    "remote": (5, ["anydesk", "teamviewer", "quicksupport", "quick support", "screen share",
                   "rustdesk", "install this app", "download this app"]),
    "collect": (4, ["enter pin to receive", "scan to receive", "receive money", "refund",
                    "पैसे पाने", "రిఫండ్", "డబ్బు పొందడానికి"]),
    "authority": (3, ["police", "cbi", "customs", "digital arrest", "courier", "parcel",
                      "income tax", "electricity will be disconnected", "power cut tonight",
                      "पुलिस", "पार्सल", "बिजली कट", "పోలీస్", "పార్సెల్", "కరెంట్ కట్"]),
    "phone": (1, ["call this number", "call immediately", "contact this number",
                  "इस नंबर पर कॉल", "ఈ నంబర్‌కు కాల్"]),
}

SHORTENERS = ["bit.ly", "tinyurl", "goo.gl", "cutt.ly", "is.gd", "t.co", "rb.gy", "shorturl",
              "tiny.cc", "ow.ly"]
BAD_TLDS = [".xyz", ".top", ".click", ".loan", ".work", ".rest", ".buzz", ".info", ".online"]
URL_RE = re.compile(r"(https?://[^\s]+|www\.[^\s]+|\b[a-z0-9-]+\.(?:com|in|xyz|top|click|info|online|ly|co|net|org)\b[^\s]*)",
                    re.IGNORECASE)


def check_text(text: str):
    """Return {'level': safe|caution|danger, 'score': int, 'reasons': [...], 'matches': [...]}"""
    raw = text or ""
    norm = normalize(raw)
    score, reasons, matches = 0, [], []
    for key, (weight, phrases) in SCAM_RULES.items():
        hit = [p for p in phrases if _contains(norm, p)]
        if hit:
            score += weight
            reasons.append(key)
            matches.extend(hit[:3])

    urls = URL_RE.findall(raw)
    if urls:
        bad = []
        for u in urls:
            lu = u.lower()
            if any(s in lu for s in SHORTENERS) or any(lu.split("/")[0].endswith(t) or t + "/" in lu for t in BAD_TLDS) \
                    or lu.startswith("http://") or re.search(r"\d+\.\d+\.\d+\.\d+", lu):
                bad.append(u)
        if bad:
            score += 4
            reasons.append("link")
            matches.extend(bad[:3])
        else:
            score += 1
            reasons.append("link_unknown")
            matches.extend(urls[:2])

    if score >= 6 or ("otp" in reasons and len(reasons) > 1) or "remote" in reasons:
        level = "danger"
    elif score >= 3:
        level = "caution"
    else:
        level = "safe"
    return {"level": level, "score": score, "reasons": reasons, "matches": matches}


def check_payment(conn, user_id: int, payee: str, amount: int, category: str = None, when=None):
    """Return a list of warning dicts shown on the confirmation screen.
    'blocking' warnings stop the payment until a family member approves."""
    when = when or datetime.now()
    warnings = []
    user = conn.execute("SELECT daily_limit FROM users WHERE id=?", (user_id,)).fetchone()
    limit = user["daily_limit"] if user else 5000

    known = conn.execute(
        "SELECT COUNT(*) FROM transactions WHERE user_id=? AND payee=? AND status='success'",
        (user_id, payee)).fetchone()[0]
    if not known:
        warnings.append({"key": "new_payee", "blocking": False})

    spent_today = conn.execute(
        "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE user_id=? AND status='success' "
        "AND date(completed_at)=date(?)", (user_id, when.isoformat())).fetchone()[0]
    if spent_today + amount > limit:
        warnings.append({"key": "over_limit", "blocking": True, "limit": limit,
                         "spent_today": spent_today})

    past = conn.execute(
        "SELECT AVG(amount) FROM transactions WHERE user_id=? AND payee=? AND status='success'",
        (user_id, payee)).fetchone()[0]
    if past and amount > 3 * past:
        warnings.append({"key": "high_amount", "blocking": False, "usual": int(past)})

    if when.hour >= 22 or when.hour < 6:
        warnings.append({"key": "late_night", "blocking": False})
    return warnings
