"""Multilingual intent detection (English, Hindi, Telugu, and romanised Hindi/Telugu).

Rule-based on purpose: it is fast, works offline, is easy to explain to judges and
easy to extend with new accents/words found in the volunteer dashboard's
"not understood" log. It scores every intent and returns the best one.
"""
import re
import unicodedata

INTENT_KEYWORDS = {
    "bill": {
        "en": ["bill", "pay", "payment", "electricity", "current bill", "power bill",
               "water", "mobile bill", "recharge", "gas bill", "karent", "bijli", "bharna",
               "paani", "kattali"],
        "hi": ["बिल", "बिजली", "पानी", "भुगतान", "भरना", "भरनी", "रिचार्ज", "पेमेंट"],
        "te": ["బిల్లు", "బిల్", "కరెంట్", "కరెంటు", "విద్యుత్", "నీటి", "నీళ్ళ", "నీళ్ల",
               "చెల్లించ", "కట్టాలి", "కట్టు", "రీఛార్జ్", "పేమెంట్"],
    },
    "ticket": {
        "en": ["ticket", "book", "booking", "train", "bus", "travel", "journey", "seat",
               "reservation", "trip", "tikat", "gaadi"],
        "hi": ["टिकट", "ट्रेन", "रेल", "गाड़ी", "बस", "यात्रा", "सफर", "बुक", "रिज़र्वेशन"],
        "te": ["టికెట్", "టిక్కెట్", "రైలు", "ట్రైన్", "బస్సు", "బస్", "ప్రయాణం", "బుక్",
               "రిజర్వేషన్", "బండి"],
    },
    "call": {
        "en": ["call", "video", "talk to", "speak to", "son", "daughter", "grandson",
               "granddaughter", "phone", "ring", "beta", "beti"],
        "hi": ["कॉल", "काल", "वीडियो", "बात", "बेटा", "बेटे", "बेटी", "पोता", "फोन", "फ़ोन"],
        "te": ["కాల్", "వీడియో", "మాట్లాడ", "కొడుకు", "అబ్బాయి", "కూతురు", "అమ్మాయి",
               "మనవడు", "ఫోన్", "ఫోను"],
    },
    "scam_check": {
        "en": ["message", "sms", "suspicious", "fraud", "scam", "link", "check this",
               "fake", "is this real", "whatsapp"],
        "hi": ["मैसेज", "संदेश", "धोखा", "फ्रॉड", "फ़्रॉड", "लिंक", "नकली", "जाँच", "जांच"],
        "te": ["మెసేజ్", "సందేశం", "మోసం", "మోసమా", "ఫ్రాడ్", "లింక్", "నకిలీ"],
    },
    "doc": {
        "en": ["read my bill", "read the bill", "read this", "read", "document", "letter", "scan", "photo of"],
        "hi": ["पढ़कर", "पढ़ो", "पढ़िए", "सुनाओ", "चिट्ठी", "कागज़", "कागज"],
        "te": ["చదివి", "చదువు", "చదవండి", "ఉత్తరం", "కాగితం"],
    },
    "history": {
        "en": ["history", "my payments", "past payments", "previous payments", "old payments", "payment history",
               "transactions", "what did i pay", "failed payment", "failed", "payment failed", "receipts", "hisaab", "hisab"],
        "hi": ["इतिहास", "हिस्ट्री", "पिछले भुगतान", "पुराने भुगतान", "लेन-देन", "लेनदेन", "हिसाब", "मेरे भुगतान"],
        "te": ["చరిత్ర", "హిస్టరీ", "గత చెల్లింపులు", "పాత చెల్లింపులు", "లావాదేవీలు", "నా చెల్లింపులు", "లెక్క"],
    },
    "help": {
        "en": ["help", "volunteer", "confused", "don't understand", "not understanding"],
        "hi": ["मदद", "सहायता", "समझ नहीं"],
        "te": ["సహాయం", "సాయం", "అర్థం కాలేదు"],
    },
}

# Words that are much stronger evidence than generic ones like "pay" or "book".
STRONG = {"electricity", "bijli", "बिजली", "కరెంట్", "కరెంటు", "train", "bus", "ट्रेन",
          "రైలు", "బస్సు", "video", "वीडियो", "వీడియో", "scam", "fraud", "धोखा", "మోసం",
          "ticket", "टिकट", "టికెట్", "bill", "बिल", "బిల్లు",
          "read my bill", "document", "letter", "चिट्ठी", "पढ़कर", "ఉత్తరం", "చదివి",
          "history", "failed", "my payments", "past payments", "payment history", "इतिहास", "पिछले भुगतान", "हिसाब",
          "చరిత్ర", "గత చెల్లింపులు", "నా చెల్లింపులు", "లావాదేవీలు"}


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFC", text or "").lower()
    # keep letters, combining marks (needed for Indic scripts), digits and spaces
    out = []
    for ch in text:
        cat = unicodedata.category(ch)
        out.append(ch if cat[0] in "LMN" or ch == " " or ch == "'" else " ")
    return re.sub(r"\s+", " ", "".join(out)).strip()


def _contains(norm_text: str, kw: str) -> bool:
    kw = normalize(kw)
    if not kw:
        return False
    if kw.isascii():
        return re.search(r"(?<![a-z])" + re.escape(kw) + r"(?![a-z])", norm_text) is not None
    # Indic words get suffixes attached (బిల్లును, बिजली का) → substring match
    return kw in norm_text


def detect_intent(text: str):
    """Return (intent or None, confidence 0..1, matched keywords)."""
    norm = normalize(text)
    if not norm:
        return None, 0.0, []
    scores, matched = {}, {}
    for intent, by_lang in INTENT_KEYWORDS.items():
        s, hits = 0.0, []
        for words in by_lang.values():
            for kw in words:
                if _contains(norm, kw):
                    s += 2.0 if kw in STRONG else 1.0
                    hits.append(kw)
        if s:
            scores[intent], matched[intent] = s, hits
    if not scores:
        return None, 0.0, []
    best = max(scores, key=scores.get)
    # "read my electricity bill" is about READING, even though it mentions a bill
    if scores.get("doc", 0) >= 2 and best == "bill":
        best = "doc"
    # "show my past payments" is about HISTORY, even though it says "payment"
    if scores.get("history", 0) >= 2 and best in ("bill", "ticket"):
        best = "history"
    total = sum(scores.values())
    return best, round(scores[best] / total, 2), matched[best]


YES_WORDS = ["yes", "yeah", "yep", "ok", "okay", "correct", "right", "confirm", "sure",
             "haan", "ha", "han", "ji", "sahi", "avunu", "sare",
             "हाँ", "हां", "हा", "जी", "ठीक", "सही", "अवश्य",
             "అవును", "సరే", "ఔను", "కరెక్ట్", "ఓకే"]
NO_WORDS = ["no", "nope", "wrong", "cancel", "stop", "nahi", "nahin", "vaddu", "kaadu",
            "नहीं", "नही", "ना", "गलत", "रद्द",
            "వద్దు", "కాదు", "లేదు", "తప్పు", "రద్దు"]


def detect_yes_no(text: str):
    norm = normalize(text)
    no = any(_contains(norm, w) for w in NO_WORDS)
    yes = any(_contains(norm, w) for w in YES_WORDS)
    if no and not yes:
        return "no"
    if yes and not no:
        return "yes"
    return None
