"""Driver partner: registration, KYC docs, availability, offers, trip workflow, earnings, payouts."""
import hmac
from datetime import timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models as m
from ..core import (ACTIVE_TRIP, add_txn, driver_only, get_db, get_driver, get_settings, iso, notify, now, save_upload, set_status, wallet_balance)
from ..services import (activate_vehicle, auto_assign, booking_dict, driver_busy, driver_release, driver_vehicles, expire_offers, matching_vehicle, settle_completion, system_message, vt_dict)

router = APIRouter(prefix="/driver", tags=["driver"])

DOC_TYPES = ["licence", "rc", "insurance", "permit", "vehicle_photo", "profile_photo", "other"]


class DriverProfileIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    vehicle_type_id: int
    reg_no: str = Field(min_length=6, max_length=20)
    capacity_kg: float = Field(gt=0, le=60000)
    license_no: str = Field(min_length=5, max_length=40)
    rc_no: str | None = Field(None, max_length=40)
    insurance_no: str | None = Field(None, max_length=60)
    permit_no: str | None = Field(None, max_length=60)
    service_city: str | None = Field(None, max_length=80)
    payout_upi: str | None = Field(None, max_length=80)
    payout_bank_name: str | None = Field(None, max_length=80)
    payout_bank_acc: str | None = Field(None, max_length=30)
    payout_ifsc: str | None = Field(None, max_length=20)
    daily_target: float | None = Field(None, ge=0, le=100000)


def driver_dict(db: Session, d: m.Driver) -> dict:
    docs = db.query(m.Attachment).filter(m.Attachment.driver_id == d.id, m.Attachment.kind.like("driver_doc:%")).all()
    return {"id": d.id, "status": d.status, "reject_reason": d.reject_reason, "online": d.online, "name": d.user.name, "phone": d.user.phone,
            "vehicle_type": vt_dict(d.vehicle_type) if d.vehicle_type else None, "vehicle_type_id": d.vehicle_type_id, "reg_no": d.reg_no,
            "capacity_kg": d.capacity_kg, "license_no": d.license_no, "rc_no": d.rc_no, "insurance_no": d.insurance_no, "permit_no": d.permit_no,
            "service_city": d.service_city, "payout_upi": d.payout_upi, "payout_bank_name": d.payout_bank_name, "payout_bank_acc": d.payout_bank_acc,
            "payout_ifsc": d.payout_ifsc, "daily_target": d.daily_target, "rating": round(d.rating_avg or 0, 1), "rating_count": d.rating_count,
            "lat": d.lat, "lng": d.lng, "location_updated_at": iso(d.loc_updated_at),
            "vehicles": [vehicle_dict(v) for v in driver_vehicles(db, d)],
            "documents": [{"id": a.id, "type": a.kind.split(":", 1)[1], "status": a.doc_status, "note": a.doc_note, "mime": a.mime} for a in docs]}


@router.get("/me")
def driver_me(u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d = db.query(m.Driver).filter_by(user_id=u.id).first()
    return driver_dict(db, d) if d else {"status": "none", "name": u.name, "phone": u.phone, "documents": []}


@router.put("/profile")
def save_profile(body: DriverProfileIn, u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    vt = db.get(m.VehicleType, body.vehicle_type_id)
    if not vt:
        raise HTTPException(400, "Select a vehicle type")
    if body.capacity_kg > vt.capacity_kg * 1.15:
        raise HTTPException(400, f"Capacity is higher than the {vt.name} category limit ({int(vt.capacity_kg)} kg). Select a bigger vehicle type.")
    d = db.query(m.Driver).filter_by(user_id=u.id).first()
    if not d:
        d = m.Driver(user_id=u.id)
        db.add(d)
    elif d.status == "blocked":
        raise HTTPException(403, "Your account is blocked. Contact support.")
    u.name = body.name.strip()
    data = body.model_dump(exclude={"name"})
    for k, v in data.items():
        setattr(d, k, v.strip().upper() if k in ("reg_no", "payout_ifsc") and isinstance(v, str) else v)
    if d.status == "rejected":
        d.status, d.reject_reason = "pending", None
    db.flush()
    cur = next((x for x in driver_vehicles(db, d) if x.is_active), None)
    if cur is None:
        cur = m.DriverVehicle(driver_id=d.id, is_active=True)
        db.add(cur)
    cur.vehicle_type_id, cur.reg_no, cur.capacity_kg = d.vehicle_type_id, d.reg_no, d.capacity_kg
    cur.rc_no, cur.insurance_no, cur.permit_no = d.rc_no, d.insurance_no, d.permit_no
    db.commit()
    return driver_dict(db, d)


# ------------------------------------------------------------ vehicles (a driver can own several)
class VehicleIn(BaseModel):
    vehicle_type_id: int
    reg_no: str = Field(min_length=6, max_length=20)
    capacity_kg: float = Field(gt=0, le=60000)
    rc_no: str | None = Field(None, max_length=40)
    insurance_no: str | None = Field(None, max_length=60)
    permit_no: str | None = Field(None, max_length=60)


def vehicle_dict(v: m.DriverVehicle) -> dict:
    return {"id": v.id, "vehicle_type_id": v.vehicle_type_id, "vehicle_type": vt_dict(v.vehicle_type) if v.vehicle_type else None, "reg_no": v.reg_no,
            "capacity_kg": v.capacity_kg, "rc_no": v.rc_no, "insurance_no": v.insurance_no, "permit_no": v.permit_no, "is_active": bool(v.is_active)}


@router.get("/vehicles")
def list_vehicles(u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    return [vehicle_dict(v) for v in driver_vehicles(db, get_driver(db, u))]


@router.post("/vehicles")
def add_vehicle(body: VehicleIn, u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d = get_driver(db, u)
    vt = db.get(m.VehicleType, body.vehicle_type_id)
    if not vt:
        raise HTTPException(400, "Select a vehicle type")
    if body.capacity_kg > vt.capacity_kg * 1.15:
        raise HTTPException(400, f"Capacity is higher than the {vt.name} category limit ({int(vt.capacity_kg)} kg). Select a bigger vehicle type.")
    own = driver_vehicles(db, d)
    if len(own) >= 10:
        raise HTTPException(400, "You can add up to 10 vehicles")
    reg = body.reg_no.strip().upper()
    if any(x.reg_no == reg for x in own):
        raise HTTPException(409, "This registration number is already in your list")
    v = m.DriverVehicle(driver_id=d.id, vehicle_type_id=vt.id, reg_no=reg, capacity_kg=body.capacity_kg, rc_no=body.rc_no, insurance_no=body.insurance_no,
                        permit_no=body.permit_no, is_active=not own)
    db.add(v)
    db.flush()
    if not own:
        activate_vehicle(db, d, v)
    db.commit()
    return vehicle_dict(v)


@router.post("/vehicles/{vid}/activate")
def activate(vid: int, u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d = get_driver(db, u)
    v = db.get(m.DriverVehicle, vid)
    if not v or v.driver_id != d.id:
        raise HTTPException(404, "Vehicle not found")
    if driver_busy(db, d.id):
        raise HTTPException(409, "You cannot change vehicle during a trip")
    activate_vehicle(db, d, v)
    db.commit()
    return [vehicle_dict(x) for x in driver_vehicles(db, d)]


@router.delete("/vehicles/{vid}")
def remove_vehicle(vid: int, u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d = get_driver(db, u)
    v = db.get(m.DriverVehicle, vid)
    if not v or v.driver_id != d.id:
        raise HTTPException(404, "Vehicle not found")
    if v.is_active:
        raise HTTPException(409, "Switch to another vehicle before removing the active one")
    db.delete(v)
    db.commit()
    return [vehicle_dict(x) for x in driver_vehicles(db, d)]


@router.post("/documents")
async def upload_doc(doc_type: str = Form(...), file: UploadFile = File(...), u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    if doc_type not in DOC_TYPES:
        raise HTTPException(400, "Unknown document type")
    d = get_driver(db, u)
    a = await save_upload(db, file, u, f"driver_doc:{doc_type}", driver_id=d.id)
    db.commit()
    return {"id": a.id}


class OnlineIn(BaseModel):
    online: bool


@router.post("/online")
def go_online(body: OnlineIn, u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d = get_driver(db, u)
    if body.online:
        if d.status != "approved":
            raise HTTPException(403, "Your account is not verified yet. You can go online after admin approval.")
        if not d.vehicle_type_id or not d.reg_no:
            raise HTTPException(400, "Complete your vehicle details first")
    d.online = body.online
    db.commit()
    return {"online": d.online}


class LocIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


@router.post("/location")
def push_location(body: LocIn, u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d = get_driver(db, u)
    d.lat, d.lng, d.loc_updated_at = body.lat, body.lng, now()
    active = db.query(m.Booking).filter(m.Booking.driver_id == d.id, m.Booking.status.in_(ACTIVE_TRIP)).first()
    if active:
        db.add(m.LocationPing(booking_id=active.id, driver_id=d.id, lat=body.lat, lng=body.lng))
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------ offers & trips
def _offer_dict(db, a: m.DriverAssignment, b: m.Booking) -> dict:
    d = booking_dict(db, b, "driver")
    d["offer_expires_at"] = iso(a.expires_at)
    d["offer_seconds_left"] = max(int((a.expires_at - now()).total_seconds()), 0)
    return d


@router.get("/dashboard")
def dashboard(u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    expire_offers(db)
    d = get_driver(db, u)
    offers = []
    for a in db.query(m.DriverAssignment).filter_by(driver_id=d.id, status="offered").all():
        b = db.get(m.Booking, a.booking_id)
        if b and (b.status == "driver_assigned" or (b.status == "pending_assignment" and a.assigned_by == "broadcast")):
            offers.append(_offer_dict(db, a, b))
    active = db.query(m.Booking).filter(m.Booking.driver_id == d.id, m.Booking.status.in_(ACTIVE_TRIP)).order_by(m.Booking.id.desc()).first()
    upcoming = db.query(m.Booking).filter(m.Booking.driver_id == d.id, m.Booking.status == "driver_accepted", m.Booking.booking_mode == "scheduled").all()
    today0 = now().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(hours=5, minutes=30)
    today_earn = db.query(func.coalesce(func.sum(m.WalletTxn.amount), 0)).filter(m.WalletTxn.driver_id == d.id, m.WalletTxn.kind.in_(["earning_online", "earning_credit"]), m.WalletTxn.created_at >= today0).scalar() or 0
    cod_today = db.query(func.coalesce(func.sum(m.WalletTxn.amount), 0)).filter(m.WalletTxn.driver_id == d.id, m.WalletTxn.kind == "cod_collected", m.WalletTxn.created_at >= today0).scalar() or 0
    st = get_settings(db)
    unread = db.query(m.Notification).filter_by(user_id=u.id, read=False).count()
    return {"driver": driver_dict(db, d), "offers": offers, "active_trip": booking_dict(db, active, "driver") if active else None,
            "assigned_trips": [booking_dict(db, b, "driver") for b in upcoming],
            "today_earnings": round(today_earn, 2), "cod_today": round(cod_today, 2), "wallet_balance": wallet_balance(db, d.id),
            "commission_due": wallet_balance(db, d.id, "due"), "cod_block_threshold": st["cod_commission_threshold"], "unread_notifications": unread,
            "trips_completed": db.query(m.Booking).filter_by(driver_id=d.id, status="completed").count()}


def _my_offer(db, d, bid):
    a = db.query(m.DriverAssignment).filter_by(booking_id=bid, driver_id=d.id, status="offered").first()
    b = db.get(m.Booking, bid)
    open_for_me = b and (b.status == "driver_assigned" or (b.status == "pending_assignment" and a and a.assigned_by == "broadcast"))
    if not a or not open_for_me:
        raise HTTPException(409, "This trip request is no longer available (another driver may have taken it)")
    if a.expires_at < now():
        expire_offers(db)
        raise HTTPException(409, "This request timed out")
    return a, b


@router.post("/offers/{bid}/accept")
def accept_offer(bid: int, u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d = get_driver(db, u)
    if d.status != "approved":
        raise HTTPException(403, "Account not verified")
    a, b = _my_offer(db, d, bid)
    if db.query(m.Booking).filter(m.Booking.driver_id == d.id, m.Booking.id != b.id, m.Booking.status.in_(ACTIVE_TRIP | {"driver_assigned"})).count():
        raise HTTPException(409, "Finish your current trip before accepting another")
    if a.assigned_by == "broadcast":  # first accept wins: withdraw everyone else, then take the trip
        for o in db.query(m.DriverAssignment).filter(m.DriverAssignment.booking_id == b.id, m.DriverAssignment.status == "offered", m.DriverAssignment.id != a.id).all():
            o.status, o.responded_at = "withdrawn", now()
        b.driver_id, b.driver, b.assigned_at = d.id, d, now()
        set_status(db, b, "driver_assigned", u, f"Taken by driver #{d.id}")
        notify(db, b.customer_id, "driver_assigned", b)
    v = matching_vehicle(db, d, b)
    if v and not v.is_active:  # switch to the vehicle that fits this booking
        activate_vehicle(db, d, v)
    a.status, a.responded_at = "accepted", now()
    b.accepted_at = now()
    set_status(db, b, "driver_accepted", u, "Driver accepted")
    notify(db, b.customer_id, "driver_accepted", b)
    notify(db, b.customer_id, "driver_approaching", b)
    notify(db, b.customer_id, "pickup_otp", b)
    system_message(db, b, "Driver accepted the trip. Chat is now open.")
    db.commit()
    return booking_dict(db, b, "driver")


@router.post("/offers/{bid}/reject")
def reject_offer(bid: int, u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d = get_driver(db, u)
    a, b = _my_offer(db, d, bid)
    if a.assigned_by == "broadcast":  # only this driver steps out; others can still accept
        a.status, a.responded_at = "rejected", now()
        db.flush()
        if not db.query(m.DriverAssignment).filter_by(booking_id=b.id, status="offered").count():
            auto_assign(db, b)
    else:
        driver_release(db, b, u, "Driver rejected the request")
    db.commit()
    return {"ok": True}


def _trip(db, u, bid, *statuses) -> tuple[m.Driver, m.Booking]:
    d = get_driver(db, u)
    b = db.get(m.Booking, bid)
    if not b or b.driver_id != d.id:
        raise HTTPException(404, "Trip not found")
    if statuses and b.status not in statuses:
        raise HTTPException(409, f"Not allowed now (trip is {b.status.replace('_', ' ')})")
    return d, b


@router.get("/trips")
def trips(u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d = get_driver(db, u)
    rows = db.query(m.Booking).filter(m.Booking.driver_id == d.id).order_by(m.Booking.id.desc()).limit(100).all()
    out = []
    for b in rows:
        x = booking_dict(db, b, "driver")
        x.pop("route", None)
        out.append(x)
    return out


@router.get("/trips/{bid}")
def trip_detail(bid: int, u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d, b = _trip(db, u, bid)
    x = booking_dict(db, b, "driver")
    x["photos"] = [a.id for a in db.query(m.Attachment).filter(m.Attachment.booking_id == b.id, m.Attachment.kind.in_(["goods", "pickup_location", "pickup_goods", "delivery_proof"]))]
    x["pickup_photo_ids"] = [a.id for a in db.query(m.Attachment).filter_by(booking_id=b.id, kind="pickup_location")]
    x["goods_photo_ids"] = [a.id for a in db.query(m.Attachment).filter_by(booking_id=b.id, kind="goods")]
    return x


@router.post("/trips/{bid}/reached")
def reached(bid: int, u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d, b = _trip(db, u, bid, "driver_accepted")
    b.reached_at = now()
    set_status(db, b, "driver_reached", u, "Driver reached pickup")
    notify(db, b.customer_id, "driver_reached", b)
    system_message(db, b, "Driver has reached the pickup location.")
    db.commit()
    return booking_dict(db, b, "driver")


class OtpIn(BaseModel):
    otp: str = Field(min_length=4, max_length=4)


@router.post("/trips/{bid}/verify-pickup")
def verify_pickup(bid: int, body: OtpIn, u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d, b = _trip(db, u, bid, "driver_reached")
    if b.pickup_otp_attempts >= 5:
        raise HTTPException(429, "Too many wrong attempts. Contact support to continue.")
    if not hmac.compare_digest(body.otp, b.pickup_otp or ""):
        b.pickup_otp_attempts += 1
        db.commit()
        raise HTTPException(400, f"Incorrect OTP. {5 - b.pickup_otp_attempts} attempts left.")
    b.picked_at = now()
    set_status(db, b, "pickup_verified", u, "Pickup OTP verified")
    notify(db, b.customer_id, "goods_picked", b)
    db.commit()
    return booking_dict(db, b, "driver")


@router.post("/trips/{bid}/pickup-photo")
async def pickup_photo(bid: int, file: UploadFile = File(...), u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d, b = _trip(db, u, bid, "driver_reached", "pickup_verified", "in_transit")
    a = await save_upload(db, file, u, "pickup_goods", booking_id=b.id, driver_id=d.id, images_only=True)
    db.commit()
    return {"id": a.id}


@router.post("/trips/{bid}/start")
def start_trip(bid: int, u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d, b = _trip(db, u, bid, "pickup_verified")
    set_status(db, b, "in_transit", u, "Trip started")
    notify(db, b.customer_id, "trip_started", b)
    notify(db, b.customer_id, "in_transit", b)
    system_message(db, b, "Trip started. Goods are in transit.")
    db.commit()
    return booking_dict(db, b, "driver")


@router.post("/trips/{bid}/arrived-drop")
def arrived_drop(bid: int, u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d, b = _trip(db, u, bid, "in_transit")
    set_status(db, b, "delivery_pending", u, "Arrived at delivery location")
    notify(db, b.customer_id, "delivery_approaching", b)
    system_message(db, b, "Driver has reached the destination.")
    db.commit()
    return booking_dict(db, b, "driver")


@router.post("/trips/{bid}/verify-delivery")
def verify_delivery(bid: int, body: OtpIn, u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d, b = _trip(db, u, bid, "delivery_pending")
    if b.delivery_otp_attempts >= 5:
        raise HTTPException(429, "Too many wrong attempts. Contact support.")
    if not hmac.compare_digest(body.otp, b.delivery_otp or ""):
        b.delivery_otp_attempts += 1
        db.commit()
        raise HTTPException(400, f"Incorrect OTP. {5 - b.delivery_otp_attempts} attempts left.")
    b.delivery_otp_ok = True
    db.commit()
    return booking_dict(db, b, "driver")


@router.post("/trips/{bid}/delivery-proof")
async def delivery_proof(bid: int, file: UploadFile = File(...), u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d, b = _trip(db, u, bid, "delivery_pending", "delivered")
    a = await save_upload(db, file, u, "delivery_proof", booking_id=b.id, driver_id=d.id, images_only=True)
    db.commit()
    return {"id": a.id}


@router.post("/trips/{bid}/deliver")
def deliver(bid: int, u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d, b = _trip(db, u, bid, "delivery_pending")
    if not b.delivery_otp_ok:
        raise HTTPException(400, "Verify the delivery OTP first")
    if not db.query(m.Attachment).filter_by(booking_id=b.id, kind="delivery_proof").count():
        raise HTTPException(400, "Upload a delivery proof photo first")
    b.delivered_at = now()
    set_status(db, b, "delivered", u, "Delivered")
    notify(db, b.customer_id, "delivered", b)
    db.commit()
    return booking_dict(db, b, "driver")


@router.post("/trips/{bid}/complete")
def complete(bid: int, u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d, b = _trip(db, u, bid, "delivered")
    b.completed_at = now()
    set_status(db, b, "completed", u, "Trip completed")
    settle_completion(db, b)
    system_message(db, b, "Trip completed. Chat and calls are now closed.")
    db.commit()
    return booking_dict(db, b, "driver")


class DriverCancel(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


@router.post("/trips/{bid}/cancel")
def driver_cancel(bid: int, body: DriverCancel, u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d, b = _trip(db, u, bid, "driver_accepted", "driver_reached")
    driver_release(db, b, u, f"Driver cancelled: {body.reason}")
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------ earnings / wallet
@router.get("/earnings")
def earnings(u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d = get_driver(db, u)
    q = db.query(m.WalletTxn).filter_by(driver_id=d.id)
    kinds = lambda *k: round(q.filter(m.WalletTxn.kind.in_(k)).with_entities(func.coalesce(func.sum(m.WalletTxn.amount), 0)).scalar() or 0, 2)  # noqa
    week = []
    base = now().replace(hour=0, minute=0, second=0, microsecond=0)
    for i in range(6, -1, -1):
        s = base - timedelta(days=i, hours=5, minutes=30)
        e = s + timedelta(days=1)
        v = db.query(func.coalesce(func.sum(m.WalletTxn.amount), 0)).filter(m.WalletTxn.driver_id == d.id, m.WalletTxn.kind.in_(["earning_online", "earning_credit"]), m.WalletTxn.created_at >= s, m.WalletTxn.created_at < e).scalar() or 0
        cod = db.query(func.coalesce(func.sum(m.WalletTxn.amount), 0)).filter(m.WalletTxn.driver_id == d.id, m.WalletTxn.kind == "cod_collected", m.WalletTxn.created_at >= s, m.WalletTxn.created_at < e).scalar() or 0
        comm = db.query(func.coalesce(func.sum(m.WalletTxn.amount), 0)).filter(m.WalletTxn.driver_id == d.id, m.WalletTxn.kind == "commission_due", m.WalletTxn.created_at >= s, m.WalletTxn.created_at < e).scalar() or 0
        week.append({"date": (s + timedelta(hours=5, minutes=30)).strftime("%a %d"), "earnings": round(v + cod - comm, 2)})
    ledger = db.query(m.WalletTxn).filter_by(driver_id=d.id).order_by(m.WalletTxn.id.desc()).limit(100).all()
    payouts = db.query(m.Payout).filter_by(driver_id=d.id).order_by(m.Payout.id.desc()).limit(50).all()
    st = get_settings(db)
    return {"trips_completed": db.query(m.Booking).filter_by(driver_id=d.id, status="completed").count(),
            "online_earnings": kinds("earning_online", "earning_credit"), "cod_collected": kinds("cod_collected"), "commission_due": wallet_balance(db, d.id, "due"),
            "wallet_balance": wallet_balance(db, d.id), "weekly": week, "daily_target": d.daily_target,
            "cod_blocked": wallet_balance(db, d.id, "due") >= st["cod_commission_threshold"], "cod_block_threshold": st["cod_commission_threshold"],
            "ledger": [{"id": t.id, "bucket": t.bucket, "kind": t.kind, "amount": t.amount, "note": t.note, "at": iso(t.created_at)} for t in ledger],
            "payouts": [{"id": p.id, "amount": p.amount, "status": p.status, "reference": p.reference, "at": iso(p.created_at), "processed_at": iso(p.processed_at)} for p in payouts]}


class WithdrawIn(BaseModel):
    amount: float = Field(gt=0)


@router.post("/withdraw")
def withdraw(body: WithdrawIn, u: m.User = Depends(driver_only), db: Session = Depends(get_db)):
    d = get_driver(db, u)
    if d.status != "approved":
        raise HTTPException(403, "Account not verified")
    if not (d.payout_upi or (d.payout_bank_acc and d.payout_ifsc)):
        raise HTTPException(400, "Add UPI or bank details in your profile first")
    bal = wallet_balance(db, d.id)
    if body.amount > bal:
        raise HTTPException(400, f"Amount is more than your wallet balance (₹{bal:.0f})")
    if body.amount < 100:
        raise HTTPException(400, "Minimum withdrawal is ₹100")
    if db.query(m.Payout).filter_by(driver_id=d.id, status="requested").count() >= 3:
        raise HTTPException(409, "You already have pending withdrawal requests")
    p = m.Payout(driver_id=d.id, amount=body.amount, method="upi" if d.payout_upi else "bank", destination=d.payout_upi or f"{d.payout_bank_name} ****{(d.payout_bank_acc or '')[-4:]}")
    db.add(p)
    db.flush()
    add_txn(db, d.id, "wallet", "payout_hold", -body.amount, None, f"Withdrawal request #{p.id}")
    for adm in db.query(m.User).filter_by(role="admin").all():
        db.add(m.Notification(user_id=adm.id, kind="admin_payout", title="Payout requested", body=f"₹{body.amount:.0f} from {u.name}"))
    db.commit()
    return {"id": p.id, "status": p.status}
