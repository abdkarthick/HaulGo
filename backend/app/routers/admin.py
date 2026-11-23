"""Admin control centre APIs."""
import csv
import io
import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import models as m
from ..core import (ACTIVE_TRIP, DEFAULT_SETTINGS, add_txn, admin_only, audit, credit_summary, get_db, get_settings, iso, notify, now, set_setting,
                    set_status, super_admin, wallet_balance)
from ..services import (activate_vehicle, booking_dict, cancel_booking, driver_busy, expire_offers, matching_vehicle, offer_to_driver, recommend_drivers, system_message, vt_dict)
from .driver import driver_dict

router = APIRouter(prefix="/admin", tags=["admin"])


def _bk_row(b: m.Booking) -> dict:
    return {"id": b.id, "code": b.code, "status": b.status, "mode": b.booking_mode, "scheduled_at": iso(b.scheduled_at), "pricing_mode": b.pricing_mode,
            "customer": (b.customer.company_name or b.customer.name) if b.customer else "", "driver": b.driver.user.name if b.driver else None,
            "vehicle": b.vehicle_type.name if b.vehicle_type else "", "pickup": b.pickup_address, "drop": b.drop_address, "distance_km": b.distance_km,
            "fare": b.fare_total, "payment_method": b.payment_method, "payment_status": b.payment_status, "created_at": iso(b.created_at),
            "pickup_help": bool(b.pickup_help_requested_at)}


# ------------------------------------------------------------ overview
@router.get("/sample-data")
def sample_status(a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    from ..sample_data import has_sample
    return {"loaded": has_sample(db)}


@router.post("/sample-data")
def sample_load(a: m.User = Depends(super_admin), db: Session = Depends(get_db)):
    from ..sample_data import load_sample
    r = load_sample(db)
    audit(db, a, "sample_data_load", "system", None, r["message"])
    db.commit()
    return r


@router.delete("/sample-data")
def sample_remove(a: m.User = Depends(super_admin), db: Session = Depends(get_db)):
    from ..sample_data import remove_sample
    r = remove_sample(db)
    audit(db, a, "sample_data_remove", "system", None, str(r))
    db.commit()
    return r


@router.get("/overview")
def overview(a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    expire_offers(db)
    B = m.Booking
    cnt = lambda *f: db.query(B).filter(*f).count()  # noqa
    commission = db.query(func.coalesce(func.sum(B.commission), 0)).filter(B.status == "completed").scalar()
    gmv = db.query(func.coalesce(func.sum(B.fare_total), 0)).filter(B.status == "completed").scalar()
    paid_out = db.query(func.coalesce(func.sum(m.Payout.amount), 0)).filter(m.Payout.status == "paid").scalar()
    pending_pay = db.query(func.coalesce(func.sum(m.Payout.amount), 0)).filter(m.Payout.status.in_(["requested", "approved"])).scalar()
    cod_due = db.query(func.coalesce(func.sum(m.WalletTxn.amount), 0)).filter(m.WalletTxn.bucket == "due").scalar()
    credit_used = sum(credit_summary(db, c)["used"] for c in db.query(m.CreditAccount).filter_by(status="approved"))
    series = []
    base = now().replace(hour=0, minute=0, second=0, microsecond=0)
    for i in range(13, -1, -1):
        s = base - timedelta(days=i, hours=5, minutes=30)
        e = s + timedelta(days=1)
        rows = db.query(func.count(B.id), func.coalesce(func.sum(B.fare_total), 0), func.coalesce(func.sum(B.commission), 0)).filter(B.created_at >= s, B.created_at < e, B.status.notin_(["cancelled", "awaiting_payment", "quotation_requested", "quotation_sent"])).one()
        series.append({"date": (s + timedelta(hours=5, minutes=30)).strftime("%d %b"), "bookings": rows[0], "revenue": float(rows[1]), "commission": float(rows[2])})
    by_status = dict(db.query(B.status, func.count(B.id)).group_by(B.status).all())
    recent = [_bk_row(b) for b in db.query(B).order_by(B.id.desc()).limit(6)]
    top_rows = (db.query(m.Driver.id, func.count(B.id), func.coalesce(func.sum(B.driver_share), 0)).join(B, B.driver_id == m.Driver.id)
                .filter(B.status == "completed").group_by(m.Driver.id).order_by(func.count(B.id).desc()).limit(5).all())
    top_drivers = []
    for did, trips, earned in top_rows:
        d = db.get(m.Driver, did)
        top_drivers.append({"id": did, "name": d.user.name if d and d.user else "Driver", "reg_no": d.reg_no if d else None, "trips": trips, "earned": float(earned or 0)})
    vehicle_mix = [{"name": n or "Unknown", "count": c} for n, c in db.query(m.VehicleType.name, func.count(B.id)).join(B, B.vehicle_type_id == m.VehicleType.id)
                   .filter(B.status.notin_(["cancelled", "awaiting_payment"])).group_by(m.VehicleType.name).order_by(func.count(B.id).desc()).all()]
    today = series[-1] if series else {"bookings": 0, "revenue": 0}
    from ..sample_data import has_sample
    return {"has_sample": has_sample(db), "recent_bookings": recent, "top_drivers": top_drivers, "vehicle_mix": vehicle_mix, "today_bookings": today["bookings"], "today_revenue": today["revenue"],
            "demo_data_present": db.query(m.User).filter_by(is_demo=True).count() > 0,
            "total_bookings": cnt(), "active_trips": cnt(B.status.in_(ACTIVE_TRIP)), "completed": cnt(B.status == "completed"),
            "cancelled": cnt(B.status.in_(["cancelled", "refund_pending", "refunded"])), "awaiting_assignment": cnt(B.status == "pending_assignment"),
            "quotation_requests": cnt(B.status == "quotation_requested"),
            "online_drivers": db.query(m.Driver).filter_by(online=True, status="approved").count(), "pending_driver_approvals": db.query(m.Driver).filter_by(status="pending").count(),
            "companies": db.query(m.User).filter_by(role="customer").count(), "gmv": gmv, "platform_commission": commission, "paid_out": paid_out, "pending_payouts": pending_pay,
            "outstanding_cod_commission": cod_due, "credit_outstanding": credit_used,
            "pending_credit_requests": db.query(m.CreditAccount).filter_by(status="requested").count(),
            "pending_refunds": db.query(m.Refund).filter(m.Refund.status.in_(["requested", "processing"])).count(),
            "active_sos": db.query(m.SosAlert).filter(m.SosAlert.status != "resolved").count(),
            "open_complaints": db.query(m.Complaint).filter(m.Complaint.status.in_(["open", "in_review"])).count(),
            "pickup_help": cnt(B.pickup_help_requested_at.isnot(None), B.status.in_(["driver_accepted", "driver_reached"])),
            "series": series, "by_status": by_status}


# ------------------------------------------------------------ drivers
@router.get("/drivers")
def drivers(status: str | None = None, q: str | None = None, a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    qs = db.query(m.Driver).join(m.User, m.User.id == m.Driver.user_id)
    if status:
        qs = qs.filter(m.Driver.status == status)
    if q:
        qs = qs.filter(or_(m.User.name.ilike(f"%{q}%"), m.User.phone.ilike(f"%{q}%"), m.Driver.reg_no.ilike(f"%{q}%")))
    out = []
    for d in qs.order_by(m.Driver.id.desc()).limit(200):
        x = driver_dict(db, d)
        x.update({"wallet_balance": wallet_balance(db, d.id), "commission_due": wallet_balance(db, d.id, "due"), "busy": driver_busy(db, d.id),
                  "trips": db.query(m.Booking).filter_by(driver_id=d.id, status="completed").count(), "is_demo": d.user.is_demo})
        out.append(x)
    return out


@router.get("/drivers/{did}")
def driver_detail(did: int, a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    d = db.get(m.Driver, did)
    if not d:
        raise HTTPException(404, "Driver not found")
    x = driver_dict(db, d)
    x.update({"wallet_balance": wallet_balance(db, d.id), "commission_due": wallet_balance(db, d.id, "due"),
              "trips": [_bk_row(b) for b in db.query(m.Booking).filter_by(driver_id=d.id).order_by(m.Booking.id.desc()).limit(30)],
              "payouts": [{"id": p.id, "amount": p.amount, "status": p.status, "at": iso(p.created_at)} for p in db.query(m.Payout).filter_by(driver_id=d.id).order_by(m.Payout.id.desc()).limit(20)]})
    return x


class ReasonIn(BaseModel):
    reason: str | None = Field(None, max_length=200)


@router.post("/drivers/{did}/{action}")
def driver_action(did: int, action: str, body: ReasonIn = ReasonIn(), a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    d = db.get(m.Driver, did)
    if not d:
        raise HTTPException(404, "Driver not found")
    if action == "approve":
        docs = db.query(m.Attachment).filter(m.Attachment.driver_id == d.id, m.Attachment.kind.like("driver_doc:%")).all()
        have = {x.kind.split(":")[1] for x in docs if x.doc_status != "rejected"}
        missing = [t for t in ("licence", "rc") if t not in have]
        if missing:
            raise HTTPException(400, f"Required documents missing or rejected: {', '.join(missing)}")
        d.status, d.reject_reason = "approved", None
        db.add(m.Notification(user_id=d.user_id, kind="driver_approved", title="Account approved", body="You can now go online and accept trips."))
    elif action == "reject":
        d.status, d.reject_reason, d.online = "rejected", body.reason or "Documents not acceptable", False
        db.add(m.Notification(user_id=d.user_id, kind="driver_rejected", title="Registration rejected", body=d.reject_reason))
    elif action == "block":
        d.status, d.online = "blocked", False
    elif action == "unblock":
        d.status = "approved"
    else:
        raise HTTPException(400, "Unknown action")
    audit(db, a, f"driver_{action}", "driver", d.id, body.reason or "")
    db.commit()
    return {"status": d.status}


class DocReview(BaseModel):
    status: str = Field(pattern="^(verified|rejected|pending)$")
    note: str | None = Field(None, max_length=200)


@router.post("/documents/{aid}/review")
def review_doc(aid: int, body: DocReview, a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    x = db.get(m.Attachment, aid)
    if not x or not x.kind.startswith("driver_doc:"):
        raise HTTPException(404, "Document not found")
    x.doc_status, x.doc_note = body.status, body.note
    audit(db, a, "doc_review", "attachment", x.id, f"{x.kind} {body.status}")
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------ customers
@router.get("/customers")
def customers(q: str | None = None, a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    qs = db.query(m.User).filter_by(role="customer")
    if q:
        qs = qs.filter(or_(m.User.name.ilike(f"%{q}%"), m.User.company_name.ilike(f"%{q}%"), m.User.phone.ilike(f"%{q}%")))
    out = []
    for u in qs.order_by(m.User.id.desc()).limit(200):
        acc = db.query(m.CreditAccount).filter_by(user_id=u.id).first()
        out.append({"id": u.id, "name": u.name, "company": u.company_name, "gstin": u.gstin, "phone": u.phone, "email": u.email, "verified": u.verified, "status": u.status,
                    "bookings": db.query(m.Booking).filter_by(customer_id=u.id).count(), "cod_used": u.cod_used, "credit": credit_summary(db, acc) if acc else None, "is_demo": u.is_demo,
                    "created_at": iso(u.created_at)})
    return out


@router.post("/customers/{uid}/{action}")
def customer_action(uid: int, action: str, a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    u = db.get(m.User, uid)
    if not u or u.role != "customer":
        raise HTTPException(404, "Not found")
    if action == "verify":
        u.verified = True
    elif action == "unverify":
        u.verified = False
    elif action == "suspend":
        u.status = "suspended"
    elif action == "activate":
        u.status = "active"
    elif action == "reset-cod" and a.admin_level == "super":
        u.cod_used = 0
    else:
        raise HTTPException(400, "Unknown or not permitted")
    audit(db, a, f"customer_{action}", "user", u.id)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------ bookings
@router.get("/bookings")
def bookings(status: str | None = None, q: str | None = None, date_from: str | None = None, date_to: str | None = None, a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    expire_offers(db)
    qs = db.query(m.Booking)
    if status:
        qs = qs.filter(m.Booking.status == status)
    if q:
        qs = qs.join(m.User, m.User.id == m.Booking.customer_id).filter(or_(m.Booking.code.ilike(f"%{q}%"), m.User.company_name.ilike(f"%{q}%"), m.User.name.ilike(f"%{q}%")))
    try:
        if date_from:
            qs = qs.filter(m.Booking.created_at >= datetime.fromisoformat(date_from))
        if date_to:
            qs = qs.filter(m.Booking.created_at < datetime.fromisoformat(date_to) + timedelta(days=1))
    except ValueError:
        raise HTTPException(400, "Invalid date")
    return [_bk_row(b) for b in qs.order_by(m.Booking.id.desc()).limit(300)]


@router.get("/bookings/{bid}")
def booking_detail(bid: int, a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    b = db.get(m.Booking, bid)
    if not b:
        raise HTTPException(404, "Booking not found")
    d = booking_dict(db, b, "admin")
    d["history"] = [{"from": h.from_status, "to": h.to_status, "note": h.note, "at": iso(h.at)} for h in db.query(m.BookingStatusHistory).filter_by(booking_id=b.id).order_by(m.BookingStatusHistory.id)]
    d["assignments"] = [{"driver_id": x.driver_id, "status": x.status, "by": x.assigned_by, "at": iso(x.offered_at)} for x in db.query(m.DriverAssignment).filter_by(booking_id=b.id).order_by(m.DriverAssignment.id)]
    q = db.query(m.Quotation).filter_by(booking_id=b.id).order_by(m.Quotation.id.desc()).first()
    d["quotation"] = {"id": q.id, "amount": q.amount, "notes": q.notes, "status": q.status} if q else None
    d["payments"] = [{"id": p.id, "amount": p.amount, "status": p.status, "mode": p.mode, "provider_payment_id": p.provider_payment_id} for p in db.query(m.Payment).filter_by(booking_id=b.id)]
    d["refunds"] = [{"id": r.id, "amount": r.amount, "status": r.status} for r in db.query(m.Refund).filter_by(booking_id=b.id)]
    d["photos"] = [{"id": x.id, "kind": x.kind} for x in db.query(m.Attachment).filter(m.Attachment.booking_id == b.id, m.Attachment.kind != "chat")]
    d["recommendations"] = recommend_drivers(db, b) if b.status in ("pending_assignment", "driver_assigned") else []
    d["otp_note"] = "OTPs are visible only to the customer."
    return d


class AssignIn(BaseModel):
    driver_id: int


@router.post("/bookings/{bid}/assign")
def assign(bid: int, body: AssignIn, a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    b = db.get(m.Booking, bid)
    d = db.get(m.Driver, body.driver_id)
    if not b or not d:
        raise HTTPException(404, "Not found")
    if d.status != "approved":
        raise HTTPException(400, "Driver is not approved")
    if driver_busy(db, d.id):
        raise HTTPException(409, "Driver is on another trip")
    v = matching_vehicle(db, d, b)
    if v is None:
        raise HTTPException(400, "None of this driver's vehicles fits the booking (type and capacity)")
    if b.status == "driver_assigned":  # reassign: withdraw current offer
        b.driver_id, b.driver = None, None
        set_status(db, b, "pending_assignment", a, "Admin reassigning")
    if b.status != "pending_assignment":
        raise HTTPException(409, f"Booking is {b.status.replace('_', ' ')}; cannot assign now")
    if not v.is_active:
        activate_vehicle(db, d, v)
    offer_to_driver(db, b, d, f"admin:{a.id}", a)
    audit(db, a, "assign_driver", "booking", b.id, f"driver {d.id}")
    db.commit()
    return {"ok": True, "offer_timeout_s": get_settings(db)["request_timeout_s"]}


@router.post("/bookings/{bid}/cancel")
def admin_cancel(bid: int, body: ReasonIn, a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    b = db.get(m.Booking, bid)
    if not b:
        raise HTTPException(404, "Not found")
    if b.status in ("completed", "cancelled", "refunded", "refund_pending", "delivered"):
        raise HTTPException(409, "Cannot cancel in this status")
    if not body.reason:
        raise HTTPException(400, "A reason is required")
    cancel_booking(db, b, a, "admin", body.reason, waive_fee=True)
    audit(db, a, "cancel_booking", "booking", b.id, body.reason)
    db.commit()
    return {"ok": True}


class QuoteIn(BaseModel):
    amount: float = Field(gt=0, le=10000000)
    notes: str | None = Field(None, max_length=500)


@router.post("/bookings/{bid}/quotation")
def send_quotation(bid: int, body: QuoteIn, a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    b = db.get(m.Booking, bid)
    if not b or b.status not in ("quotation_requested", "quotation_sent"):
        raise HTTPException(409, "Booking is not waiting for a quotation")
    for q in db.query(m.Quotation).filter_by(booking_id=b.id, status="sent"):
        q.status = "superseded"
    db.add(m.Quotation(booking_id=b.id, amount=body.amount, notes=body.notes, created_by=a.id))
    if b.status == "quotation_requested":
        set_status(db, b, "quotation_sent", a, f"Quotation ₹{body.amount:.0f}")
    notify(db, b.customer_id, "quotation_ready", b, amount=f"{body.amount:.0f}")
    audit(db, a, "send_quotation", "booking", b.id, f"{body.amount}")
    db.commit()
    return {"ok": True}


@router.get("/live")
def live(a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    st = get_settings(db)
    rows = db.query(m.Booking).filter(m.Booking.status.in_(ACTIVE_TRIP | {"driver_assigned"})).all()
    out = []
    for b in rows:
        d = b.driver
        stale = (not d or not d.loc_updated_at) or (now() - d.loc_updated_at).total_seconds() > st["tracking_stale_seconds"]
        out.append({**_bk_row(b), "pickup_lat": b.pickup_lat, "pickup_lng": b.pickup_lng, "drop_lat": b.drop_lat, "drop_lng": b.drop_lng,
                    "driver_lat": d.lat if d else None, "driver_lng": d.lng if d else None, "driver_updated_at": iso(d.loc_updated_at) if d else None, "stale": stale,
                    "reg_no": d.reg_no if d else None})
    online = [{"id": d.id, "name": d.user.name, "lat": d.lat, "lng": d.lng, "reg_no": d.reg_no, "busy": driver_busy(db, d.id)} for d in db.query(m.Driver).filter_by(online=True, status="approved") if d.lat is not None]
    return {"trips": out, "online_drivers": online}


# ------------------------------------------------------------ pricing & settings
@router.get("/settings")
def settings_get(a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    return {"settings": get_settings(db), "vehicle_types": [vt_dict(v) for v in db.query(m.VehicleType).order_by(m.VehicleType.sort)],
            "service_areas": [{"id": s.id, "city": s.city, "lat": s.lat, "lng": s.lng, "radius_km": s.radius_km, "active": s.active} for s in db.query(m.ServiceArea)]}


@router.put("/settings")
def settings_put(body: dict, a: m.User = Depends(super_admin), db: Session = Depends(get_db)):
    for k, v in body.items():
        if k not in DEFAULT_SETTINGS:
            raise HTTPException(400, f"Unknown setting {k}")
        want = type(DEFAULT_SETTINGS[k])
        if want is float and isinstance(v, int) and not isinstance(v, bool):
            v = float(v)
        if type(v) is not want:
            raise HTTPException(400, f"Invalid value for {k}")
        if want in (int, float) and v < 0:
            raise HTTPException(400, f"{k} cannot be negative")
        if k == "commission_pct" and v > 50:
            raise HTTPException(400, "Commission cannot exceed 50%")
        set_setting(db, k, v)
    audit(db, a, "settings_update", "settings", None, ",".join(body.keys()))
    db.commit()
    return get_settings(db)


class VTIn(BaseModel):
    key: str = Field(min_length=2, max_length=40)
    name: str
    description: str | None = None
    capacity_kg: float = Field(gt=0)
    max_length_cm: float = 0
    base_fare: float = Field(ge=0)
    per_km: float = Field(ge=0)
    min_fare: float = Field(ge=0)
    helper_charge: float = 0
    waiting_per_min: float = 0
    free_wait_min: int = 15
    special_charge: float = 0
    goods_categories: str = ""
    avg_speed_kmph: float = 35
    sort: int = 0
    active: bool = True


@router.post("/vehicle-types")
def vt_create(body: VTIn, a: m.User = Depends(super_admin), db: Session = Depends(get_db)):
    if db.query(m.VehicleType).filter_by(key=body.key).first():
        raise HTTPException(409, "Key already exists")
    v = m.VehicleType(**body.model_dump())
    db.add(v)
    audit(db, a, "vehicle_type_create", "vehicle_type", None, body.key)
    db.commit()
    return vt_dict(v)


@router.put("/vehicle-types/{vid}")
def vt_update(vid: int, body: VTIn, a: m.User = Depends(super_admin), db: Session = Depends(get_db)):
    v = db.get(m.VehicleType, vid)
    if not v:
        raise HTTPException(404, "Not found")
    for k, val in body.model_dump().items():
        setattr(v, k, val)
    audit(db, a, "vehicle_type_update", "vehicle_type", v.id, v.name)
    db.commit()
    return vt_dict(v)


class AreaIn(BaseModel):
    city: str
    lat: float
    lng: float
    radius_km: float = Field(gt=0, le=3000)
    active: bool = True


@router.post("/service-areas")
def area_create(body: AreaIn, a: m.User = Depends(super_admin), db: Session = Depends(get_db)):
    s = m.ServiceArea(**body.model_dump())
    db.add(s)
    audit(db, a, "service_area_create", "service_area", None, body.city)
    db.commit()
    return {"id": s.id}


@router.put("/service-areas/{sid}")
def area_update(sid: int, body: AreaIn, a: m.User = Depends(super_admin), db: Session = Depends(get_db)):
    s = db.get(m.ServiceArea, sid)
    if not s:
        raise HTTPException(404, "Not found")
    for k, v in body.model_dump().items():
        setattr(s, k, v)
    db.commit()
    return {"ok": True}


@router.delete("/service-areas/{sid}")
def area_delete(sid: int, a: m.User = Depends(super_admin), db: Session = Depends(get_db)):
    s = db.get(m.ServiceArea, sid)
    if s:
        db.delete(s)
        db.commit()
    return {"ok": True}


# ------------------------------------------------------------ payments, refunds, payouts, COD
@router.get("/payments")
def payments(a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    rows = db.query(m.Payment, m.Booking).join(m.Booking, m.Booking.id == m.Payment.booking_id).order_by(m.Payment.id.desc()).limit(300).all()
    return [{"id": p.id, "booking": b.code, "amount": p.amount, "status": p.status, "mode": p.mode, "order_id": p.provider_order_id, "payment_id": p.provider_payment_id, "at": iso(p.created_at)} for p, b in rows]


@router.get("/refunds")
def refunds(a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    rows = db.query(m.Refund, m.Booking).join(m.Booking, m.Booking.id == m.Refund.booking_id).order_by(m.Refund.id.desc()).limit(200).all()
    return [{"id": r.id, "booking": b.code, "amount": r.amount, "status": r.status, "reason": r.reason, "note": r.note, "provider_refund_id": r.provider_refund_id, "at": iso(r.created_at)} for r, b in rows]


class RefundUpd(BaseModel):
    status: str = Field(pattern="^(processing|completed|failed)$")
    reference: str | None = Field(None, max_length=60)
    note: str | None = Field(None, max_length=200)


@router.post("/refunds/{rid}")
def refund_update(rid: int, body: RefundUpd, a: m.User = Depends(super_admin), db: Session = Depends(get_db)):
    r = db.get(m.Refund, rid)
    if not r:
        raise HTTPException(404, "Not found")
    if body.status == "completed" and not (body.reference or r.provider_refund_id):
        raise HTTPException(400, "Enter the payment-provider refund reference. A refund is completed only when the provider confirms it.")
    r.status, r.note, r.updated_at = body.status, body.note, now()
    if body.reference:
        r.provider_refund_id = body.reference
    b = db.get(m.Booking, r.booking_id)
    if body.status == "completed" and b.status == "refund_pending":
        set_status(db, b, "refunded", a, f"Refund confirmed ref {r.provider_refund_id}")
        b.payment_status = "refunded"
    notify(db, b.customer_id, "refund_update", b, reason=f"Refund {body.status}")
    audit(db, a, "refund_update", "refund", r.id, body.status)
    db.commit()
    return {"ok": True}


@router.get("/payouts")
def payouts(a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    rows = db.query(m.Payout, m.Driver).join(m.Driver, m.Driver.id == m.Payout.driver_id).order_by(m.Payout.id.desc()).limit(200).all()
    return [{"id": p.id, "driver": d.user.name, "driver_id": d.id, "amount": p.amount, "status": p.status, "method": p.method, "destination": p.destination, "reference": p.reference, "note": p.admin_note, "at": iso(p.created_at), "processed_at": iso(p.processed_at)} for p, d in rows]


class PayoutAct(BaseModel):
    action: str = Field(pattern="^(approve|paid|reject)$")
    reference: str | None = Field(None, max_length=80)
    note: str | None = Field(None, max_length=200)


@router.post("/payouts/{pid}")
def payout_act(pid: int, body: PayoutAct, a: m.User = Depends(super_admin), db: Session = Depends(get_db)):
    p = db.get(m.Payout, pid)
    if not p:
        raise HTTPException(404, "Not found")
    if body.action == "approve" and p.status == "requested":
        p.status = "approved"
    elif body.action == "paid" and p.status in ("requested", "approved"):
        if not body.reference:
            raise HTTPException(400, "Enter the UPI/bank transaction reference")
        p.status, p.reference, p.processed_at = "paid", body.reference, now()
    elif body.action == "reject" and p.status in ("requested", "approved"):
        p.status, p.processed_at = "rejected", now()
        add_txn(db, p.driver_id, "wallet", "payout_released", p.amount, None, f"Withdrawal #{p.id} rejected")
    else:
        raise HTTPException(409, f"Payout is {p.status}")
    p.admin_note = body.note
    d = db.get(m.Driver, p.driver_id)
    db.add(m.Notification(user_id=d.user_id, kind="payout", title=f"Payout {p.status}", body=f"₹{p.amount:.0f} withdrawal {p.status}"))
    audit(db, a, f"payout_{body.action}", "payout", p.id, f"{p.amount}")
    db.commit()
    return {"status": p.status}


@router.get("/cod-dues")
def cod_dues(a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    st = get_settings(db)
    out = []
    for d in db.query(m.Driver).filter_by(status="approved"):
        due = wallet_balance(db, d.id, "due")
        if due:
            out.append({"driver_id": d.id, "driver": d.user.name, "due": due, "wallet": wallet_balance(db, d.id), "blocked_for_cod": due >= st["cod_commission_threshold"]})
    return out


class SettleIn(BaseModel):
    amount: float = Field(gt=0)
    method: str = Field(pattern="^(cash|upi|wallet)$")
    reference: str | None = Field(None, max_length=80)


@router.post("/cod-dues/{did}/settle")
def settle_due(did: int, body: SettleIn, a: m.User = Depends(super_admin), db: Session = Depends(get_db)):
    due = wallet_balance(db, did, "due")
    if body.amount > due:
        raise HTTPException(400, f"Amount exceeds due ₹{due:.0f}")
    if body.method == "wallet":
        if body.amount > wallet_balance(db, did):
            raise HTTPException(400, "Driver wallet balance is not enough")
        add_txn(db, did, "wallet", "commission_settled", -body.amount, None, "Commission settled from wallet")
    add_txn(db, did, "due", "commission_settled", -body.amount, None, f"Settled via {body.method} {body.reference or ''}")
    audit(db, a, "settle_commission", "driver", did, f"{body.amount} {body.method}")
    db.commit()
    return {"due": wallet_balance(db, did, "due")}


# ------------------------------------------------------------ credit
@router.get("/credit")
def credit_list(a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    return [{"id": c.id, "user_id": c.user_id, "company": c.user.company_name or c.user.name, "gstin": c.user.gstin, "verified": c.user.verified, "note": c.note, **credit_summary(db, c)} for c in db.query(m.CreditAccount).order_by(m.CreditAccount.id.desc())]


class CreditAct(BaseModel):
    action: str = Field(pattern="^(approve|reject|suspend|set_limit|payment)$")
    limit: float | None = Field(None, ge=0)
    amount: float | None = Field(None, gt=0)
    note: str | None = Field(None, max_length=200)


@router.post("/credit/{cid}")
def credit_act(cid: int, body: CreditAct, a: m.User = Depends(super_admin), db: Session = Depends(get_db)):
    c = db.get(m.CreditAccount, cid)
    if not c:
        raise HTTPException(404, "Not found")
    if body.action == "approve":
        if not body.limit:
            raise HTTPException(400, "Set a credit limit")
        c.status, c.credit_limit = "approved", body.limit
        c.user.verified = True
    elif body.action == "set_limit":
        if body.limit is None:
            raise HTTPException(400, "Set a credit limit")
        c.credit_limit = body.limit
    elif body.action == "reject":
        c.status = "rejected"
    elif body.action == "suspend":
        c.status = "suspended"
    elif body.action == "payment":
        if not body.amount:
            raise HTTPException(400, "Enter the payment amount")
        used = credit_summary(db, c)["used"]
        if body.amount > used:
            raise HTTPException(400, f"Payment exceeds outstanding ₹{used:.0f}")
        db.add(m.CreditTxn(account_id=c.id, kind="payment", amount=-body.amount, note=body.note or "Payment received"))
    db.add(m.Notification(user_id=c.user_id, kind="credit", title="Credit account updated", body=f"Status: {c.status}"))
    audit(db, a, f"credit_{body.action}", "credit", c.id, f"{body.limit or body.amount or ''}")
    db.commit()
    return credit_summary(db, c)


@router.get("/credit/{cid}/statement")
def credit_stmt(cid: int, a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    c = db.get(m.CreditAccount, cid)
    if not c:
        raise HTTPException(404, "Not found")
    tx = db.query(m.CreditTxn).filter_by(account_id=c.id).order_by(m.CreditTxn.id.desc()).limit(300).all()
    return {"account": credit_summary(db, c), "transactions": [{"id": t.id, "kind": t.kind, "amount": t.amount, "note": t.note, "at": iso(t.created_at)} for t in tx]}


# ------------------------------------------------------------ complaints, SOS
@router.get("/complaints")
def complaints(status: str | None = None, a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    qs = db.query(m.Complaint)
    if status:
        qs = qs.filter_by(status=status)
    out = []
    for c in qs.order_by(m.Complaint.id.desc()).limit(200):
        u = db.get(m.User, c.user_id)
        b = db.get(m.Booking, c.booking_id) if c.booking_id else None
        out.append({"id": c.id, "user": u.name, "role": u.role, "booking": b.code if b else None, "booking_id": c.booking_id, "category": c.category, "description": c.description, "status": c.status,
                    "admin_response": c.admin_response, "at": iso(c.created_at), "photos": [x.id for x in db.query(m.Attachment).filter_by(kind="complaint", ref_id=c.id)],
                    "events": [{"actor": e.actor, "status": e.status, "text": e.text, "at": iso(e.at)} for e in db.query(m.ComplaintEvent).filter_by(complaint_id=c.id).order_by(m.ComplaintEvent.id)]})
    return out


class ComplaintAct(BaseModel):
    status: str = Field(pattern="^(open|in_review|resolved|rejected)$")
    response: str | None = Field(None, max_length=1000)


@router.post("/complaints/{cid}")
def complaint_act(cid: int, body: ComplaintAct, a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    c = db.get(m.Complaint, cid)
    if not c:
        raise HTTPException(404, "Not found")
    c.status, c.updated_at = body.status, now()
    if body.response:
        c.admin_response = body.response
    db.add(m.ComplaintEvent(complaint_id=c.id, actor=f"admin:{a.id}", status=body.status, text=body.response or f"Status changed to {body.status}"))
    notify(db, c.user_id, "admin_response", None, amount=str(c.id))
    audit(db, a, "complaint_update", "complaint", c.id, body.status)
    db.commit()
    return {"ok": True}


def _sos_dict(db, s: m.SosAlert) -> dict:
    return {"id": s.id, "booking_id": s.booking_id, "booking": db.get(m.Booking, s.booking_id).code if s.booking_id else None, "role": s.role, "lat": s.lat, "lng": s.lng,
            "location": s.loc_note, "note": s.note, "status": s.status, "snapshot": json.loads(s.snapshot or "{}"), "at": iso(s.created_at), "ack_at": iso(s.ack_at), "resolved_at": iso(s.resolved_at),
            "actions": [{"action": x.action, "note": x.note, "actor": x.actor_id, "at": iso(x.at)} for x in db.query(m.SosActionLog).filter_by(sos_id=s.id).order_by(m.SosActionLog.id)]}


@router.get("/sos")
def sos_list(a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    rows = db.query(m.SosAlert).order_by(m.SosAlert.status.asc(), m.SosAlert.id.desc()).limit(100).all()
    rows.sort(key=lambda s: (s.status == "resolved", -s.id))
    return {"alerts": [_sos_dict(db, s) for s in rows], "emergency_numbers": get_settings(db)["emergency_numbers"]}


class SosAct(BaseModel):
    action: str = Field(pattern="^(acknowledge|resolve|note|contacted_customer|contacted_driver)$")
    note: str | None = Field(None, max_length=400)


@router.post("/sos/{sid}")
def sos_act(sid: int, body: SosAct, a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    s = db.get(m.SosAlert, sid)
    if not s:
        raise HTTPException(404, "Not found")
    if body.action == "acknowledge" and s.status == "active":
        s.status, s.ack_by, s.ack_at = "acknowledged", a.id, now()
    elif body.action == "resolve":
        if not body.note:
            raise HTTPException(400, "Add a resolution note")
        s.status, s.resolved_at = "resolved", now()
    elif body.action == "note" and not body.note:
        raise HTTPException(400, "Write a note")
    db.add(m.SosActionLog(sos_id=s.id, actor_id=a.id, action=body.action, note=body.note or ""))
    audit(db, a, f"sos_{body.action}", "sos", s.id, body.note or "")
    db.commit()
    return _sos_dict(db, s)


# ------------------------------------------------------------ communication oversight
@router.get("/communication")
def comm_overview(a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    logs = db.query(m.NotificationLog).filter(m.NotificationLog.channel != "in_app").order_by(m.NotificationLog.id.desc()).limit(200).all()
    calls = db.query(m.CallSession).order_by(m.CallSession.id.desc()).limit(100).all()
    pick = db.query(m.Booking).filter(m.Booking.pickup_help_requested_at.isnot(None)).order_by(m.Booking.pickup_help_requested_at.desc()).limit(50).all()
    tpl = db.query(m.NotificationTemplate).order_by(m.NotificationTemplate.id).all()
    return {"stats": {"chat_messages": db.query(m.ChatMessage).filter(m.ChatMessage.kind != "system").count(), "calls": db.query(m.CallSession).count(),
                      "undelivered_external": db.query(m.NotificationLog).filter(m.NotificationLog.status.in_(["not_configured", "failed"])).count()},
            "notification_logs": [{"id": x.id, "event": x.event, "channel": x.channel, "recipient": x.recipient, "status": x.status, "detail": x.detail, "booking_id": x.booking_id, "at": iso(x.created_at)} for x in logs],
            "call_sessions": [{"id": c.id, "booking_id": c.booking_id, "provider": c.provider, "status": c.status, "detail": c.detail, "at": iso(c.created_at)} for c in calls],
            "pickup_requests": [{"booking_id": b.id, "code": b.code, "pickup": b.pickup_address, "status": b.status, "requested_at": iso(b.pickup_help_requested_at), "open": b.status in ("driver_accepted", "driver_reached")} for b in pick],
            "templates": [{"id": t.id, "event": t.event, "title": t.title, "body": t.body, "to_receiver": t.to_receiver, "sms": t.sms, "whatsapp": t.whatsapp, "email": t.email, "enabled": t.enabled} for t in tpl]}


class TplIn(BaseModel):
    title: str = Field(max_length=120)
    body: str = Field(max_length=400)
    sms: bool = True
    whatsapp: bool = False
    email: bool = False
    enabled: bool = True


@router.put("/templates/{tid}")
def tpl_update(tid: int, body: TplIn, a: m.User = Depends(super_admin), db: Session = Depends(get_db)):
    t = db.get(m.NotificationTemplate, tid)
    if not t:
        raise HTTPException(404, "Not found")
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    audit(db, a, "template_update", "template", t.id, t.event)
    db.commit()
    return {"ok": True}


@router.get("/chat/{bid}")
def chat_investigation(bid: int, a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    """Controlled access for complaint investigation. Every access is audit-logged."""
    b = db.get(m.Booking, bid)
    if not b:
        raise HTTPException(404, "Not found")
    audit(db, a, "chat_investigation_access", "booking", b.id, b.code)
    db.commit()
    rows = db.query(m.ChatMessage).filter_by(booking_id=bid).order_by(m.ChatMessage.id).all()
    names = {b.customer_id: "Customer", (b.driver.user_id if b.driver else -1): "Driver"}
    return {"booking": b.code, "messages": [{"id": x.id, "from": names.get(x.sender_id, "System"), "kind": x.kind, "body": x.body, "lat": x.lat, "lng": x.lng, "attachment_id": x.attachment_id, "at": iso(x.created_at)} for x in rows]}


# ------------------------------------------------------------ reports
@router.get("/audit")
def audit_list(a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    return [{"id": x.id, "actor": x.actor_id, "action": x.action, "entity": x.entity, "entity_id": x.entity_id, "detail": x.detail, "at": iso(x.at)} for x in db.query(m.AuditLog).order_by(m.AuditLog.id.desc()).limit(300)]


@router.get("/wallet-ledger")
def wallet_ledger(a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    rows = db.query(m.WalletTxn, m.Driver).join(m.Driver, m.Driver.id == m.WalletTxn.driver_id).order_by(m.WalletTxn.id.desc()).limit(300).all()
    return [{"id": t.id, "driver": d.user.name, "bucket": t.bucket, "kind": t.kind, "amount": t.amount, "note": t.note, "at": iso(t.created_at)} for t, d in rows]


@router.get("/reports/{name}.csv")
def report_csv(name: str, a: m.User = Depends(admin_only), db: Session = Depends(get_db)):
    out = io.StringIO()
    w = csv.writer(out)
    if name == "bookings":
        w.writerow(["code", "created", "status", "customer", "driver", "vehicle", "pickup", "drop", "km", "fare", "commission", "driver_share", "payment_method", "payment_status"])
        for b in db.query(m.Booking).order_by(m.Booking.id):
            w.writerow([b.code, iso(b.created_at), b.status, b.customer.company_name or b.customer.name, b.driver.user.name if b.driver else "", b.vehicle_type.name, b.pickup_address, b.drop_address, b.distance_km, b.fare_total, b.commission, b.driver_share, b.payment_method, b.payment_status])
    elif name == "payments":
        w.writerow(["id", "booking", "amount", "status", "mode", "order_id", "payment_id", "created"])
        for p in db.query(m.Payment).order_by(m.Payment.id):
            w.writerow([p.id, p.booking_id, p.amount, p.status, p.mode, p.provider_order_id, p.provider_payment_id, iso(p.created_at)])
    elif name == "commission":
        w.writerow(["code", "completed", "payment_method", "fare", "commission_pct", "commission", "driver_share"])
        for b in db.query(m.Booking).filter_by(status="completed"):
            w.writerow([b.code, iso(b.completed_at), b.payment_method, b.fare_total, b.commission_pct, b.commission, b.driver_share])
    elif name == "payouts":
        w.writerow(["id", "driver_id", "amount", "status", "reference", "created", "processed"])
        for p in db.query(m.Payout).order_by(m.Payout.id):
            w.writerow([p.id, p.driver_id, p.amount, p.status, p.reference, iso(p.created_at), iso(p.processed_at)])
    elif name == "credit":
        w.writerow(["company", "gstin", "limit", "used", "available", "status"])
        for c in db.query(m.CreditAccount):
            s = credit_summary(db, c)
            w.writerow([c.user.company_name, c.user.gstin, s["limit"], s["used"], s["available"], s["status"]])
    else:
        raise HTTPException(404, "Unknown report")
    audit(db, a, "report_export", "report", None, name)
    db.commit()
    return Response(out.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="haulgo-{name}.csv"'})
