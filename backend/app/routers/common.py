"""Auth (OTP + admin), profile, saved locations, geo search, file access, public tracking, settings for clients."""
import re
import secrets
from datetime import timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models as m
from ..core import (DEV_MODE, NOMINATIM_URL, RAZORPAY_KEY_ID, RAZORPAY_MODE, UPLOAD_DIR, audit, check_pw, current_user, get_db, get_settings,
                    hash_otp, iso, make_token, now, phone_clean, rate_limit, road_route, send_sms_otp, valid_phone, SMS_PROVIDER, CALL_PROVIDER,
                    FCM_CREDENTIALS, DEMO_MODE, GOOGLE_CLIENT_ID, GEMINI_API_KEY, SMTP_HOST, hash_pw, send_email)
from ..services import booking_dict, driver_public, vt_dict

router = APIRouter()

class OtpReq(BaseModel):
    phone: str
    role: str = Field(pattern="^(customer|driver)$")

class OtpVerify(OtpReq):
    otp: str
    name: str | None = None

class AdminLogin(BaseModel):
    email: str
    password: str

def user_dict(db: Session, u: m.User) -> dict:
    out = {"id": u.id, "role": u.role, "name": u.name, "phone": u.phone, "email": u.email, "company_name": u.company_name, "gstin": u.gstin,
           "contact_person": u.contact_person, "business_phone": u.business_phone, "verified": u.verified, "admin_level": u.admin_level,
           "profile_complete": bool(u.name)}
    if u.role == "driver":
        d = db.query(m.Driver).filter_by(user_id=u.id).first()
        out["driver_status"] = d.status if d else "none"
        out["profile_complete"] = bool(d and d.reg_no)
    return out

@router.get("/config")
def public_config(db: Session = Depends(get_db)):
    st = get_settings(db)
    return {"app": "HaulGo", "company": "HighCodeX Technologies", "dev_mode": DEV_MODE, "demo_mode": DEMO_MODE,
            "payment_mode": RAZORPAY_MODE, "razorpay_key_id": RAZORPAY_KEY_ID or None,
            "google_client_id": GOOGLE_CLIENT_ID or None, "ai_provider": "gemini" if GEMINI_API_KEY else "basic",
            "integrations": {"email": bool(SMTP_HOST), "sms": bool(SMS_PROVIDER), "masked_calling": bool(CALL_PROVIDER), "push": bool(FCM_CREDENTIALS)},
            "emergency_numbers": st["emergency_numbers"], "support_phone": st["support_phone"],
            "request_timeout_s": st["request_timeout_s"], "payment_expiry_min": st["payment_expiry_min"]}

@router.post("/auth/otp/request")
def otp_request(body: OtpReq, request: Request, db: Session = Depends(get_db)):
    phone = phone_clean(body.phone)
    if not valid_phone(phone):
        raise HTTPException(400, "Enter a valid 10-digit Indian mobile number")
    rate_limit(f"otp:{phone}", 5, 600)
    rate_limit(f"otpip:{request.client.host if request.client else 'x'}", 20, 600)
    existing = db.query(m.User).filter_by(phone=phone, role=body.role).first()
    if existing and existing.status != "active":
        raise HTTPException(403, "This account is suspended. Please contact support.")
    code = f"{secrets.randbelow(900000) + 100000}"
    db.add(m.OtpCode(phone=phone, role=body.role, code_hash=hash_otp(phone, code), expires_at=now() + timedelta(minutes=5)))
    db.commit()
    sent = send_sms_otp(phone, code)
    res = {"ok": True, "sms_sent": sent, "is_new": existing is None, "expires_in": 300}
    if not sent:
        if DEV_MODE:
            res["dev_mode"] = True
            res["dev_otp"] = code
            res["message"] = "DEV MODE: no SMS provider configured, OTP shown here. It was NOT sent by SMS."
        else:
            raise HTTPException(503, "SMS service is not configured. Please contact support.")
    return res

@router.post("/auth/otp/verify")
def otp_verify(body: OtpVerify, db: Session = Depends(get_db)):
    phone = phone_clean(body.phone)
    rate_limit(f"verify:{phone}", 10, 600)
    rec = db.query(m.OtpCode).filter_by(phone=phone, role=body.role, used=False).order_by(m.OtpCode.id.desc()).first()
    if not rec or rec.expires_at < now():
        raise HTTPException(400, "OTP expired. Please request a new one.")
    rec.attempts += 1
    if rec.attempts > 5:
        rec.used = True
        db.commit()
        raise HTTPException(400, "Too many wrong attempts. Request a new OTP.")
    if rec.code_hash != hash_otp(phone, body.otp.strip()):
        db.commit()
        raise HTTPException(400, "Incorrect OTP")
    rec.used = True
    user = db.query(m.User).filter_by(phone=phone, role=body.role).first()
    if not user:
        user = m.User(phone=phone, role=body.role, name=(body.name or "").strip() or None)
        db.add(user)
    elif user.status != "active":
        raise HTTPException(403, "This account is suspended")
    db.commit()
    return {"token": make_token(user), "user": user_dict(db, user)}

class GoogleLogin(BaseModel):
    credential: str = Field(min_length=20, max_length=4000)
    role: str = Field(pattern="^(customer|driver)$")

@router.post("/auth/google")
def google_login(body: GoogleLogin, request: Request, db: Session = Depends(get_db)):
    """Sign in with Google. The ID token is verified with Google; accounts are keyed by the Google user id and are never merged by email."""
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(503, "Google sign-in is not configured. Please use your mobile number.")
    rate_limit(f"google:{request.client.host if request.client else 'x'}", 20, 600)
    try:
        r = httpx.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": body.credential}, timeout=8)
    except Exception:
        raise HTTPException(503, "Could not reach Google. Please try again or use your mobile number.")
    if r.status_code != 200:
        raise HTTPException(401, "Google sign-in failed. Please try again.")
    info = r.json()
    if info.get("aud") != GOOGLE_CLIENT_ID or info.get("iss") not in ("accounts.google.com", "https://accounts.google.com") or str(info.get("email_verified")).lower() != "true":
        raise HTTPException(401, "Google sign-in failed. Please try again.")
    sub = str(info.get("sub") or "")
    if not sub:
        raise HTTPException(401, "Google sign-in failed. Please try again.")
    user = db.query(m.User).filter_by(google_sub=sub, role=body.role).first()
    is_new = user is None
    if user and user.status != "active":
        raise HTTPException(403, "This account is suspended")
    if not user:
        user = m.User(role=body.role, google_sub=sub, email=(info.get("email") or "").lower()[:120], name=(info.get("name") or "").strip()[:120] or None)
        db.add(user)
        db.commit()
    return {"token": make_token(user), "user": user_dict(db, user), "is_new": is_new}

# ---- MSG91 OTP login (frontend la OTP verify aana aprom inga token vaangum) ----
class Msg91Login(BaseModel):
    phone: str | None = None
    role: str = "customer"
    name: str | None = None
    accessToken: str | None = None
    requestId: str | None = None

    class Config:
        extra = "allow"

@router.post("/auth/msg91")
def msg91_login(body: Msg91Login, db: Session = Depends(get_db)):
    # MSG91 widget frontend la ye OTP ah verify panniduchu,
    # inga phone ah vachu user ah kandu pidichu / pudusa create panni token kudukurom
    raw_phone = (body.phone or "").strip()
    if not raw_phone:
        raise HTTPException(400, "Phone number is required")

    phone = phone_clean(raw_phone)
    if not valid_phone(phone):
        raise HTTPException(400, "Enter a valid 10-digit Indian mobile number")

    role = (body.role or "customer").strip().lower()
    if role not in ("customer", "driver"):
        role = "customer"

    user = db.query(m.User).filter_by(phone=phone, role=role).first()

    if user and user.status != "active":
        raise HTTPException(403, "This account is suspended")

    if not user:
        user = m.User(
            phone=phone,
            role=role,
            name=(body.name or "").strip() or None,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    elif body.name and not user.name:
        user.name = body.name.strip()[:120]
        db.commit()

    return {"token": make_token(user), "user": user_dict(db, user)}

# ---- email + password accounts (customer / driver)
EMAIL_RX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

def _email(v: str) -> str:
    e = (v or "").strip().lower()
    if not EMAIL_RX.match(e) or len(e) > 120:
        raise HTTPException(400, "Enter a valid email address")
    return e

def _check_password(pw: str):
    if len(pw) < 8 or len(pw) > 100:
        raise HTTPException(400, "Password must be 8 to 100 characters")

def _password_user(db: Session, email: str, role: str) -> m.User | None:
    # only accounts that actually have a password: a mobile account whose profile email was typed in never matches
    return db.query(m.User).filter(m.User.email == email, m.User.role == role, m.User.password_hash.isnot(None)).first()

class EmailRegister(BaseModel):
    email: str
    password: str
    name: str = Field(min_length=2, max_length=120)
    role: str = Field(pattern="^(customer|driver)$")

class EmailLogin(BaseModel):
    email: str
    password: str
    role: str = Field(pattern="^(customer|driver)$")

class ForgotReq(BaseModel):
    email: str
    role: str = Field(pattern="^(customer|driver)$")

class ResetReq(ForgotReq):
    code: str
    new_password: str

@router.post("/auth/email/register")
def email_register(body: EmailRegister, request: Request, db: Session = Depends(get_db)):
    email = _email(body.email)
    _check_password(body.password)
    rate_limit(f"emreg:{request.client.host if request.client else 'x'}", 10, 600)
    if db.query(m.User).filter(m.User.email == email, m.User.role == body.role, (m.User.password_hash.isnot(None)) | (m.User.google_sub.isnot(None))).first():
        raise HTTPException(409, "This email is already registered. Please sign in or reset your password.")
    user = m.User(role=body.role, email=email, name=body.name.strip(), password_hash=hash_pw(body.password))
    db.add(user)
    db.commit()
    return {"token": make_token(user), "user": user_dict(db, user), "is_new": True}

@router.post("/auth/email/login")
def email_login(body: EmailLogin, request: Request, db: Session = Depends(get_db)):
    email = _email(body.email)
    rate_limit(f"emlogin:{email}", 8, 900)
    rate_limit(f"emloginip:{request.client.host if request.client else 'x'}", 40, 900)
    u = _password_user(db, email, body.role)
    if not u or not check_pw(body.password, u.password_hash):
        raise HTTPException(401, "Incorrect email or password")
    if u.status != "active":
        raise HTTPException(403, "This account is suspended")
    return {"token": make_token(u), "user": user_dict(db, u)}

@router.post("/auth/password/forgot")
def password_forgot(body: ForgotReq, request: Request, db: Session = Depends(get_db)):
    email = _email(body.email)
    rate_limit(f"pwf:{email}", 4, 900)
    rate_limit(f"pwfip:{request.client.host if request.client else 'x'}", 15, 900)
    res = {"ok": True, "message": "If this email is registered, a 6-digit code has been sent."}
    u = _password_user(db, email, body.role)
    if not u or u.status != "active":
        return res  # same answer either way, so emails cannot be probed
    code = f"{secrets.randbelow(900000) + 100000}"
    db.add(m.PasswordReset(email=email, role=body.role, code_hash=hash_otp(f"email:{email}", code), expires_at=now() + timedelta(minutes=15)))
    db.commit()
    sent = send_email(email, "HaulGo password reset code", f"Your HaulGo password reset code is {code}. It is valid for 15 minutes. If you did not ask for this, ignore this email.")
    if not sent:
        if DEV_MODE:
            res["dev_mode"] = True
            res["dev_code"] = code
            res["message"] = "DEV MODE: email is not configured, the code is shown here. It was NOT emailed."
        else:
            raise HTTPException(503, "Email service is not configured. Please contact support.")
    return res

@router.post("/auth/password/reset")
def password_reset(body: ResetReq, db: Session = Depends(get_db)):
    email = _email(body.email)
    _check_password(body.new_password)
    rate_limit(f"pwr:{email}", 10, 900)
    rec = db.query(m.PasswordReset).filter_by(email=email, role=body.role, used=False).order_by(m.PasswordReset.id.desc()).first()
    if not rec or rec.expires_at < now():
        raise HTTPException(400, "Code expired. Please request a new one.")
    rec.attempts += 1
    if rec.attempts > 5:
        rec.used = True
        db.commit()
        raise HTTPException(400, "Too many wrong attempts. Request a new code.")
    if rec.code_hash != hash_otp(f"email:{email}", body.code.strip()):
        db.commit()
        raise HTTPException(400, "Incorrect code")
    u = _password_user(db, email, body.role)
    if not u or u.status != "active":
        raise HTTPException(400, "Code expired. Please request a new one.")
    rec.used = True
    u.password_hash = hash_pw(body.new_password)
    db.commit()
    return {"ok": True}

@router.post("/auth/admin/login")
def admin_login(body: AdminLogin, request: Request, db: Session = Depends(get_db)):
    rate_limit(f"admin:{body.email.lower()}", 6, 900)
    u = db.query(m.User).filter_by(role="admin", email=body.email.strip().lower()).first()
    if not u or not u.password_hash or not check_pw(body.password, u.password_hash) or u.status != "active":
        raise HTTPException(401, "Invalid email or password")
    audit(db, u, "admin_login", "user", u.id, request.client.host if request.client else "")
    db.commit()
    return {"token": make_token(u), "user": user_dict(db, u)}

@router.get("/me")
def me(u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    return user_dict(db, u)

class ProfileIn(BaseModel):
    name: str | None = Field(None, max_length=120)
    company_name: str | None = Field(None, max_length=160)
    gstin: str | None = Field(None, max_length=20)
    contact_person: str | None = Field(None, max_length=120)
    business_phone: str | None = Field(None, max_length=15)
    email: str | None = Field(None, max_length=120)

@router.put("/me")
def update_me(body: ProfileIn, u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    for k, v in body.model_dump(exclude_none=True).items():
        if k == "gstin" and v:
            v = v.strip().upper()
            if len(v) != 15:
                raise HTTPException(400, "GSTIN must be 15 characters")
        if k == "business_phone" and v:
            v = phone_clean(v)
        setattr(u, k, v.strip() if isinstance(v, str) else v)
    db.commit()
    return user_dict(db, u)

class LocIn(BaseModel):
    label: str = Field(max_length=60)
    address: str = Field(max_length=300)
    lat: float
    lng: float

@router.get("/locations")
def list_locations(u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    return [{"id": x.id, "label": x.label, "address": x.address, "lat": x.lat, "lng": x.lng} for x in db.query(m.SavedLocation).filter_by(user_id=u.id)]

@router.post("/locations")
def add_location(body: LocIn, u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    x = m.SavedLocation(user_id=u.id, **body.model_dump())
    db.add(x)
    db.commit()
    return {"id": x.id}

@router.delete("/locations/{lid}")
def del_location(lid: int, u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    x = db.get(m.SavedLocation, lid)
    if not x or x.user_id != u.id:
        raise HTTPException(404, "Not found")
    db.delete(x)
    db.commit()
    return {"ok": True}

# ---- geo (server-side proxy keeps Nominatim usage polite and caches results)
_geo_cache: dict[str, list] = {}

@router.get("/geo/search")
def geo_search(q: str, u: m.User = Depends(current_user)):
    q = q.strip()
    if len(q) < 3:
        return {"results": []}
    rate_limit(f"geo:{u.id}", 40, 60)
    if q.lower() in _geo_cache:
        return {"results": _geo_cache[q.lower()]}
    try:
        r = httpx.get(f"{NOMINATIM_URL}/search", params={"q": q, "format": "json", "limit": 6, "countrycodes": "in", "addressdetails": 0},
                      headers={"User-Agent": "HaulGo/1.0 (HighCodeX Technologies)"}, timeout=8)
        r.raise_for_status()
        res = [{"label": x["display_name"], "lat": float(x["lat"]), "lng": float(x["lon"])} for x in r.json()]
        _geo_cache[q.lower()] = res
        return {"results": res}
    except Exception:
        return {"results": [], "error": "Location search is temporarily unavailable. Move the map pin instead."}

@router.get("/geo/reverse")
def geo_reverse(lat: float, lng: float, u: m.User = Depends(current_user)):
    rate_limit(f"geor:{u.id}", 40, 60)
    try:
        r = httpx.get(f"{NOMINATIM_URL}/reverse", params={"lat": lat, "lon": lng, "format": "json"},
                      headers={"User-Agent": "HaulGo/1.0 (HighCodeX Technologies)"}, timeout=8)
        r.raise_for_status()
        return {"address": r.json().get("display_name", f"{lat:.5f}, {lng:.5f}")}
    except Exception:
        return {"address": f"{lat:.5f}, {lng:.5f}", "error": "Address lookup unavailable"}

@router.get("/geo/route")
def geo_route(lat1: float, lng1: float, lat2: float, lng2: float, u: m.User = Depends(current_user)):
    return road_route(lat1, lng1, lat2, lng2)

# ---- files (authorised access)
@router.get("/files/{fid}")
def get_file(fid: int, u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    a = db.get(m.Attachment, fid)
    if not a:
        raise HTTPException(404, "File not found")
    ok = u.role == "admin" or a.owner_user_id == u.id
    if not ok and a.booking_id:
        b = db.get(m.Booking, a.booking_id)
        ok = bool(b and (b.customer_id == u.id or (b.driver and b.driver.user_id == u.id)))
    if not ok:
        raise HTTPException(403, "Not allowed")
    return FileResponse(UPLOAD_DIR / a.path, media_type=a.mime, headers={"Cache-Control": "private, max-age=3600"})

# ---- public receiver tracking link (no phone numbers, no OTPs)
@router.get("/track/{token}")
def public_track(token: str, db: Session = Depends(get_db)):
    b = db.query(m.Booking).filter_by(track_token=token).first()
    if not b:
        raise HTTPException(404, "Tracking link not found")
    st = get_settings(db)
    d = driver_public(db, b.driver, st["tracking_stale_seconds"]) if b.driver and b.status in ("driver_accepted", "driver_reached", "pickup_verified", "in_transit", "delivery_pending", "delivered", "completed") else None
    if d:
        d = {k: d[k] for k in ("name", "reg_no", "vehicle", "lat", "lng", "location_updated_at", "location_stale")}
        d["name"] = (d["name"] or "").split(" ")[0]
    return {"code": b.code, "status": b.status, "pickup_address": b.pickup_address, "drop_address": b.drop_address, "pickup_lat": b.pickup_lat,
            "pickup_lng": b.pickup_lng, "drop_lat": b.drop_lat, "drop_lng": b.drop_lng, "driver": d, "distance_km": b.distance_km,
            "delivered_at": iso(b.delivered_at), "receiver_name": b.receiver_name}

@router.get("/vehicle-types")
def vehicle_types(db: Session = Depends(get_db)):
    return [vt_dict(v) for v in db.query(m.VehicleType).filter_by(active=True).order_by(m.VehicleType.sort)]

@router.get("/notifications")
def my_notifications(u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(m.Notification).filter_by(user_id=u.id).order_by(m.Notification.id.desc()).limit(60).all()
    unread = db.query(m.Notification).filter_by(user_id=u.id, read=False).count()
    return {"unread": unread, "items": [{"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "booking_id": n.booking_id, "read": n.read, "created_at": iso(n.created_at)} for n in rows]}

@router.post("/notifications/read")
def read_notifications(u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(m.Notification).filter_by(user_id=u.id, read=False).update({"read": True})
    db.commit()
    return {"ok": True}

class DeviceIn(BaseModel):
    token: str = Field(min_length=10, max_length=300)
    platform: str = "android"

@router.post("/devices")
def register_device(body: DeviceIn, u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(m.DeviceToken).filter_by(token=body.token).first()
    if row:
        row.user_id = u.id
    else:
        db.add(m.DeviceToken(user_id=u.id, token=body.token, platform=body.platform))
    db.commit()
    return {"ok": True, "push_provider_configured": bool(FCM_CREDENTIALS)}