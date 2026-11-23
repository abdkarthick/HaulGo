"""Customer: estimate, booking, payments (Razorpay), quotation, cancel, rating, credit, invoice."""
import hashlib
import hmac
import io
import json
import secrets
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models as m
from ..core import (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_MODE, RAZORPAY_WEBHOOK_SECRET, audit, calc_fare, cod_allowance, credit_summary,
                    current_user, customer_only, get_db, get_settings, in_service_area, needs_quotation, new_code, notify, now, phone_clean, road_route,
                    save_upload, set_status, valid_phone, validate_coords, vehicle_fits, iso)
from ..services import (booking_dict, cancel_booking, enter_pending_assignment, rating_update, system_message, vt_dict, wallet_balance)

router = APIRouter(prefix="/customer", tags=["customer"])

CATEGORIES = ["raw_materials", "finished_products", "industrial_components", "machinery", "equipment", "packaging_materials", "general_commercial"]


class GoodsIn(BaseModel):
    category: str
    description: str = Field(max_length=400)
    quantity: int = Field(1, ge=1)
    weight_kg: float = Field(gt=0, le=100000)
    length_cm: float | None = Field(None, ge=0)
    width_cm: float | None = Field(None, ge=0)
    height_cm: float | None = Field(None, ge=0)
    packages: int = Field(1, ge=1)
    handling: str | None = Field(None, max_length=400)
    loading_notes: str | None = Field(None, max_length=400)
    helper_needed: bool = False
    special_handling: bool = False
    receiver_name: str = Field(max_length=120)
    receiver_phone: str


class EstimateIn(BaseModel):
    pickup_lat: float
    pickup_lng: float
    drop_lat: float
    drop_lng: float
    goods: GoodsIn
    scheduled_at: datetime | None = None


class BookingIn(EstimateIn):
    pickup_address: str = Field(max_length=300)
    drop_address: str = Field(max_length=300)
    vehicle_type_id: int
    payment_method: str = Field(pattern="^(online|cod|credit)$")
    booking_mode: str = Field("instant", pattern="^(instant|scheduled)$")
    pickup_landmark: str | None = Field(None, max_length=300)
    pickup_gate: str | None = Field(None, max_length=120)
    pickup_floor: str | None = Field(None, max_length=120)
    pickup_entry: str | None = Field(None, max_length=300)


def _validate_goods(g: GoodsIn):
    if g.category not in CATEGORIES:
        raise HTTPException(400, "Select a valid goods category")
    if not valid_phone(phone_clean(g.receiver_phone)):
        raise HTTPException(400, "Enter a valid receiver mobile number")


def _check_area(db, st, body):
    if st["service_area_enforced"]:
        for lat, lng in ((body.pickup_lat, body.pickup_lng), (body.drop_lat, body.drop_lng)):
            if not in_service_area(db, lat, lng):
                raise HTTPException(400, "Service not available in this location")


@router.post("/estimate")
def estimate(body: EstimateIn, u: m.User = Depends(customer_only), db: Session = Depends(get_db)):
    validate_coords(body.pickup_lat, body.pickup_lng)
    validate_coords(body.drop_lat, body.drop_lng)
    _validate_goods(body.goods)
    st = get_settings(db)
    _check_area(db, st, body)
    route = road_route(body.pickup_lat, body.pickup_lng, body.drop_lat, body.drop_lng)
    km = route["km"]
    if km < 0.1 or km > 4000:
        raise HTTPException(400, "Pickup and drop locations look invalid. Please check them.")
    g = body.goods
    quote_only = needs_quotation(st, g.category, g.weight_kg, km, g.length_cm, g.special_handling)
    when = body.scheduled_at
    options, suggested = [], None
    for vt in db.query(m.VehicleType).filter_by(active=True).order_by(m.VehicleType.sort):
        ok, why = vehicle_fits(vt, g.weight_kg, g.length_cm, g.category)
        f = calc_fare(db, vt, km, g.helper_needed, when, g.special_handling)
        opt = {**vt_dict(vt), "suitable": ok, "reason": why, "fare": None if quote_only else f["total"], "fare_breakup": None if quote_only else f,
               "eta_hours": round(km / vt.avg_speed_kmph, 1)}
        options.append(opt)
        if ok and suggested is None:
            suggested = vt.id
    if suggested is None:
        raise HTTPException(400, "No vehicle can carry this load. Please contact support for a custom quotation.")
    return {"distance_km": km, "distance_source": route["source"], "route": route["polyline"], "pricing_mode": "quotation" if quote_only else "fixed",
            "quotation_reason": "Heavy / special / long-distance load needs an admin quotation" if quote_only else None,
            "suggested_vehicle_type_id": suggested, "vehicles": options, "cod": cod_allowance(db, u),
            "credit": credit_summary(db, db.query(m.CreditAccount).filter_by(user_id=u.id).first()) if db.query(m.CreditAccount).filter_by(user_id=u.id).first() else None,
            "estimate_note": "Estimated distance (OSRM unavailable). Final fare is recalculated on booking." if route["source"] != "osrm" else None}


@router.post("/bookings")
async def create_booking(body: BookingIn, u: m.User = Depends(customer_only), db: Session = Depends(get_db)):
    validate_coords(body.pickup_lat, body.pickup_lng)
    validate_coords(body.drop_lat, body.drop_lng)
    _validate_goods(body.goods)
    if not u.name:
        raise HTTPException(400, "Please complete your profile before booking")
    st = get_settings(db)
    _check_area(db, st, body)
    vt = db.get(m.VehicleType, body.vehicle_type_id)
    if not vt or not vt.active:
        raise HTTPException(400, "Vehicle not available")
    g = body.goods
    ok, why = vehicle_fits(vt, g.weight_kg, g.length_cm, g.category)
    if not ok:
        raise HTTPException(400, f"{vt.name} cannot be booked: {why}")
    if body.booking_mode == "scheduled":
        if not body.scheduled_at or body.scheduled_at < now() + timedelta(minutes=30):
            raise HTTPException(400, "Choose a pickup time at least 30 minutes from now")
    route = road_route(body.pickup_lat, body.pickup_lng, body.drop_lat, body.drop_lng)  # distance is ALWAYS computed on the server
    km = route["km"]
    if km < 0.1 or km > 4000:
        raise HTTPException(400, "Pickup and drop locations look invalid")
    quote = needs_quotation(st, g.category, g.weight_kg, km, g.length_cm, g.special_handling)
    fare = calc_fare(db, vt, km, g.helper_needed, body.scheduled_at if body.booking_mode == "scheduled" else None, g.special_handling)
    b = m.Booking(code=new_code(db), customer_id=u.id, vehicle_type_id=vt.id, booking_mode=body.booking_mode, scheduled_at=body.scheduled_at,
                  pricing_mode="quotation" if quote else "fixed", pickup_address=body.pickup_address, pickup_lat=body.pickup_lat, pickup_lng=body.pickup_lng,
                  drop_address=body.drop_address, drop_lat=body.drop_lat, drop_lng=body.drop_lng, distance_km=km, distance_source=route["source"],
                  route_polyline=json.dumps(route["polyline"]), goods_category=g.category, goods_description=g.description, quantity=g.quantity,
                  weight_kg=g.weight_kg, length_cm=g.length_cm, width_cm=g.width_cm, height_cm=g.height_cm, packages=g.packages, handling=g.handling,
                  loading_notes=g.loading_notes, helper_needed=g.helper_needed, receiver_name=g.receiver_name, receiver_phone=phone_clean(g.receiver_phone),
                  pickup_landmark=body.pickup_landmark, pickup_gate=body.pickup_gate, pickup_floor=body.pickup_floor, pickup_entry=body.pickup_entry,
                  payment_method=body.payment_method, pickup_otp=f"{secrets.randbelow(9000) + 1000}", delivery_otp=f"{secrets.randbelow(9000) + 1000}",
                  track_token=secrets.token_urlsafe(18), status="new", commission_pct=fare["commission_pct"])
    if not quote:
        b.fare_base, b.fare_distance, b.night_charge = fare["base"], fare["distance_charge"], fare["night"]
        b.helper_charge, b.special_charge, b.fare_total = fare["helper"], fare["special"], fare["total"]
        b.commission, b.driver_share = fare["commission"], fare["driver_share"]
    db.add(b)
    db.flush()
    db.add(m.BookingStatusHistory(booking_id=b.id, from_status=None, to_status="new", by_user_id=u.id, note="Created"))
    if quote:
        b.status = "quotation_requested"
        db.add(m.BookingStatusHistory(booking_id=b.id, from_status="new", to_status="quotation_requested", by_user_id=u.id, note=quote and "Needs admin quotation"))
        for adm in db.query(m.User).filter_by(role="admin").all():
            db.add(m.Notification(user_id=adm.id, booking_id=b.id, kind="admin_quotation", title="Quotation requested", body=f"{b.code} · {g.category} · {g.weight_kg} kg · {km} km"))
    else:
        _apply_payment_choice(db, b, u, st)
    db.commit()
    db.refresh(b)
    return booking_dict(db, b, "customer")


def _apply_payment_choice(db, b: m.Booking, u: m.User, st: dict):
    """Move a priced booking forward according to the payment method. Raises on COD / credit rule violations."""
    b.status = "new" if b.status != "quotation_sent" else b.status
    if b.payment_method == "online":
        b.expires_at = now() + timedelta(minutes=st["payment_expiry_min"])
        db.add(m.BookingStatusHistory(booking_id=b.id, from_status=b.status, to_status="awaiting_payment", by_user_id=u.id, note="Awaiting online payment"))
        b.status = "awaiting_payment"
        b.payment_status = "unpaid"
    elif b.payment_method == "cod":
        allow = cod_allowance(db, u)
        if allow["remaining"] <= 0:
            raise HTTPException(400, f"Cash on delivery limit reached ({allow['limit']} trips). Please pay online or use business credit.")
        u.cod_used = (u.cod_used or 0) + 1
        b.payment_status = "cod_pending"
        _to_pending(db, b, u)
    else:
        acc = db.query(m.CreditAccount).filter_by(user_id=u.id).first()
        if not acc or acc.status != "approved":
            raise HTTPException(400, "Monthly credit is not approved for your account")
        cs = credit_summary(db, acc)
        if b.fare_total > cs["available"]:
            raise HTTPException(400, f"Credit limit exceeded. Available credit ₹{cs['available']:.0f}.")
        db.add(m.CreditTxn(account_id=acc.id, booking_id=b.id, kind="charge", amount=b.fare_total, note=f"Booking {b.code}"))
        b.payment_status = "credit_billed"
        _to_pending(db, b, u)


def _to_pending(db, b, u):
    prev = b.status
    db.add(m.BookingStatusHistory(booking_id=b.id, from_status=prev, to_status="pending_assignment", by_user_id=u.id, note="Booking confirmed"))
    b.status = "pending_assignment"
    notify(db, b.customer_id, "booking_confirmed", b)
    for adm in db.query(m.User).filter_by(role="admin").all():
        db.add(m.Notification(user_id=adm.id, booking_id=b.id, kind="admin_new_booking", title="New booking awaiting assignment", body=f"{b.code} · {b.pickup_address[:40]} → {b.drop_address[:40]}"))
    from ..services import auto_assign
    auto_assign(db, b)


def _mine(db, u, bid) -> m.Booking:
    b = db.get(m.Booking, bid)
    if not b or b.customer_id != u.id:
        raise HTTPException(404, "Booking not found")
    return b


@router.get("/bookings")
def my_bookings(status: str | None = None, u: m.User = Depends(customer_only), db: Session = Depends(get_db)):
    q = db.query(m.Booking).filter_by(customer_id=u.id).order_by(m.Booking.id.desc())
    items = [booking_dict(db, b, "customer") for b in q.limit(100)]
    for i in items:
        i.pop("route", None)
    return items


@router.get("/bookings/{bid}")
def booking_detail(bid: int, u: m.User = Depends(customer_only), db: Session = Depends(get_db)):
    b = _mine(db, u, bid)
    d = booking_dict(db, b, "customer")
    q = db.query(m.Quotation).filter_by(booking_id=b.id).order_by(m.Quotation.id.desc()).first()
    d["quotation"] = {"id": q.id, "amount": q.amount, "notes": q.notes, "status": q.status} if q else None
    d["history"] = [{"to": h.to_status, "note": h.note, "at": iso(h.at)} for h in db.query(m.BookingStatusHistory).filter_by(booking_id=b.id).order_by(m.BookingStatusHistory.id)]
    ref = db.query(m.Refund).filter_by(booking_id=b.id).order_by(m.Refund.id.desc()).first()
    d["refund"] = {"amount": ref.amount, "status": ref.status, "note": ref.note} if ref else None
    d["photos"] = [a.id for a in db.query(m.Attachment).filter(m.Attachment.booking_id == b.id, m.Attachment.kind.in_(["goods", "pickup_goods", "delivery_proof", "pickup_location"]))]
    d["delivery_proof"] = [a.id for a in db.query(m.Attachment).filter_by(booking_id=b.id, kind="delivery_proof")]
    return d


@router.post("/bookings/{bid}/photos")
async def upload_photo(bid: int, kind: str = Form("goods"), file: UploadFile = File(...), u: m.User = Depends(customer_only), db: Session = Depends(get_db)):
    b = _mine(db, u, bid)
    if kind not in ("goods", "pickup_location"):
        raise HTTPException(400, "Invalid photo type")
    if b.status in ("completed", "cancelled", "refunded"):
        raise HTTPException(409, "Booking is closed")
    a = await save_upload(db, file, u, kind, booking_id=b.id, images_only=True)
    db.commit()
    return {"id": a.id}


class PickupHelpIn(BaseModel):
    landmark: str | None = Field(None, max_length=300)
    gate: str | None = Field(None, max_length=120)
    floor: str | None = Field(None, max_length=120)
    entry: str | None = Field(None, max_length=300)


@router.put("/bookings/{bid}/pickup-instructions")
def pickup_instructions(bid: int, body: PickupHelpIn, u: m.User = Depends(customer_only), db: Session = Depends(get_db)):
    b = _mine(db, u, bid)
    if b.status in ("completed", "cancelled", "refunded", "pickup_verified", "in_transit", "delivery_pending", "delivered"):
        raise HTTPException(409, "Pickup instructions can no longer be changed")
    b.pickup_landmark, b.pickup_gate, b.pickup_floor, b.pickup_entry = body.landmark, body.gate, body.floor, body.entry
    if b.driver:
        notify(db, b.driver.user_id, "pickup_help_reply", b)
        system_message(db, b, "Customer updated pickup instructions.")
    db.commit()
    return {"ok": True}


# ---------------- payments (Razorpay) ----------------
@router.post("/bookings/{bid}/pay/order")
def create_pay_order(bid: int, u: m.User = Depends(customer_only), db: Session = Depends(get_db)):
    b = _mine(db, u, bid)
    if b.status != "awaiting_payment" or b.payment_method != "online":
        raise HTTPException(409, "This booking is not awaiting online payment")
    if b.expires_at and b.expires_at < now():
        raise HTTPException(409, "Payment window expired. Please book again.")
    amount = int(round(b.fare_total * 100))  # server amount only
    pay = db.query(m.Payment).filter_by(booking_id=b.id, status="created").first()
    if RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET:
        try:
            r = httpx.post("https://api.razorpay.com/v1/orders", auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET),
                           json={"amount": amount, "currency": "INR", "receipt": b.code, "notes": {"booking_id": str(b.id)}}, timeout=15)
            r.raise_for_status()
            oid = r.json()["id"]
        except Exception as e:
            raise HTTPException(502, f"Payment provider error: {str(e)[:120]}")
        pay = m.Payment(booking_id=b.id, method="online", amount=b.fare_total, mode=RAZORPAY_MODE, provider_order_id=oid)
        db.add(pay)
        db.commit()
        return {"mode": RAZORPAY_MODE, "key_id": RAZORPAY_KEY_ID, "order_id": oid, "amount": amount, "currency": "INR", "name": "HaulGo", "description": f"Booking {b.code}"}
    if RAZORPAY_MODE == "dev_simulated":
        oid = "dev_order_" + secrets.token_hex(6)
        pay = m.Payment(booking_id=b.id, method="online", amount=b.fare_total, mode="dev_simulated", provider_order_id=oid)
        db.add(pay)
        db.commit()
        return {"mode": "dev_simulated", "order_id": oid, "amount": amount, "currency": "INR",
                "warning": "DEV SIMULATION: Razorpay keys are not configured. No real money moves."}
    raise HTTPException(503, "Online payments are not configured")


class VerifyIn(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


def mark_paid(db: Session, b: m.Booking, pay: m.Payment, payment_id: str, signature: str | None, by: m.User | None):
    """Idempotent: a provider payment id is processed once."""
    if pay.status == "captured" or b.status != "awaiting_payment":
        return False
    dup = db.query(m.Payment).filter(m.Payment.provider_payment_id == payment_id, m.Payment.id != pay.id).first()
    if dup:
        return False
    pay.status, pay.provider_payment_id, pay.signature = "captured", payment_id, signature
    b.payment_status = "paid"
    notify(db, b.customer_id, "payment_confirmed", b, amount=f"{b.fare_total:.0f}")
    enter_pending_assignment(db, b, by, "Online payment verified")
    return True


@router.post("/bookings/{bid}/pay/verify")
def verify_payment(bid: int, body: VerifyIn, u: m.User = Depends(customer_only), db: Session = Depends(get_db)):
    b = _mine(db, u, bid)
    pay = db.query(m.Payment).filter_by(booking_id=b.id, provider_order_id=body.razorpay_order_id).first()
    if not pay or pay.mode not in ("razorpay_test", "razorpay_live"):
        raise HTTPException(404, "Payment order not found")
    expected = hmac.new(RAZORPAY_KEY_SECRET.encode(), f"{body.razorpay_order_id}|{body.razorpay_payment_id}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, body.razorpay_signature):
        pay.status = "failed"
        db.commit()
        raise HTTPException(400, "Payment signature verification failed")
    mark_paid(db, b, pay, body.razorpay_payment_id, body.razorpay_signature, u)
    db.commit()
    return booking_dict(db, b, "customer")


@router.post("/bookings/{bid}/pay/dev-confirm")
def dev_confirm_payment(bid: int, u: m.User = Depends(customer_only), db: Session = Depends(get_db)):
    """Only available when Razorpay keys are NOT configured and DEV_MODE=1. Clearly marked as simulated; no money moves."""
    if RAZORPAY_MODE != "dev_simulated":
        raise HTTPException(404, "Not available")
    b = _mine(db, u, bid)
    pay = db.query(m.Payment).filter_by(booking_id=b.id, mode="dev_simulated", status="created").order_by(m.Payment.id.desc()).first()
    if not pay:
        raise HTTPException(409, "Create a payment order first")
    mark_paid(db, b, pay, "dev_pay_" + secrets.token_hex(6), None, u)
    db.commit()
    return booking_dict(db, b, "customer")


webhook_router = APIRouter(tags=["webhooks"])


@webhook_router.post("/webhooks/razorpay")
async def razorpay_webhook(request: Request, db: Session = Depends(get_db)):
    raw = await request.body()
    sig = request.headers.get("x-razorpay-signature", "")
    if not RAZORPAY_WEBHOOK_SECRET:
        raise HTTPException(503, "Webhook secret not configured")
    if not hmac.compare_digest(hmac.new(RAZORPAY_WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest(), sig):
        raise HTTPException(400, "Bad signature")
    ev = json.loads(raw)
    event = ev.get("event")
    if event == "payment.captured":
        p = ev["payload"]["payment"]["entity"]
        pay = db.query(m.Payment).filter_by(provider_order_id=p.get("order_id")).first()
        if pay:
            b = db.get(m.Booking, pay.booking_id)
            mark_paid(db, b, pay, p["id"], None, None)
    elif event in ("refund.processed", "refund.failed"):
        rf = ev["payload"]["refund"]["entity"]
        r = db.query(m.Refund).filter_by(provider_refund_id=rf["id"]).first()
        if r:
            r.status = "completed" if event == "refund.processed" else "failed"
            r.updated_at = now()
            b = db.get(m.Booking, r.booking_id)
            if r.status == "completed" and b.status == "refund_pending":
                set_status(db, b, "refunded", None, "Provider confirmed refund")
                b.payment_status = "refunded"
            notify(db, b.customer_id, "refund_update", b, reason=f"Refund {r.status}")
    db.commit()
    return {"ok": True}


# ---------------- quotation ----------------
class QuoteReply(BaseModel):
    accept: bool
    payment_method: str | None = Field(None, pattern="^(online|cod|credit)$")


@router.post("/bookings/{bid}/quotation")
def quotation_reply(bid: int, body: QuoteReply, u: m.User = Depends(customer_only), db: Session = Depends(get_db)):
    b = _mine(db, u, bid)
    q = db.query(m.Quotation).filter_by(booking_id=b.id, status="sent").order_by(m.Quotation.id.desc()).first()
    if b.status != "quotation_sent" or not q:
        raise HTTPException(409, "No quotation awaiting your reply")
    st = get_settings(db)
    if not body.accept:
        q.status = "rejected"
        set_status(db, b, "cancelled", u, "Quotation rejected by customer")
        b.cancelled_by, b.cancel_reason = "customer", "Quotation rejected"
        db.commit()
        return booking_dict(db, b, "customer")
    q.status = "accepted"
    if body.payment_method:
        b.payment_method = body.payment_method
    fee_pct = st["commission_pct"]
    b.fare_total = q.amount
    b.commission = round(q.amount * fee_pct / 100)
    b.driver_share = q.amount - b.commission
    b.commission_pct = fee_pct
    b.fare_base, b.fare_distance, b.night_charge, b.helper_charge, b.special_charge = q.amount, 0, 0, 0, 0
    _apply_payment_choice(db, b, u, st)
    db.commit()
    return booking_dict(db, b, "customer")


# ---------------- cancel / rate / rebook ----------------
class CancelIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


@router.get("/bookings/{bid}/cancel-preview")
def cancel_preview(bid: int, u: m.User = Depends(customer_only), db: Session = Depends(get_db)):
    b = _mine(db, u, bid)
    st = get_settings(db)
    fee = st["cancel_fee_reached"] if b.status == "driver_reached" else (st["cancel_fee_enroute"] if b.status == "driver_accepted" else 0)
    can = b.status in ("quotation_requested", "quotation_sent", "awaiting_payment", "pending_assignment", "driver_assigned", "driver_accepted", "driver_reached")
    return {"can_cancel": can, "fee": min(fee, b.fare_total or 0), "refund_estimate": max((b.fare_total or 0) - fee, 0) if b.payment_status == "paid" else 0}


@router.post("/bookings/{bid}/cancel")
def cancel(bid: int, body: CancelIn, u: m.User = Depends(customer_only), db: Session = Depends(get_db)):
    b = _mine(db, u, bid)
    cancel_booking(db, b, u, "customer", body.reason)
    db.commit()
    return booking_dict(db, b, "customer")


class RateIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(None, max_length=400)
    tip: float = Field(0, ge=0, le=5000)


@router.post("/bookings/{bid}/rate")
def rate(bid: int, body: RateIn, u: m.User = Depends(customer_only), db: Session = Depends(get_db)):
    b = _mine(db, u, bid)
    if b.status not in ("delivered", "completed") or not b.driver_id:
        raise HTTPException(409, "You can rate after delivery")
    if b.rated:
        raise HTTPException(409, "Already rated")
    db.add(m.Review(booking_id=b.id, from_user_id=u.id, driver_id=b.driver_id, rating=body.rating, comment=body.comment, tip=body.tip))
    b.rated = True
    db.flush()
    rating_update(db, b.driver_id)
    db.commit()
    return {"ok": True, "note": "Tip is paid directly to the driver and recorded for reference." if body.tip else None}


@router.get("/bookings/{bid}/rebook")
def rebook_template(bid: int, u: m.User = Depends(customer_only), db: Session = Depends(get_db)):
    b = _mine(db, u, bid)
    return {"pickup": {"address": b.pickup_address, "lat": b.pickup_lat, "lng": b.pickup_lng}, "drop": {"address": b.drop_address, "lat": b.drop_lat, "lng": b.drop_lng},
            "vehicle_type_id": b.vehicle_type_id,
            "goods": {"category": b.goods_category, "description": b.goods_description, "quantity": b.quantity, "weight_kg": b.weight_kg, "length_cm": b.length_cm,
                      "width_cm": b.width_cm, "height_cm": b.height_cm, "packages": b.packages, "handling": b.handling, "loading_notes": b.loading_notes,
                      "helper_needed": b.helper_needed, "receiver_name": b.receiver_name, "receiver_phone": b.receiver_phone, "special_handling": False},
            "pickup_help": {"landmark": b.pickup_landmark, "gate": b.pickup_gate, "floor": b.pickup_floor, "entry": b.pickup_entry}}


# ---------------- wallet / credit ----------------
@router.get("/overview")
def overview(u: m.User = Depends(customer_only), db: Session = Depends(get_db)):
    acc = db.query(m.CreditAccount).filter_by(user_id=u.id).first()
    total = db.query(func.coalesce(func.sum(m.Booking.fare_total), 0)).filter(m.Booking.customer_id == u.id, m.Booking.status.in_(["completed", "delivered"])).scalar()
    active = db.query(m.Booking).filter(m.Booking.customer_id == u.id, m.Booking.status.notin_(["completed", "cancelled", "refunded"])).count()
    return {"credit": credit_summary(db, acc) if acc else None, "cod": cod_allowance(db, u), "total_spent": total, "active_trips": active}


class CreditReq(BaseModel):
    requested_limit: float = Field(gt=0, le=10000000)
    note: str | None = Field(None, max_length=300)


@router.post("/credit/request")
def credit_request(body: CreditReq, u: m.User = Depends(customer_only), db: Session = Depends(get_db)):
    if not u.company_name or not u.gstin:
        raise HTTPException(400, "Add your company name and GSTIN in your profile first")
    acc = db.query(m.CreditAccount).filter_by(user_id=u.id).first()
    if acc and acc.status == "approved":
        raise HTTPException(409, "Credit is already approved. Contact support to change the limit.")
    if acc:
        acc.status, acc.requested_limit, acc.note = "requested", body.requested_limit, body.note
    else:
        db.add(m.CreditAccount(user_id=u.id, status="requested", requested_limit=body.requested_limit, note=body.note))
    for adm in db.query(m.User).filter_by(role="admin").all():
        db.add(m.Notification(user_id=adm.id, kind="admin_credit", title="Credit request", body=f"{u.company_name} requested ₹{body.requested_limit:.0f}"))
    db.commit()
    return {"ok": True}


@router.get("/credit/statement")
def credit_statement(u: m.User = Depends(customer_only), db: Session = Depends(get_db)):
    acc = db.query(m.CreditAccount).filter_by(user_id=u.id).first()
    if not acc:
        return {"account": None, "transactions": []}
    tx = db.query(m.CreditTxn).filter_by(account_id=acc.id).order_by(m.CreditTxn.id.desc()).limit(200).all()
    return {"account": credit_summary(db, acc), "transactions": [{"id": t.id, "kind": t.kind, "amount": t.amount, "note": t.note, "booking_id": t.booking_id, "at": iso(t.created_at)} for t in tx]}


# ---------------- invoice PDF ----------------
@router.get("/bookings/{bid}/invoice")
def invoice(bid: int, u: m.User = Depends(customer_only), db: Session = Depends(get_db)):
    b = _mine(db, u, bid)
    if b.status not in ("delivered", "completed", "refund_pending", "refunded") and not (b.status == "cancelled" and b.cancel_fee):
        raise HTTPException(409, "Invoice is available after delivery")
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    c.setFillColor(colors.HexColor("#3A3541"))
    c.rect(0, h - 90, w, 90, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 24)
    c.drawString(40, h - 55, "HAULGO")
    c.setFont("Helvetica", 10)
    c.drawString(40, h - 72, "Moving Industries Forward · HighCodeX Technologies, Pattabiram, Chennai 600072")
    c.setFillColor(colors.HexColor("#A8651A"))
    c.setFont("Helvetica-Bold", 14)
    c.drawRightString(w - 40, h - 55, "TAX INVOICE / TRIP RECEIPT")
    c.setFillColor(colors.black)
    y = h - 130
    rows = [("Invoice for booking", b.code), ("Date", (b.completed_at or b.delivered_at or b.created_at).strftime("%d %b %Y")),
            ("Customer", (u.company_name or u.name or "")), ("GSTIN", u.gstin or "—"), ("Pickup", b.pickup_address[:90]), ("Drop", b.drop_address[:90]),
            ("Distance", f"{b.distance_km} km"), ("Vehicle", b.vehicle_type.name if b.vehicle_type else ""),
            ("Payment", f"{b.payment_method.upper()} · {b.payment_status}")]
    for k, v in rows:
        c.setFont("Helvetica-Bold", 10)
        c.drawString(40, y, k)
        c.setFont("Helvetica", 10)
        c.drawString(170, y, str(v))
        y -= 18
    y -= 10
    c.line(40, y, w - 40, y)
    y -= 22
    items = [("Base fare", b.fare_base), ("Distance charge", b.fare_distance), ("Night charge", b.night_charge), ("Loading helper", b.helper_charge),
             ("Special handling", b.special_charge), ("Waiting charge", b.waiting_charge), ("Cancellation fee", b.cancel_fee if b.status != "completed" else 0)]
    for k, v in items:
        if v:
            c.setFont("Helvetica", 11)
            c.drawString(40, y, k)
            c.drawRightString(w - 40, y, f"Rs {v:,.2f}")
            y -= 18
    c.line(40, y, w - 40, y)
    y -= 24
    c.setFont("Helvetica-Bold", 14)
    c.drawString(40, y, "Total")
    c.drawRightString(w - 40, y, f"Rs {b.fare_total:,.2f}")
    c.setFont("Helvetica", 8)
    c.setFillColor(colors.HexColor("#858585"))
    c.drawString(40, 50, "System generated invoice. Taxes shown as applicable by the service provider. HaulGo is a marketplace connecting businesses and independent vehicle owners.")
    c.save()
    return Response(buf.getvalue(), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="HaulGo-{b.code}.pdf"'})
