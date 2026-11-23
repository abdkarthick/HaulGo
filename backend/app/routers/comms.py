"""In-app chat, masked calling, pickup assistance, SOS, complaints."""
import json
import os
import re
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models as m
from ..core import (CALL_PROVIDER, LIVE_COMMS, PUBLIC_BASE_URL, audit, current_user, get_db, get_settings, iso, notify, now, save_upload, validate_coords)
from ..services import system_message

router = APIRouter(tags=["communication & safety"])

PHONE_RE = re.compile(r"(?:\+?91[\s-]?)?[6-9](?:[\s-]?\d){9}")

QUICK = {
    "driver": ["Coming in 5 minutes", "I am at the pickup", "Please share the exact location", "Come near the gate", "I have reached the destination", "Please contact the receiver"],
    "customer": ["I am coming", "Please wait", "The location is correct", "Call me through the app", "Contact the receiver"],
}


def party(db: Session, u: m.User, bid: int, need_open: bool = False) -> tuple[m.Booking, str]:
    b = db.get(m.Booking, bid)
    if not b:
        raise HTTPException(404, "Booking not found")
    if u.role == "customer" and b.customer_id == u.id:
        role = "customer"
    elif u.role == "driver" and b.driver and b.driver.user_id == u.id:
        role = "driver"
    else:
        raise HTTPException(403, "You are not part of this booking")
    if need_open and b.status not in LIVE_COMMS:
        raise HTTPException(409, "Chat and calls are closed for this booking")
    return b, role


def msg_dict(x: m.ChatMessage, me_id: int) -> dict:
    return {"id": x.id, "mine": x.sender_id == me_id, "system": x.kind == "system", "kind": x.kind, "body": x.body, "lat": x.lat, "lng": x.lng,
            "attachment_id": x.attachment_id, "at": iso(x.created_at), "delivered": bool(x.delivered_at), "read": bool(x.read_at)}


@router.get("/chat/{bid}/messages")
def chat_messages(bid: int, after: int = 0, u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    b, role = party(db, u, bid)
    q = db.query(m.ChatMessage).filter(m.ChatMessage.booking_id == bid, m.ChatMessage.id > after).order_by(m.ChatMessage.id).limit(100)
    rows = q.all()
    for x in rows:
        if x.sender_id != u.id and not x.delivered_at:
            x.delivered_at = now()
    db.commit()
    unread = db.query(m.ChatMessage).filter(m.ChatMessage.booking_id == bid, m.ChatMessage.sender_id != u.id, m.ChatMessage.sender_id.isnot(None), m.ChatMessage.read_at.is_(None)).count()
    return {"messages": [msg_dict(x, u.id) for x in rows], "unread": unread, "open": b.status in LIVE_COMMS, "quick_replies": QUICK[role], "role": role,
            "other_party": (b.driver.user.name if role == "customer" and b.driver else (b.customer.company_name or b.customer.name if b.customer else "Customer")),
            "privacy": "Phone numbers are hidden. Use in-app chat or masked call."}


class MsgIn(BaseModel):
    kind: str = Field("text", pattern="^(text|quick|location)$")
    body: str | None = Field(None, max_length=500)
    lat: float | None = None
    lng: float | None = None


def _post(db, b: m.Booking, u: m.User, role: str, kind, body, lat=None, lng=None, att=None):
    msg = m.ChatMessage(booking_id=b.id, sender_id=u.id, kind=kind, body=body, lat=lat, lng=lng, attachment_id=att)
    db.add(msg)
    other = b.customer_id if role == "driver" else (b.driver.user_id if b.driver else None)
    if other:
        notify(db, other, "chat_message", b, reason=f"{u.name or 'Your contact'}: {(body or ('Shared a ' + kind))[:80]}")
    return msg


@router.post("/chat/{bid}/messages")
def chat_send(bid: int, body: MsgIn, u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    b, role = party(db, u, bid, need_open=True)
    text = (body.body or "").strip()
    if body.kind == "location":
        validate_coords(body.lat, body.lng)
        text = text or "Shared a location"
    elif body.kind == "quick":
        if text not in QUICK[role]:
            raise HTTPException(400, "Unknown quick reply")
    elif not text:
        raise HTTPException(400, "Message is empty")
    text = PHONE_RE.sub("[number hidden]", text)  # protect phone privacy in chat
    msg = _post(db, b, u, role, body.kind, text, body.lat, body.lng)
    db.commit()
    return msg_dict(msg, u.id)


@router.post("/chat/{bid}/image")
async def chat_image(bid: int, file: UploadFile = File(...), u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    b, role = party(db, u, bid, need_open=True)
    a = await save_upload(db, file, u, "chat", booking_id=b.id, images_only=True)
    msg = _post(db, b, u, role, "image", "Shared a photo", att=a.id)
    db.commit()
    return msg_dict(msg, u.id)


@router.post("/chat/{bid}/read")
def chat_read(bid: int, u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    party(db, u, bid)
    db.query(m.ChatMessage).filter(m.ChatMessage.booking_id == bid, m.ChatMessage.sender_id != u.id, m.ChatMessage.read_at.is_(None)).update({"read_at": now(), "delivered_at": now()})
    db.commit()
    return {"ok": True}


@router.get("/chat-unread")
def chat_unread(u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    """Unread counts per open booking (cheap poll for badges + sound alerts)."""
    if u.role == "customer":
        bs = db.query(m.Booking).filter(m.Booking.customer_id == u.id, m.Booking.status.in_(LIVE_COMMS)).all()
    elif u.role == "driver":
        d = db.query(m.Driver).filter_by(user_id=u.id).first()
        bs = db.query(m.Booking).filter(m.Booking.driver_id == d.id, m.Booking.status.in_(LIVE_COMMS)).all() if d else []
    else:
        return {"total": 0, "bookings": {}}
    out = {}
    for b in bs:
        n = db.query(m.ChatMessage).filter(m.ChatMessage.booking_id == b.id, m.ChatMessage.sender_id != u.id, m.ChatMessage.sender_id.isnot(None), m.ChatMessage.read_at.is_(None)).count()
        if n:
            out[b.id] = n
    return {"total": sum(out.values()), "bookings": out}


# ------------------------------------------------------------ masked calling
def provider_connect(a_phone: str, b_phone: str) -> tuple[str, str, str]:
    """Returns (status, provider_call_id, detail). Exotel 'connect two numbers' call. Phones never leave the server."""
    if CALL_PROVIDER == "exotel":
        sid, key, tok, vnum = (os.getenv(k, "") for k in ("EXOTEL_SID", "EXOTEL_API_KEY", "EXOTEL_API_TOKEN", "EXOTEL_VIRTUAL_NUMBER"))
        if not all([sid, key, tok, vnum]):
            return "failed", "", "Exotel credentials missing (EXOTEL_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN, EXOTEL_VIRTUAL_NUMBER)"
        try:
            r = httpx.post(f"https://api.exotel.com/v1/Accounts/{sid}/Calls/connect.json", auth=(key, tok),
                           data={"From": a_phone, "To": b_phone, "CallerId": vnum, "CallType": "trans"}, timeout=15)
            if r.status_code < 300:
                return "initiated", str(r.json().get("Call", {}).get("Sid", "")), "Provider accepted the call request"
            return "failed", "", f"Provider error {r.status_code}"
        except Exception as e:  # noqa
            return "failed", "", f"Provider unreachable: {str(e)[:100]}"
    return "failed", "", f"Provider '{CALL_PROVIDER}' integration is not implemented yet"


@router.post("/calls/{bid}/start")
def call_start(bid: int, u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    b, role = party(db, u, bid, need_open=True)
    callee = b.driver.user if role == "customer" else b.customer
    sess = m.CallSession(booking_id=b.id, caller_id=u.id, callee_id=callee.id, provider=CALL_PROVIDER or "none")
    if not CALL_PROVIDER:
        sess.status, sess.detail = "demo_not_connected", "Masked calling provider not configured. No call was placed."
        db.add(sess)
        db.commit()
        return {"connected": False, "demo": True, "session_id": sess.id,
                "message": "Demo mode: masked calling needs a provider account (Exotel/Knowlarity) and a virtual number. No call was placed. Use in-app chat meanwhile."}
    status, cid, detail = provider_connect(u.phone, callee.phone)
    sess.status, sess.provider_call_id, sess.detail = status, cid, detail
    db.add(sess)
    db.commit()
    if status != "initiated":
        raise HTTPException(502, "Could not start the call. Please use chat.")
    return {"connected": False, "demo": False, "session_id": sess.id, "message": "Calling… your phone will ring from a HaulGo number. Your number stays private."}


@router.post("/calls/{sid}/end")
def call_end(sid: int, u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(m.CallSession, sid)
    if not s or u.id not in (s.caller_id, s.callee_id):
        raise HTTPException(404, "Not found")
    s.status = "ended"
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------ pickup assistance
@router.post("/pickup/{bid}/cannot-find")
def cannot_find(bid: int, lat: float | None = None, lng: float | None = None, u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    b, role = party(db, u, bid, need_open=True)
    if role != "driver":
        raise HTTPException(403, "Drivers only")
    if b.status not in ("driver_accepted", "driver_reached"):
        raise HTTPException(409, "Only available before pickup")
    b.pickup_help_requested_at = now()
    _post(db, b, u, "driver", "text", "I cannot find the pickup location. Please share the exact location.")
    if lat is not None and lng is not None:
        validate_coords(lat, lng)
        _post(db, b, u, "driver", "location", "My current location", lat, lng)
    notify(db, b.customer_id, "pickup_help", b)
    db.commit()
    return {"ok": True}


class PickupReply(BaseModel):
    lat: float | None = None
    lng: float | None = None
    landmark: str | None = Field(None, max_length=300)


@router.post("/pickup/{bid}/reply")
def pickup_reply(bid: int, body: PickupReply, u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    b, role = party(db, u, bid, need_open=True)
    if role != "customer":
        raise HTTPException(403, "Customers only")
    if body.lat is not None and body.lng is not None:
        validate_coords(body.lat, body.lng)
        b.pickup_lat, b.pickup_lng = body.lat, body.lng
        _post(db, b, u, "customer", "location", "Corrected pickup pin", body.lat, body.lng)
        db.add(m.BookingStatusHistory(booking_id=b.id, from_status=b.status, to_status=b.status, by_user_id=u.id, note="Customer corrected pickup pin"))
    if body.landmark:
        b.pickup_landmark = body.landmark
        _post(db, b, u, "customer", "text", PHONE_RE.sub("[number hidden]", body.landmark))
    b.pickup_help_requested_at = None
    if b.driver:
        notify(db, b.driver.user_id, "pickup_help_reply", b)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------ SOS
class SosIn(BaseModel):
    booking_id: int | None = None
    lat: float | None = None
    lng: float | None = None
    note: str | None = Field(None, max_length=400)


@router.post("/sos")
def raise_sos(body: SosIn, u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    if u.role not in ("customer", "driver"):
        raise HTTPException(403, "Not allowed")
    b = None
    if body.booking_id:
        b, _ = party(db, u, body.booking_id)
    lat, lng, loc_note = body.lat, body.lng, "live"
    if lat is None or lng is None:
        drv = b.driver if b and b.driver else (db.query(m.Driver).filter_by(user_id=u.id).first() if u.role == "driver" else None)
        if drv and drv.lat is not None:
            lat, lng, loc_note = drv.lat, drv.lng, "last_known"
        elif b:
            lat, lng, loc_note = b.pickup_lat, b.pickup_lng, "last_known"
        else:
            loc_note = "none"
    else:
        validate_coords(lat, lng)
    snap = {"raised_by": {"name": u.name, "role": u.role, "phone": u.phone}}
    if b:
        snap.update({"booking": b.code, "customer": {"name": b.customer.name, "company": b.customer.company_name, "phone": b.customer.phone},
                     "driver": {"name": b.driver.user.name, "phone": b.driver.user.phone, "reg_no": b.driver.reg_no, "vehicle": b.driver.vehicle_type.name} if b.driver else None,
                     "pickup": b.pickup_address, "drop": b.drop_address, "status": b.status})
    recent = db.query(m.SosAlert).filter(m.SosAlert.raised_by_id == u.id, m.SosAlert.booking_id == body.booking_id, m.SosAlert.status != "resolved").first()
    if recent:
        db.add(m.SosActionLog(sos_id=recent.id, actor_id=u.id, action="repeat_press", note=f"{lat},{lng}"))
        recent.lat, recent.lng, recent.loc_note = lat, lng, loc_note
        db.commit()
        alert = recent
    else:
        alert = m.SosAlert(booking_id=body.booking_id, raised_by_id=u.id, role=u.role, lat=lat, lng=lng, loc_note=loc_note, note=body.note, snapshot=json.dumps(snap))
        db.add(alert)
        db.flush()
        db.add(m.SosActionLog(sos_id=alert.id, actor_id=u.id, action="raised", note=body.note or ""))
        for adm in db.query(m.User).filter_by(role="admin").all():
            db.add(m.Notification(user_id=adm.id, booking_id=body.booking_id, kind="admin_sos", title="🚨 SOS ALERT", body=f"{u.role.title()} {u.name or ''} {('· ' + b.code) if b else ''}"))
        audit(db, u, "sos_raised", "sos", alert.id, f"{u.role} {loc_note}")
        db.commit()
    st = get_settings(db)
    return {"id": alert.id, "status": alert.status, "location": loc_note, "emergency_numbers": st["emergency_numbers"],
            "message": "Your alert has been sent to the HaulGo team. We cannot guarantee an instant response. If you are in danger, call the emergency numbers below right now."}


@router.get("/sos/mine")
def my_sos(u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(m.SosAlert).filter_by(raised_by_id=u.id).order_by(m.SosAlert.id.desc()).limit(20).all()
    return [{"id": a.id, "status": a.status, "booking_id": a.booking_id, "at": iso(a.created_at)} for a in rows]


# ------------------------------------------------------------ complaints
CATEGORIES = ["Driver not responding", "Pickup location problem", "Goods damage", "Delivery delay", "Payment issue", "Driver behaviour", "Wrong vehicle", "Other issue"]


@router.get("/complaints/categories")
def complaint_categories():
    return CATEGORIES


@router.post("/complaints")
async def submit_complaint(category: str = Form(...), description: str = Form(...), booking_id: int | None = Form(None), files: list[UploadFile] = File(default=[]),
                           u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    if u.role not in ("customer", "driver"):
        raise HTTPException(403, "Not allowed")
    if category not in CATEGORIES:
        raise HTTPException(400, "Select a category")
    if len(description.strip()) < 10 or len(description) > 1000:
        raise HTTPException(400, "Describe the problem in 10-1000 characters")
    if booking_id:
        party(db, u, booking_id)
    if len(files) > 4:
        raise HTTPException(400, "Maximum 4 photos")
    c = m.Complaint(user_id=u.id, booking_id=booking_id, category=category, description=description.strip())
    db.add(c)
    db.flush()
    for f in files:
        if f.filename:
            await save_upload(db, f, u, "complaint", booking_id=booking_id, ref_id=c.id, images_only=True)
    db.add(m.ComplaintEvent(complaint_id=c.id, actor=f"{u.role}:{u.id}", status="open", text="Complaint submitted"))
    for adm in db.query(m.User).filter_by(role="admin").all():
        db.add(m.Notification(user_id=adm.id, booking_id=booking_id, kind="admin_complaint", title="New complaint", body=f"#{c.id} · {category}"))
    db.commit()
    return {"id": c.id, "status": c.status}


@router.get("/complaints/mine")
def my_complaints(u: m.User = Depends(current_user), db: Session = Depends(get_db)):
    out = []
    for c in db.query(m.Complaint).filter_by(user_id=u.id).order_by(m.Complaint.id.desc()).limit(50):
        evs = db.query(m.ComplaintEvent).filter_by(complaint_id=c.id).order_by(m.ComplaintEvent.id).all()
        out.append({"id": c.id, "category": c.category, "description": c.description, "status": c.status, "admin_response": c.admin_response, "booking_id": c.booking_id,
                    "created_at": iso(c.created_at), "events": [{"actor": e.actor.split(":")[0], "status": e.status, "text": e.text, "at": iso(e.at)} for e in evs],
                    "photos": [a.id for a in db.query(m.Attachment).filter_by(kind="complaint", ref_id=c.id)]})
    return out
