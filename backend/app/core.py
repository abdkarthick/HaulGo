"""Core services: config, DB session, security, settings, audit, notifications, geo, fare, state machine, wallet."""
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
import jwt
from fastapi import Depends, HTTPException, Query, Request
from sqlalchemy import create_engine, func
from sqlalchemy.orm import Session, sessionmaker

from . import models as m

# ------------------------------------------------------------------ config
BASE_DIR = Path(__file__).resolve().parent.parent


def _load_env_file():
    """Optional backend/.env file (KEY=value per line) so keys do not have to be set in the terminal every time."""
    f = BASE_DIR / ".env"
    if not f.is_file():
        return
    for line in f.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env_file()
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'haulgo.db'}")
JWT_SECRET = os.getenv("JWT_SECRET", "dev-only-change-me-" + hashlib.sha256(str(BASE_DIR).encode()).hexdigest()[:16])
JWT_HOURS = int(os.getenv("JWT_HOURS", "720"))
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", BASE_DIR / "uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
DEV_MODE = os.getenv("DEV_MODE", "1") == "1"  # exposes OTP in API response when no SMS provider
DEMO_MODE = os.getenv("DEMO_MODE", "1") == "1"  # seeds clearly marked demo drivers/customer
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@highcodex.online")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "Admin@12345")
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
SMS_PROVIDER = os.getenv("SMS_PROVIDER", "")  # e.g. msg91 | twilio (integration hook, needs credentials + DLT)
CALL_PROVIDER = os.getenv("CALL_PROVIDER", "")  # exotel | knowlarity
FCM_CREDENTIALS = os.getenv("FCM_CREDENTIALS", "")
SMTP_HOST = os.getenv("SMTP_HOST", "")  # e.g. smtp.hostinger.com (port 465 SSL) or smtp.gmail.com (port 587 STARTTLS, app password)
SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "") or SMTP_USER
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")  # OAuth web client id for "Sign in with Google"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")  # free Google AI Studio key for the AI assistant
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")  # fast, low-cost model that suits chat; falls back to gemini-flash-latest
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:5173")
OSRM_URL = os.getenv("OSRM_URL", "https://router.project-osrm.org")
NOMINATIM_URL = os.getenv("NOMINATIM_URL", "https://nominatim.openstreetmap.org")
try:
    IST = ZoneInfo("Asia/Kolkata")
except ZoneInfoNotFoundError:  # Windows without the tzdata package: India has no DST, so a fixed offset is exact
    IST = timezone(timedelta(hours=5, minutes=30), "IST")

RAZORPAY_MODE = ("razorpay_live" if RAZORPAY_KEY_ID.startswith("rzp_live") else "razorpay_test") if RAZORPAY_KEY_ID else ("dev_simulated" if DEV_MODE else "unavailable")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def now() -> datetime:
    return m.utcnow()


def iso(d):
    return d.isoformat() + "Z" if d else None


def send_email(to: str, subject: str, body: str) -> bool:
    """Send a plain-text email through SMTP. Returns False when SMTP is not configured or sending fails."""
    if not (SMTP_HOST and SMTP_USER and SMTP_PASSWORD):
        return False
    import smtplib
    from email.message import EmailMessage
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = SMTP_FROM, to, subject
    msg.set_content(body)
    try:
        if SMTP_PORT == 465:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=15) as s:
                s.login(SMTP_USER, SMTP_PASSWORD)
                s.send_message(msg)
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as s:
                s.starttls()
                s.login(SMTP_USER, SMTP_PASSWORD)
                s.send_message(msg)
        return True
    except Exception:
        return False


# ------------------------------------------------------------------ security
def hash_pw(pw: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(8)
    return salt + "$" + hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 120_000).hex()


def check_pw(pw: str, stored: str) -> bool:
    try:
        salt, _ = stored.split("$")
    except ValueError:
        return False
    return hmac.compare_digest(hash_pw(pw, salt), stored)


def hash_otp(phone: str, code: str) -> str:
    return hmac.new(JWT_SECRET.encode(), f"{phone}:{code}".encode(), hashlib.sha256).hexdigest()


def make_token(user: m.User) -> str:
    exp = now() + timedelta(hours=JWT_HOURS)
    return jwt.encode({"sub": str(user.id), "role": user.role, "exp": exp}, JWT_SECRET, algorithm="HS256")


def decode_token(tok: str) -> dict:
    try:
        return jwt.decode(tok, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Session expired. Please log in again.")


def current_user(request: Request, t: str | None = Query(None), db: Session = Depends(get_db)) -> m.User:
    auth = request.headers.get("authorization", "")
    tok = auth[7:] if auth.lower().startswith("bearer ") else t
    if not tok:
        raise HTTPException(401, "Login required")
    data = decode_token(tok)
    user = db.get(m.User, int(data["sub"]))
    if not user or user.status != "active" or user.role != data["role"]:
        raise HTTPException(401, "Account not available")
    return user


def role_dep(*roles: str, level: str | None = None):
    def dep(user: m.User = Depends(current_user)) -> m.User:
        if user.role not in roles:
            raise HTTPException(403, "You do not have access to this area")
        if level and user.role == "admin" and user.admin_level != level:
            raise HTTPException(403, "Super-admin permission required")
        return user
    return dep


customer_only = role_dep("customer")
driver_only = role_dep("driver")
admin_only = role_dep("admin")
super_admin = role_dep("admin", level="super")


def get_driver(db: Session, user: m.User) -> m.Driver:
    d = db.query(m.Driver).filter_by(user_id=user.id).first()
    if not d:
        raise HTTPException(404, "Driver profile not found")
    return d


_rate: dict[str, list[float]] = {}


def rate_limit(key: str, limit: int, window: int):
    t = time.time()
    hits = [x for x in _rate.get(key, []) if t - x < window]
    if len(hits) >= limit:
        raise HTTPException(429, "Too many attempts. Please wait a few minutes.")
    hits.append(t)
    _rate[key] = hits


# ------------------------------------------------------------------ settings
DEFAULT_SETTINGS = {
    "commission_pct": 10.0,
    "night_pct": 20.0,
    "night_start_hour": 22,
    "night_end_hour": 5,
    "search_radius_km": 40.0,
    "request_timeout_s": 30,
    "broadcast_offers": True,  # offer an instant booking to every suitable online driver at once; first accept wins
    "broadcast_max_drivers": 10,
    "cod_limit": 5,
    "cod_bonus_after_online": 3,  # +1 COD allowance after every N successful online trips (0 = off)
    "cod_commission_threshold": 500.0,
    "payment_expiry_min": 10,
    "cancel_fee_enroute": 50.0,
    "cancel_fee_reached": 150.0,
    "service_area_enforced": False,
    "auto_assign_test_mode": True,  # TEST ONLY: auto-offers to best driver. Admin still can override.
    "quotation_weight_kg": 8000.0,
    "quotation_distance_km": 600.0,
    "long_distance_note_km": 300.0,
    "chat_retention_days": 90,
    "emergency_numbers": {"Police": "100", "Ambulance": "108", "Unified emergency": "112", "Women helpline": "1091"},
    "support_phone": "+91 81487 69354",
    "tracking_stale_seconds": 90,
}


def get_settings(db: Session) -> dict:
    out = dict(DEFAULT_SETTINGS)
    for row in db.query(m.Setting).all():
        try:
            out[row.key] = json.loads(row.value)
        except ValueError:
            pass
    return out


def set_setting(db: Session, key: str, value):
    if key not in DEFAULT_SETTINGS:
        raise HTTPException(400, f"Unknown setting {key}")
    row = db.get(m.Setting, key)
    if row:
        row.value = json.dumps(value)
    else:
        db.add(m.Setting(key=key, value=json.dumps(value)))


def audit(db: Session, actor: m.User | None, action: str, entity: str, entity_id: int | None, detail: str = ""):
    db.add(m.AuditLog(actor_id=actor.id if actor else None, action=action, entity=entity, entity_id=entity_id, detail=detail[:500]))


# ------------------------------------------------------------------ files
ALLOWED_MIME = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf"}


async def save_upload(db: Session, file, user: m.User, kind: str, booking_id=None, driver_id=None, ref_id=None, images_only=False) -> m.Attachment:
    mime = (file.content_type or "").lower()
    if mime not in ALLOWED_MIME or (images_only and mime == "application/pdf"):
        raise HTTPException(400, "Only JPG, PNG, WEBP images" + ("" if images_only else " or PDF") + " are allowed")
    data = await file.read()
    if len(data) > 6 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 6 MB)")
    if mime != "application/pdf" and not (data[:3] == b"\xff\xd8\xff" or data[:8] == b"\x89PNG\r\n\x1a\n" or data[8:12] == b"WEBP"):
        raise HTTPException(400, "File content does not match an image")
    name = secrets.token_hex(16) + ALLOWED_MIME[mime]
    (UPLOAD_DIR / name).write_bytes(data)
    att = m.Attachment(owner_user_id=user.id, booking_id=booking_id, driver_id=driver_id, kind=kind, ref_id=ref_id, path=name, mime=mime)
    db.add(att)
    db.flush()
    return att


# ------------------------------------------------------------------ geo (OSRM / Nominatim)
def haversine_km(lat1, lng1, lat2, lng2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def road_route(lat1, lng1, lat2, lng2) -> dict:
    """Road distance via OSRM. If OSRM is unreachable we return a clearly labelled fallback estimate."""
    try:
        url = f"{OSRM_URL}/route/v1/driving/{lng1},{lat1};{lng2},{lat2}?overview=simplified&geometries=geojson"
        r = httpx.get(url, timeout=8, headers={"User-Agent": "HaulGo/1.0 (HighCodeX Technologies)"})
        r.raise_for_status()
        route = r.json()["routes"][0]
        km = route["distance"] / 1000
        line = [[c[1], c[0]] for c in route["geometry"]["coordinates"]]
        return {"km": round(km, 1), "source": "osrm", "polyline": line}
    except Exception:
        km = haversine_km(lat1, lng1, lat2, lng2) * 1.35
        return {"km": round(km, 1), "source": "fallback_estimate", "polyline": [[lat1, lng1], [lat2, lng2]]}


def validate_coords(lat, lng):
    if lat is None or lng is None or not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(400, "Invalid location coordinates")


def in_service_area(db: Session, lat, lng) -> bool:
    areas = db.query(m.ServiceArea).filter_by(active=True).all()
    return any(haversine_km(lat, lng, a.lat, a.lng) <= a.radius_km for a in areas)


# ------------------------------------------------------------------ fare (server side only)
QUOTATION_CATEGORIES = {"machinery", "equipment"}


def vehicle_fits(vt: m.VehicleType, weight_kg: float, length_cm: float | None, category: str) -> tuple[bool, str]:
    if weight_kg > vt.capacity_kg:
        return False, f"Capacity {int(vt.capacity_kg)} kg is less than your load"
    if length_cm and vt.max_length_cm and length_cm > vt.max_length_cm:
        return False, f"Load length exceeds {int(vt.max_length_cm)} cm"
    allowed = [c.strip() for c in (vt.goods_categories or "").split(",") if c.strip()]
    if allowed and category not in allowed:
        return False, "This vehicle does not carry this goods category"
    return True, ""


def needs_quotation(st: dict, category: str, weight: float, km: float, length_cm, special: bool) -> bool:
    return bool(category in QUOTATION_CATEGORIES and weight >= 1500 or weight >= st["quotation_weight_kg"]
                or km >= st["quotation_distance_km"] or special or (length_cm or 0) > 600)


def calc_fare(db: Session, vt: m.VehicleType, km: float, helper: bool, when: datetime | None = None, special: bool = False) -> dict:
    st = get_settings(db)
    base = vt.base_fare
    dist = round(vt.per_km * km, 2)
    sub = max(base + dist, vt.min_fare)
    # `when` is a naive UTC datetime (as stored in DB); None means "now"
    local = when.replace(tzinfo=timezone.utc).astimezone(IST) if when else datetime.now(IST)
    h = local.hour
    ns, ne = st["night_start_hour"], st["night_end_hour"]
    is_night = (h >= ns or h < ne) if ns > ne else (ns <= h < ne)
    night = round(sub * st["night_pct"] / 100, 2) if is_night else 0.0
    helper_c = vt.helper_charge if helper else 0.0
    special_c = vt.special_charge if special else 0.0
    total = round(sub + night + helper_c + special_c)
    commission = round(total * st["commission_pct"] / 100)
    return {"base": base, "distance_charge": dist, "min_applied": sub > base + dist, "night": night, "helper": helper_c,
            "special": special_c, "total": total, "commission_pct": st["commission_pct"], "commission": commission,
            "driver_share": total - commission, "is_night": is_night}


# ------------------------------------------------------------------ state machine
TRANSITIONS = {
    "quotation_requested": {"quotation_sent", "cancelled"},
    "quotation_sent": {"awaiting_payment", "pending_assignment", "quotation_requested", "cancelled"},
    "awaiting_payment": {"pending_assignment", "cancelled"},
    "pending_assignment": {"driver_assigned", "cancelled"},
    "driver_assigned": {"driver_accepted", "pending_assignment", "cancelled"},
    "driver_accepted": {"driver_reached", "pending_assignment", "cancelled"},
    "driver_reached": {"pickup_verified", "pending_assignment", "cancelled"},
    "pickup_verified": {"in_transit"},
    "in_transit": {"delivery_pending"},
    "delivery_pending": {"delivered"},
    "delivered": {"completed"},
    "cancelled": {"refund_pending"},
    "refund_pending": {"refunded"},
}
ACTIVE_TRIP = {"driver_accepted", "driver_reached", "pickup_verified", "in_transit", "delivery_pending"}
LIVE_COMMS = {"driver_assigned", "driver_accepted", "driver_reached", "pickup_verified", "in_transit", "delivery_pending"}


def set_status(db: Session, b: m.Booking, to: str, by: m.User | None = None, note: str = ""):
    if to not in TRANSITIONS.get(b.status, set()):
        raise HTTPException(409, f"Invalid status change: {b.status} → {to}")
    db.add(m.BookingStatusHistory(booking_id=b.id, from_status=b.status, to_status=to, by_user_id=by.id if by else None, note=note[:300]))
    b.status = to


# ------------------------------------------------------------------ notifications
EVENTS = {
    "booking_confirmed": ("Booking confirmed", "Your HaulGo booking {code} is confirmed.", False),
    "driver_assigned": ("Driver assigned", "Your HaulGo driver has been assigned for booking {code}.", False),
    "driver_accepted": ("Driver accepted", "Driver accepted booking {code}. Vehicle {vehicle}.", False),
    "driver_approaching": ("Driver on the way", "Your driver is on the way to the pickup for booking {code}.", False),
    "driver_reached": ("Driver reached pickup", "Your driver has reached the pickup location. Please share the pickup OTP {otp}.", False),
    "pickup_otp": ("Pickup OTP", "Pickup OTP for booking {code}: {otp}. Share it only with the driver at pickup.", False),
    "goods_picked": ("Goods picked up", "Goods picked up for booking {code}.", True),
    "trip_started": ("Trip started", "Trip started for booking {code}. Track: {track}", True),
    "in_transit": ("In transit", "Your shipment {code} is in transit. Track: {track}", True),
    "delivery_approaching": ("Delivery approaching", "Your shipment {code} is arriving. Delivery OTP: {dotp}", True),
    "delivered": ("Delivered", "Your goods have been successfully delivered. Booking {code}.", True),
    "payment_confirmed": ("Payment received", "Payment of ₹{amount} received for booking {code}.", False),
    "invoice_generated": ("Invoice ready", "Invoice for booking {code} is ready in the app.", False),
    "booking_cancelled": ("Booking cancelled", "Booking {code} was cancelled. {reason}", False),
    "refund_update": ("Refund update", "Refund for booking {code}: {reason}", False),
    "new_trip_request": ("New trip request", "New trip request {code}. Please respond quickly.", False),
    "chat_message": ("New message", "{reason}", False),
    "pickup_help": ("Driver cannot find pickup", "Driver cannot find the pickup for {code}. Please share your exact location.", False),
    "pickup_help_reply": ("Customer shared location", "Customer shared pickup help for {code}.", False),
    "quotation_ready": ("Quotation ready", "Your quotation for {code} is ready: ₹{amount}.", False),
    "admin_response": ("Support replied", "Support replied to your complaint #{amount}.", False),
    "sos": ("SOS raised", "SOS raised on booking {code}. Admin team has been alerted.", False),
}


def seed_templates(db: Session):
    for ev, (title, body, rcv) in EVENTS.items():
        if not db.query(m.NotificationTemplate).filter_by(event=ev).first():
            db.add(m.NotificationTemplate(event=ev, title=title, body=body, to_receiver=rcv, sms=ev not in ("chat_message", "new_trip_request", "pickup_help_reply", "admin_response", "sos"), whatsapp=False, email=False))


def mask(v: str | None) -> str:
    return (v[:2] + "xxxxxx" + v[-2:]) if v and len(v) > 5 else "n/a"


def notify(db: Session, user_id: int | None, event: str, b: m.Booking | None = None, **ctx):
    """Create in-app notification and log external channels honestly (never claims SMS/WhatsApp was sent without a provider)."""
    tpl = db.query(m.NotificationTemplate).filter_by(event=event).first()
    if tpl and not tpl.enabled:
        return
    title, body = (tpl.title, tpl.body) if tpl else EVENTS.get(event, (event, event, False))[:2]
    data = {"code": b.code if b else "", "otp": b.pickup_otp if b else "", "dotp": b.delivery_otp if b else "",
            "track": f"{PUBLIC_BASE_URL}/track/{b.track_token}" if b else "", "amount": "", "reason": "", "vehicle": ""}
    if b and b.driver:
        data["vehicle"] = b.driver.reg_no or ""
    data.update(ctx)
    try:
        body = body.format(**data)
    except (KeyError, IndexError):
        pass
    if user_id:
        db.add(m.Notification(user_id=user_id, booking_id=b.id if b else None, kind=event, title=title, body=body[:400]))
        db.add(m.NotificationLog(user_id=user_id, booking_id=b.id if b else None, event=event, channel="in_app", recipient=f"user:{user_id}", status="delivered_in_app"))
        for tok in db.query(m.DeviceToken).filter_by(user_id=user_id).all():
            db.add(m.NotificationLog(user_id=user_id, booking_id=b.id if b else None, event=event, channel="push", recipient=tok.platform,
                                     status="not_configured" if not FCM_CREDENTIALS else "failed",
                                     detail="Set FCM_CREDENTIALS and implement send in notify.push" if not FCM_CREDENTIALS else "FCM sender not implemented"))
    if tpl:
        targets = []
        u = db.get(m.User, user_id) if user_id else None
        if u and u.phone:
            targets.append(("customer/driver", u.phone))
        if tpl.to_receiver and b and b.receiver_phone:
            targets.append(("receiver", b.receiver_phone))
        for who, phone in targets:
            for ch, on, prov in (("sms", tpl.sms, SMS_PROVIDER),):
                if on:
                    db.add(m.NotificationLog(user_id=user_id, booking_id=b.id if b else None, event=event, channel=ch, recipient=mask(phone),
                                             status="not_configured" if not prov else "failed",
                                             detail=(f"No {ch.upper()} provider configured; message NOT sent ({who})" if not prov else f"{prov} sender not implemented")))


def send_sms_otp(phone: str, code: str) -> bool:
    """Hook for a real SMS provider (MSG91/Twilio + DLT template). Returns True only if actually sent."""
    return False


# ------------------------------------------------------------------ wallet helpers
def wallet_balance(db: Session, driver_id: int, bucket: str = "wallet") -> float:
    return round(db.query(func.coalesce(func.sum(m.WalletTxn.amount), 0)).filter_by(driver_id=driver_id, bucket=bucket).scalar() or 0, 2)


def add_txn(db: Session, driver_id: int, bucket: str, kind: str, amount: float, booking_id=None, note=""):
    db.add(m.WalletTxn(driver_id=driver_id, booking_id=booking_id, bucket=bucket, kind=kind, amount=round(amount, 2), note=note))


def credit_summary(db: Session, acc: m.CreditAccount) -> dict:
    used = db.query(func.coalesce(func.sum(m.CreditTxn.amount), 0)).filter_by(account_id=acc.id).scalar() or 0
    used = round(max(used, 0), 2)
    return {"status": acc.status, "limit": acc.credit_limit, "used": used, "available": round(max(acc.credit_limit - used, 0), 2) if acc.status == "approved" else 0,
            "requested_limit": acc.requested_limit}


def cod_allowance(db: Session, u: m.User) -> dict:
    st = get_settings(db)
    bonus = (u.online_trips_done // st["cod_bonus_after_online"]) if st["cod_bonus_after_online"] else 0
    limit = st["cod_limit"] + bonus
    return {"limit": limit, "used": u.cod_used, "remaining": max(limit - u.cod_used, 0)}


def new_code(db: Session) -> str:
    while True:
        code = "HG" + str(secrets.randbelow(900000) + 100000)
        if not db.query(m.Booking).filter_by(code=code).first():
            return code


def phone_clean(p: str | None) -> str:
    p = re.sub(r"\D", "", p or "")
    if len(p) == 12 and p.startswith("91"):
        p = p[2:]
    if len(p) == 11 and p.startswith("0"):
        p = p[1:]
    return p


def valid_phone(p: str) -> bool:
    return bool(re.fullmatch(r"[6-9]\d{9}", p))