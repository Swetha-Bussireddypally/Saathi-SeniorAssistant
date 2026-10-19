"""Shared configuration for the Saathi prototype."""
import os

APP_NAME = "Saathi"

# Ordered steps of every guided task. The volunteer dashboard uses these to
# draw funnels and to find where people drop off.
TASK_STEPS = {
    "bill": ["start", "category", "consumer", "verify_number", "fetch_bill",
             "review", "confirm", "complete"],
    "ticket": ["start", "mode", "from", "to", "date", "choose_option", "seat",
               "confirm", "complete"],
    "call": ["start", "choose_contact", "confirm_call", "in_call", "complete"],
    "scam_check": ["start", "message", "result", "complete"],
    "doc": ["start", "upload", "explain", "complete"],
}

TASK_LABELS = {
    "bill": "Bill Payment",
    "ticket": "Ticket Booking",
    "call": "Video Call",
    "scam_check": "Message Check",
    "doc": "Read a Bill / Letter",
}

STEP_LABELS = {
    "start": "Started", "category": "Choose bill type", "consumer": "Enter consumer no.",
    "verify_number": "Verify number", "fetch_bill": "Fetch bill", "review": "Review bill",
    "confirm": "Payment confirmation", "complete": "Completed", "mode": "Bus or train",
    "from": "From city", "to": "To city", "date": "Travel date",
    "choose_option": "Choose bus/train", "seat": "Seat preference",
    "choose_contact": "Choose contact", "confirm_call": "Confirm call",
    "in_call": "In call", "message": "Read/paste message", "result": "Scam result",
    "upload": "Upload bill / letter", "explain": "Document explained",
}

LANG_LABELS = {"en": "English", "hi": "Hindi", "te": "Telugu"}

DEFAULT_DAILY_LIMIT = 5000          # ₹ — payments above this need family approval
CONFIRM_MIN_SECONDS = 3             # a payment cannot be confirmed faster than this
STUCK_RETRY_THRESHOLD = 3           # "not understood" retries before a user counts as stuck

# Video calls open a Jitsi room. Point this at your own Jitsi server if needed.
JITSI_DOMAIN = os.environ.get("JITSI_DOMAIN", "meet.jit.si")

# Cities for the mock ticket service: id -> (English name, latitude, longitude)
CITIES = {
    "hyderabad": ("Hyderabad", 17.385, 78.487),
    "warangal": ("Warangal", 17.968, 79.594),
    "vijayawada": ("Vijayawada", 16.506, 80.648),
    "visakhapatnam": ("Visakhapatnam", 17.687, 83.218),
    "tirupati": ("Tirupati", 13.628, 79.419),
    "bengaluru": ("Bengaluru", 12.972, 77.594),
    "chennai": ("Chennai", 13.083, 80.270),
    "mumbai": ("Mumbai", 19.076, 72.878),
}
