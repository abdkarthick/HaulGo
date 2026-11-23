"""AI assistant: text chat and voice assistant share this one endpoint (the browser does speech-to-text and text-to-speech).

Uses the Gemini API when GEMINI_API_KEY is set. Without a key it falls back to a small built-in FAQ so the feature
still works, clearly labelled as "basic" mode.
"""
import logging

import httpx
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models as m
from ..core import GEMINI_API_KEY, GEMINI_MODEL, decode_token, get_db, get_settings, rate_limit

router = APIRouter()
log = logging.getLogger("haulgo.ai")

LANG_NAMES = {"en": "English", "ta": "Tamil", "hi": "Hindi", "te": "Telugu", "kn": "Kannada", "ml": "Malayalam", "bn": "Bengali", "mr": "Marathi"}

KNOWLEDGE = """HaulGo is an industrial goods transport marketplace by HighCodeX Technologies (India).
Customers book verified truck owners (drivers) for raw materials, components, machinery and finished goods.
- Booking: pick pickup and drop, enter goods details and weight, choose a vehicle, confirm. Fares are calculated by the server from road distance; heavy or special loads get a custom quotation from the HaulGo team.
- Instant booking or scheduled booking (pickup at least 30 minutes ahead).
- Pickup OTP: the customer shares a 4-digit pickup OTP only with the driver at pickup; loading starts after the driver verifies it. A delivery OTP is given to the receiver; delivery completes after verification.
- Live GPS tracking, a shareable tracking link for the receiver, in-app chat and masked calls (phone numbers stay private).
- Payments: online (Razorpay), cash on delivery (limited trips), or business credit for approved accounts. GST invoice is available after delivery.
- Cancellation may carry a fee depending on the stage. Refunds are completed after provider confirmation.
- Drivers: register vehicle and documents (licence and RC are required), wait for HaulGo verification, go online, accept trips assigned by the HaulGo team, verify pickup OTP, upload pickup/delivery photos, collect COD cash if applicable. Earnings go to a wallet and can be withdrawn to bank/UPI (minimum 100 rupees). Platform commission applies.
- Help: SOS and complaints inside the trip screen; support phone is {support}.
"""


class Msg(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    text: str = Field(max_length=1500)


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    history: list[Msg] = Field(default_factory=list, max_length=12)
    lang: str = "en"
    voice: bool = False  # voice replies are kept short because they are spoken aloud
    topic: str | None = Field(default=None, pattern="^(booking|track|pay|fare|otp|support|register|earn)$")  # tapped quick option


TOPICS = {
    "booking": "To book a truck: open Book, choose pickup and drop, add goods details and weight, pick a vehicle and confirm. Choose Instant or Scheduled (at least 30 minutes ahead). Heavy or special loads get a custom quotation from the HaulGo team.",
    "track": "Open the Trips tab and tap your trip to see live GPS tracking, driver details and status. You can also share the tracking link with the receiver, chat with the driver or call through the app.",
    "pay": "You can pay online, pay cash on delivery (limited trips) or use business credit if your company is approved. A GST invoice is available after delivery. Refunds are completed after the payment provider confirms them.",
    "fare": "Fares are calculated from the road distance and the vehicle you choose: Scooty (up to 20 kg), Bike (50 kg), Auto (500 kg), Mini Truck (750 kg), Pickup (1.5 t), Medium Truck (4 t), Heavy Truck (9 t) and Trailer (16 t). The exact fare is shown on the Book screen before you confirm.",
    "otp": "Share the 4-digit pickup OTP only with the driver when you hand over the goods. The receiver gets a delivery OTP and the trip completes after it is verified. Never share OTPs with anyone else. Use SOS or a complaint from the trip screen if you feel unsafe.",
    "support": "You can raise a complaint or SOS from the trip screen. Support phone: {support}.",
    "register": "To drive with HaulGo: register your vehicle and documents (licence and RC are required), wait for HaulGo verification, then go online. Trips are assigned by the HaulGo team and you accept them in the app.",
    "earn": "After each completed trip your earnings go to your wallet. Open the Earnings tab to see this week, your wallet balance, COD cash and commission due, and to withdraw to your UPI or bank account (minimum 100 rupees).",
}

_GREET = ("hi", "hii", "hiii", "hello", "hey", "hai", "helo", "yo", "vanakkam", "vanakam", "namaste", "namaskar", "namaskaram", "nomoskar", "good morning", "good afternoon", "good evening", "gm", "sup")


def _smalltalk(t: str, support: str) -> str | None:
    words = t.strip(" !.?,").split()
    flat = " ".join(words)
    if flat in _GREET or (words and words[0] in _GREET and len(words) <= 3):
        return "Hi! I am the HaulGo assistant. How can I help you today? You can type a question or pick a topic below."
    if "thank" in flat or flat in ("ok", "okay", "k", "fine", "super", "nice", "good", "great", "cool", "நன்றி", "धन्यवाद"):
        return "You are welcome! Anything else I can help with?"
    if flat in ("bye", "goodbye", "see you", "tata", "ta ta") or flat.startswith("bye"):
        return "Bye! Have a great day. I am here whenever you need help."
    if "how are you" in flat or "how r u" in flat or "how are u" in flat:
        return "I am doing well, thank you for asking! How can I help you with HaulGo today?"
    if "who are you" in flat or "your name" in flat or "what are you" in flat or "who r u" in flat:
        return "I am the HaulGo assistant. I can help you book trucks, check fares, track trips and answer questions about payments, OTP and driver registration."
    if "what can you do" in flat or flat in ("help", "help me", "menu", "options"):
        return "I can help with booking a truck, fares and vehicles, tracking your trip, payments and refunds, OTP and safety, and driver registration. Pick a topic below or just ask."
    return None


def _optional_user(request: Request, db: Session) -> m.User | None:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    try:
        data = decode_token(auth[7:])
        u = db.get(m.User, int(data["sub"]))
        return u if u and u.status == "active" and u.role in ("customer", "driver") else None
    except Exception:
        return None


def _user_context(db: Session, u: m.User | None) -> str:
    if not u:
        return "The person is not logged in."
    lines = [f"The person is logged in as a {u.role}" + (f" named {u.name}." if u.name else ".")]
    if u.role == "customer":
        rows = db.query(m.Booking).filter_by(customer_id=u.id).order_by(m.Booking.id.desc()).limit(3).all()
    else:
        d = db.query(m.Driver).filter_by(user_id=u.id).first()
        rows = db.query(m.Booking).filter_by(driver_id=d.id).order_by(m.Booking.id.desc()).limit(3).all() if d else []
        if d:
            lines.append(f"Driver verification status: {d.status}.")
    for b in rows:
        lines.append(f"Recent booking {b.code}: status {b.status}, from {(b.pickup_address or '')[:60]} to {(b.drop_address or '')[:60]}.")
    return " ".join(lines)


def _basic_reply(text: str, support: str) -> str:
    t = text.lower()
    talk = _smalltalk(t, support)
    if talk:
        return talk
    faq = [
        (("otp",), "The pickup OTP is shared only with the driver at pickup. The delivery OTP is given to the receiver. The driver completes each step only after verifying the OTP."),
        (("fare", "price", "cost", "rate", "charge"), "Fares are calculated by the server from the road distance and the vehicle you choose. Heavy or special loads get a custom quotation from our team."),
        (("pay", "cod", "cash", "credit", "refund", "invoice", "gst"), "You can pay online, pay cash on delivery (limited trips), or use business credit if approved. A GST invoice is available after delivery."),
        (("track", "where", "location", "gps"), "Open your trip from the Trips tab to see live GPS tracking. You can also share the tracking link with the receiver."),
        (("cancel",), "You can cancel from the trip screen before pickup. A cancellation fee may apply depending on the stage."),
        (("book", "vehicle", "truck", "load"), "To book: open Book, choose pickup and drop, add goods details and weight, pick a vehicle and confirm."),
        (("driver", "register", "document", "licence", "license", "earn", "wallet", "withdraw"), "Drivers register a vehicle and documents (licence and RC are required), get verified by HaulGo, then go online to receive trips. Earnings go to your wallet and can be withdrawn to bank or UPI."),
        (("help", "support", "contact", "complaint", "sos"), f"You can raise a complaint or SOS from the trip screen. Support phone: {support}."),
    ]
    for keys, ans in faq:
        if any(k in t for k in keys):
            return ans
    return f"I did not fully get that, but I am happy to help. I can answer questions about booking, fares, tracking, payments, OTP and driver registration. Please pick a topic below, or call support at {support}."


def _gemini_reply(body: ChatIn, system: str, timeout: float = 12) -> str:
    contents = [{"role": "user" if h.role == "user" else "model", "parts": [{"text": h.text}]} for h in body.history[-10:]]
    contents.append({"role": "user", "parts": [{"text": body.message}]})
    headers = {"x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json"}
    last: Exception | None = None
    for model in dict.fromkeys([GEMINI_MODEL, "gemini-flash-latest"]):  # preferred model first, then the always-current alias
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

        def call(gen_cfg: dict):
            return httpx.post(url, headers=headers, timeout=timeout,
                              json={"systemInstruction": {"parts": [{"text": system}]}, "contents": contents, "generationConfig": gen_cfg})
        try:
            # Low thinking keeps chat replies fast. If a model does not accept the setting, retry without it.
            r = call({"maxOutputTokens": 800, "thinkingConfig": {"thinkingLevel": "low"}})
            if r.status_code == 400:
                r = call({"maxOutputTokens": 800})
            r.raise_for_status()
            parts = r.json()["candidates"][0]["content"]["parts"]
            text = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
            if text:
                return text
        except Exception as exc:
            last = exc
            detail = getattr(getattr(exc, "response", None), "text", "")[:300]
            log.warning("Gemini request failed (%s): %s %s", model, exc, detail)
    if last:
        raise last
    return ""


_TOPIC_CACHE: dict[tuple[str, str], str] = {}


@router.post("/ai/chat")
def ai_chat(body: ChatIn, request: Request, db: Session = Depends(get_db)):
    u = _optional_user(request, db)
    rate_limit(f"ai:{u.id if u else request.client.host if request.client else 'x'}", 30, 600)
    support = get_settings(db).get("support_phone") or "+91 81487 69354"
    lang = LANG_NAMES.get(body.lang, "English")
    if body.topic:
        fixed = TOPICS[body.topic].format(support=support)
        if GEMINI_API_KEY and lang != "English":
            cached = _TOPIC_CACHE.get((body.topic, lang))
            if cached:
                return {"reply": cached, "mode": "ai"}
            try:
                tr = _gemini_reply(ChatIn(message=f"Translate into {lang}, keep it short and friendly, plain text only, keep numbers: {fixed}", lang=body.lang), f"You are a translator. Reply only with the {lang} translation.", timeout=10)
                if tr:
                    _TOPIC_CACHE[(body.topic, lang)] = tr
                    return {"reply": tr, "mode": "ai"}
            except Exception:
                pass
        return {"reply": fixed, "mode": "ai" if GEMINI_API_KEY else "basic"}
    if not GEMINI_API_KEY:
        return {"reply": _basic_reply(body.message, support), "mode": "basic"}
    system = (
        "You are the friendly HaulGo assistant inside the HaulGo app. ALWAYS reply to whatever the person writes, even a simple greeting like hi, thanks, bye or small talk: answer warmly in one short sentence and then offer help. "
        "Your main job is HaulGo: booking, fares, OTP, tracking, payments, driver registration and trips. If the question is unrelated to HaulGo, give a brief, polite answer or say you are not sure, then steer back to what you can help with. Never invent fares, prices, driver details or booking status: use only the facts below, "
        "and for exact fares tell the person to check the Book screen. Never ask for or repeat OTPs, passwords or bank details. "
        f"Reply in {lang}, in the same language the person writes in if they switch. "
        + ("The reply will be spoken aloud: use at most 2 short sentences and no lists, no markdown, no emojis. " if body.voice else "Keep replies short (under 80 words), plain text, no markdown. ")
        + "\n\nFACTS:\n" + KNOWLEDGE.format(support=support) + "\nCONTEXT: " + _user_context(db, u)
    )
    try:
        reply = _gemini_reply(body, system)
        if reply:
            return {"reply": reply, "mode": "ai"}
    except Exception as exc:
        detail = getattr(getattr(exc, "response", None), "text", "")[:300]
        log.warning("Gemini request failed (%s): %s %s", GEMINI_MODEL, exc, detail)
    return {"reply": _basic_reply(body.message, support), "mode": "basic"}