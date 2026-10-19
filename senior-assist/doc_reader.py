"""Bill / document reader.

read_upload()  → turns an uploaded PDF or photo (or pasted text) into plain text
explain()      → finds the parts a senior needs: who it is from, how much, by when, which number,
                 what kind of bill — and checks the text for scam signs.

PDF bills are read with pypdf (pure Python, always available).
Photos are read with Tesseract OCR if it is installed (optional):
    macOS:   brew install tesseract tesseract-lang   and   pip install pytesseract
Nothing is saved: the file is read in memory and thrown away.
"""
import io
import re
import shutil
from datetime import date, datetime

from scam_checker import check_text

MAX_PAGES = 5
MAX_CHARS = 20000


class ReadError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _kind(data: bytes):
    if data[:5] == b"%PDF-":
        return "pdf"
    if data[:8] == b"\x89PNG\r\n\x1a\n" or data[:3] == b"\xff\xd8\xff" or data[:4] in (b"RIFF",) or data[:6] in (b"GIF87a", b"GIF89a"):
        return "image"
    return None


def ocr_available():
    try:
        import pytesseract  # noqa: F401
    except ImportError:
        return False
    return shutil.which("tesseract") is not None


def read_upload(data: bytes = b"", pasted: str = ""):
    """Return (text, source) or raise ReadError('empty'|'bad_type'|'no_text'|'ocr_unavailable')."""
    if pasted and pasted.strip():
        return pasted.strip()[:MAX_CHARS], "text"
    if not data:
        raise ReadError("empty")
    kind = _kind(data)
    if kind == "pdf":
        from pypdf import PdfReader
        try:
            reader = PdfReader(io.BytesIO(data))
            text = "\n".join((p.extract_text() or "") for p in reader.pages[:MAX_PAGES])
        except Exception:
            raise ReadError("bad_type")
        if len(text.strip()) < 20:
            raise ReadError("no_text")          # a scanned PDF (picture only)
        return text[:MAX_CHARS], "pdf"
    if kind == "image":
        if not ocr_available():
            raise ReadError("ocr_unavailable")
        import pytesseract
        from PIL import Image, ImageOps
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img).convert("L")
        if max(img.size) < 1400:                 # small photos read better when enlarged
            f = 1400 / max(img.size)
            img = img.resize((int(img.width * f), int(img.height * f)))
        langs = [l for l in ("eng", "hin", "tel") if l in pytesseract.get_languages(config="")]
        text = pytesseract.image_to_string(img, lang="+".join(langs) or "eng")
        if len(text.strip()) < 20:
            raise ReadError("no_text")
        return text[:MAX_CHARS], "photo"
    raise ReadError("bad_type")


# ---------------------------------------------------------------- understanding the bill
KINDS = {
    "electricity": ["electricity", "power", "kwh", "units consumed", "discom", "spdcl", "electric", "बिजली", "విద్యుత్", "కరెంట్"],
    "water": ["water", "sewerage", "jal", "पानी", "जल", "నీటి", "నీరు"],
    "mobile": ["mobile", "postpaid", "airtel", "jio", "vodafone", "vi ", "bsnl", "recharge", "मोबाइल", "మొబైల్"],
    "gas": ["gas", "lpg", "cylinder", "गैस", "గ్యాస్"],
    "bank": ["bank", "account statement", "loan", "emi", "credit card", "बैंक", "బ్యాంక్"],
    "medical": ["hospital", "pharmacy", "medical", "prescription", "clinic", "अस्पताल", "ఆసుపత్రి"],
    "government": ["government", "pension", "aadhaar", "ration", "tax", "municipal", "सरकार", "ప్రభుత్వ"],
}
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
DATE_RE = r"(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s*[-/ ]?\s*[A-Za-z]{3,9}\.?\s*[-/ ,]?\s*\d{2,4})"
MONEY = r"(?:₹|rs\.?|inr|रु\.?|రూ\.?)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)"


def _parse_date(s):
    s = s.strip().replace(",", " ")
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})$", s)
    if m:
        y, mo, d = map(int, m.groups())
    else:
        m = re.match(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$", s)
        if m:
            d, mo, y = map(int, m.groups())          # Indian bills: day first
        else:
            m = re.match(r"(\d{1,2})\s*[-/ ]?\s*([A-Za-z]{3,9})\.?\s*[-/ ]?\s*(\d{2,4})$", s)
            if not m or m.group(2)[:3].lower() not in MONTHS:
                return None
            d, mo, y = int(m.group(1)), MONTHS[m.group(2)[:3].lower()], int(m.group(3))
    if y < 100:
        y += 2000
    try:
        return date(y, mo, d)
    except ValueError:
        return None


def _amount(text):
    low = text.lower()
    keys = [r"total\s+amount\s+(?:payable|due)", r"amount\s+payable", r"net\s+(?:amount\s+)?payable", r"total\s+(?:amount\s+)?due",
            r"amount\s+due", r"bill\s+amount", r"total\s+payable", r"grand\s+total", r"total", r"payable",
            r"कुल\s*राशि", r"देय\s*राशि", r"భరించవలసిన", r"మొత్తం"]
    for k in keys:
        for m in re.finditer(k + r"[^0-9₹\n]{0,25}" + MONEY, low, re.I):
            try:
                v = float(m.group(1).replace(",", ""))
            except ValueError:
                continue
            if 1 <= v <= 10_000_000:
                return round(v, 2)
    vals = [float(m.group(1).replace(",", "")) for m in re.finditer(r"(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)", low)]
    return round(max(vals), 2) if vals else None


def _labelled_date(text, labels):
    for lab in labels:
        m = re.search(lab + r"[^0-9A-Za-z\n]{0,20}" + DATE_RE, text, re.I)
        if m:
            d = _parse_date(m.group(1))
            if d:
                return d
    return None


def _number(text):
    m = re.search(r"(?:consumer|account|customer|service|connection|ca|usc|k\s*no|relationship|mobile)\s*(?:no\.?|number|id|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-/]{4,19})", text, re.I)
    if m and re.search(r"\d", m.group(1)):
        return m.group(1).strip("-/")
    return None


def _biller(text, kind):
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    for l in lines[:12]:
        if re.search(r"(board|limited|ltd|corporation|department|discom|power|water|bank|telecom|airtel|jio|bsnl|municipal|authority|company)", l, re.I) and len(l) <= 70:
            return re.sub(r"\s+", " ", l)
    return re.sub(r"\s+", " ", lines[0])[:60] if lines else None


def explain(text, today=None):
    today = today or date.today()
    low = text.lower()
    scores = {k: sum(low.count(w) for w in ws) for k, ws in KINDS.items()}
    kind = max(scores, key=scores.get) if max(scores.values()) else "other"
    due = _labelled_date(text, [r"due\s*date", r"last\s*date(?:\s*(?:of|for)\s*payment)?", r"pay\s*(?:by|before)", r"payment\s*due",
                                r"अंतिम\s*तिथि", r"చివరి\s*తేదీ"])
    bill_date = _labelled_date(text, [r"bill\s*date", r"date\s*of\s*bill", r"issue\s*date", r"invoice\s*date"])
    units = None
    m = re.search(r"(?:units?\s*(?:consumed)?|consumption|kwh)\s*[:\-]?\s*([0-9]{1,6})", text, re.I)
    if m:
        units = int(m.group(1))
    amount = _amount(text)
    days_left = (due - today).days if due else None
    number = _number(text)
    if kind == "mobile":
        mm = re.search(r"\b([6-9]\d{9})\b", text)
        number = mm.group(1) if mm else number
    scam = check_text(text)
    return {
        "kind": kind,
        "biller": _biller(text, kind),
        "amount": amount,
        "due_date": due.isoformat() if due else None,
        "days_left": days_left,
        "bill_date": bill_date.isoformat() if bill_date else None,
        "number": number,
        "units": units,
        "scam": scam,
        "payable": kind in ("electricity", "water", "mobile") and bool(number),
        "chars": len(text),
        "preview": re.sub(r"\s+", " ", text)[:600],
    }
