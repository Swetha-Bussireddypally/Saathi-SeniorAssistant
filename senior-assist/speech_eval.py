"""Speech recognition accuracy metrics: Word Error Rate (WER) and Character Error Rate (CER).

WER = (substitutions + deletions + insertions) / words in the expected sentence.
CER is the same at character level — more meaningful for Telugu, where one long
word can carry several suffixes and a single small slip makes the whole word "wrong".
"""
from intents import normalize

NUMBER_WORDS = {
    # English
    "zero": "0", "oh": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9",
    # Hindi
    "शून्य": "0", "एक": "1", "दो": "2", "तीन": "3", "चार": "4", "पांच": "5", "पाँच": "5",
    "छह": "6", "छः": "6", "सात": "7", "आठ": "8", "नौ": "9",
    # Telugu
    "సున్నా": "0", "ఒకటి": "1", "రెండు": "2", "మూడు": "3", "నాలుగు": "4", "ఐదు": "5",
    "ఆరు": "6", "ఏడు": "7", "ఎనిమిది": "8", "తొమ్మిది": "9",
}
INDIC_DIGITS = str.maketrans("०१२३४५६७८९౦౧౨౩౪౫౬౭౮౯", "01234567890123456789")


def _tokens(text):
    text = (text or "").translate(INDIC_DIGITS)
    toks = []
    for w in normalize(text).split():
        w = NUMBER_WORDS.get(w, w)
        if w.isdigit() and len(w) > 1:      # "9876" and "9 8 7 6" should compare equal
            toks.extend(list(w))
        else:
            toks.append(w)
    return toks


def _edit_distance(a, b):
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y))
        prev = cur
    return prev[-1]


def wer(expected, heard):
    ref, hyp = _tokens(expected), _tokens(heard)
    if not ref:
        return 0.0 if not hyp else 1.0
    return round(_edit_distance(ref, hyp) / len(ref), 3)


def cer(expected, heard):
    ref = "".join(_tokens(expected))
    hyp = "".join(_tokens(heard))
    if not ref:
        return 0.0 if not hyp else 1.0
    return round(_edit_distance(list(ref), list(hyp)) / len(ref), 3)
