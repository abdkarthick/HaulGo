"""Business services shared by customer, driver and admin routers."""
import json
from datetime import timedelta

import httpx
from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models as m
from .core import (ACTIVE_TRIP, LIVE_COMMS, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, add_txn, cod_allowance, get_settings,
                   haversine_km, iso, notify, now, set_status, wallet_balance)


# ------------------------------------------------------------------ serializers
def vt_dict(vt: m.VehicleType) -> dict:
    return {"id": vt.id, "key": vt.key, "name": vt.name, "description": vt.description, "capacity_kg": vt.capacity_kg,
            "max_length_cm": vt.max_length_cm, "base_fare": vt.base_fare, "per_km": vt.per_km, "min_fare": vt.min_fare,
            "helper_charge": vt.helper_charge, "waiting_per_min": vt.waiting_per_min, "free_wait_min": vt.free_wait_min,
            "special_charge": vt.special_charge, "goods_categories": vt.goods_categories, "avg_speed_kmph": vt.avg_speed_kmph,
            "active": vt.active}


def driver_public(db: Session, d: m.Driver, stale_s: int = 90) -> dict:
    stale = (not d.loc_updated_at) or (now() - d.loc_updated_at).total_seconds() > stale_s
    return {"id": d.id, "name": d.user.name if d.user else "", "reg_no": d.reg_no, "vehicle": d.vehicle_type.name if d.vehicle_type else "",
            "capacity_kg": d.capacity_kg, "rating": round(d.rating_avg or 0, 1), "rating_count": d.rating_count,
            "lat": d.lat, "lng": d.lng, "location_updated_at": iso(d.loc_updated_at), "location_stale": stale}


def booking_dict(db: Session, b: m.Booking, role: str) -> dict:
    st = get_settings(db)
    d = {
        "id": b.id, "code": b.code, "status": b.status, "booking_mode": b.booking_mode, "scheduled_at": iso(b.scheduled_at),
        "pricing_mode": b.pricing_mode, "pickup_address": b.pickup_address, "pickup_lat": b.pickup_lat, "pickup_lng": b.pickup_lng,
        "drop_address": b.drop_address, "drop_lat": b.drop_lat, "drop_lng": b.drop_lng, "distance_km": b.distance_km,
        "distance_source": b.distance_source, "route": json.loads(b.route_polyline) if b.route_polyline else [],
        "vehicle_type": vt_dict(b.vehicle_type) if b.vehicle_type else None,
        "goods": {"category": b.goods_category, "description": b.goods_description, "quantity": b.quantity, "weight_kg": b.weight_kg,
                  "length_cm": b.length_cm, "width_cm": b.width_cm, "height_cm": b.height_cm, "packages": b.packages,
                  "handling": b.handling, "loading_notes": b.loading_notes, "helper_needed": b.helper_needed},
        "receiver_name": b.receiver_name,
        "pickup_help": {"landmark": b.pickup_landmark, "gate": b.pickup_gate, "floor": b.pickup_floor, "entry": b.pickup_entry,
                        "help_requested_at": iso(b.pickup_help_requested_at)},
        "fare": {"base": b.fare_base, "distance": b.fare_distance, "night": b.night_charge, "helper": b.helper_charge,
                 "special": b.special_charge, "waiting": b.waiting_charge, "total": b.fare_total, "cancel_fee": b.cancel_fee},
        "payment_method": b.payment_method, "payment_status": b.payment_status, "expires_at": iso(b.expires_at),
        "created_at": iso(b.created_at), "assigned_at": iso(b.assigned_at), "accepted_at": iso(b.accepted_at), "reached_at": iso(b.reached_at),
        "picked_at": iso(b.picked_at), "delivered_at": iso(b.delivered_at), "completed_at": iso(b.completed_at),
        "cancel_reason": b.cancel_reason, "cancelled_by": b.cancelled_by, "rated": b.rated,
        "comms_open": b.status in LIVE_COMMS, "delivery_otp_verified": b.delivery_otp_ok,
        "track_url": f"/track/{b.track_token}",
    }
    if b.driver:
        d["driver"] = driver_public(db, b.driver, st["tracking_stale_seconds"])
    else:
        d["driver"] = None
    if role in ("customer",):
        d["pickup_otp"] = b.pickup_otp if b.status in LIVE_COMMS else None
        d["delivery_otp"] = b.delivery_otp if b.status in LIVE_COMMS else None
        d["receiver_phone_set"] = bool(b.receiver_phone)
    if role == "driver":
        d["customer_name"] = (b.customer.company_name or b.customer.name) if b.customer else ""
        d["fare"] = {"total": b.fare_total, "driver_share": b.driver_share, "commission": b.commission}
        d["collect_cash"] = b.fare_total if b.payment_method == "cod" else 0
    if role == "admin":
        d["customer"] = {"id": b.customer_id, "name": b.customer.name, "company": b.customer.company_name, "phone": b.customer.phone}
        d["receiver_phone"] = b.receiver_phone
        d["commission"] = b.commission
        d["driver_share"] = b.driver_share
        if b.driver:
            d["driver"]["phone"] = b.driver.user.phone
            d["driver"]["id"] = b.driver.id
    return d


# ------------------------------------------------------------------ chat
def system_message(db: Session, b: m.Booking, text: str):
    db.add(m.ChatMessage(booking_id=b.id, sender_id=None, kind="system", body=text[:600], delivered_at=now()))


# ------------------------------------------------------------------ assignment
def driver_busy(db: Session, driver_id: int) -> bool:
    return db.query(m.Booking).filter(m.Booking.driver_id == driver_id, m.Booking.status.in_(ACTIVE_TRIP | {"driver_assigned"})).count() > 0


def driver_vehicles(db: Session, d: m.Driver) -> list[m.DriverVehicle]:
    return db.query(m.DriverVehicle).filter_by(driver_id=d.id).order_by(m.DriverVehicle.id).all()


def matching_vehicle(db: Session, d: m.Driver, b: m.Booking) -> m.DriverVehicle | None:
    """The driver's vehicle that fits the booking (active one preferred)."""
    fits = [v for v in driver_vehicles(db, d) if v.vehicle_type_id == b.vehicle_type_id and (v.capacity_kg or 0) >= (b.weight_kg or 0)]
    fits.sort(key=lambda v: not v.is_active)
    return fits[0] if fits else None


def activate_vehicle(db: Session, d: m.Driver, v: m.DriverVehicle):
    """Make v the vehicle the driver is driving now and mirror it on the Driver row."""
    for x in driver_vehicles(db, d):
        x.is_active = x.id == v.id
    d.vehicle_type_id, d.reg_no, d.capacity_kg = v.vehicle_type_id, v.reg_no, v.capacity_kg
    d.rc_no, d.insurance_no, d.permit_no = v.rc_no, v.insurance_no, v.permit_no


def recommend_drivers(db: Session, b: m.Booking, exclude: set[int] | None = None) -> list[dict]:
    st = get_settings(db)
    exclude = exclude or set()
    out = []
    drivers = db.query(m.Driver).filter(m.Driver.status == "approved").all()
    for d in drivers:
        if d.id in exclude or not d.user or d.user.status != "active":
            continue
        reasons = []
        v = matching_vehicle(db, d, b)
        if v is None:
            continue
        if not v.is_active:
            reasons.append("Will switch to " + v.reg_no)
        if b.booking_mode == "instant" and not d.online:
            continue
        if driver_busy(db, d.id):
            continue
        if b.payment_method == "cod" and wallet_balance(db, d.id, "due") >= st["cod_commission_threshold"]:
            continue
        dist = None
        if d.lat is not None and b.pickup_lat is not None:
            dist = round(haversine_km(d.lat, d.lng, b.pickup_lat, b.pickup_lng), 1)
            if dist > st["search_radius_km"] and b.booking_mode == "instant":
                continue
        else:
            reasons.append("Location unknown")
        out.append({"driver_id": d.id, "name": d.user.name, "reg_no": v.reg_no, "vehicle": v.vehicle_type.name, "capacity_kg": v.capacity_kg,
                    "online": d.online, "distance_km": dist, "rating": round(d.rating_avg or 0, 1), "city": d.service_city, "notes": reasons})
    out.sort(key=lambda x: (x["distance_km"] is None, x["distance_km"] or 0, -x["rating"]))
    return out


def offer_to_driver(db: Session, b: m.Booking, driver: m.Driver, assigned_by: str, by: m.User | None = None):
    st = get_settings(db)
    for a in db.query(m.DriverAssignment).filter_by(booking_id=b.id, status="offered").all():
        a.status = "withdrawn"
    db.add(m.DriverAssignment(booking_id=b.id, driver_id=driver.id, status="offered", assigned_by=assigned_by,
                              expires_at=now() + timedelta(seconds=st["request_timeout_s"])))
    b.driver_id = driver.id
    b.driver = driver
    b.assigned_at = now()
    set_status(db, b, "driver_assigned", by, f"Offered to driver #{driver.id} ({assigned_by})")
    notify(db, driver.user_id, "new_trip_request", b)
    notify(db, b.customer_id, "driver_assigned", b)


def broadcast_offer(db: Session, b: m.Booking, recs: list[dict]):
    """Offer the booking to several suitable drivers at once. The booking stays pending_assignment until one accepts."""
    st = get_settings(db)
    expires = now() + timedelta(seconds=st["request_timeout_s"])
    for r in recs[: int(st["broadcast_max_drivers"])]:
        d = db.get(m.Driver, r["driver_id"])
        db.add(m.DriverAssignment(booking_id=b.id, driver_id=d.id, status="offered", assigned_by="broadcast", expires_at=expires))
        notify(db, d.user_id, "new_trip_request", b)
    db.add(m.BookingStatusHistory(booking_id=b.id, from_status=b.status, to_status=b.status, note=f"Request sent to {min(len(recs), int(st['broadcast_max_drivers']))} suitable drivers"))


def auto_assign(db: Session, b: m.Booking):
    """Offers an instant booking to suitable drivers: all at once (broadcast, first accept wins) or, in test mode with broadcast off, to the best one."""
    st = get_settings(db)
    if b.booking_mode != "instant" or b.status != "pending_assignment":
        return False
    if not (st["broadcast_offers"] or st["auto_assign_test_mode"]):
        return False
    if db.query(m.DriverAssignment).filter_by(booking_id=b.id, status="offered").count():
        return True
    tried = {a.driver_id for a in db.query(m.DriverAssignment).filter(m.DriverAssignment.booking_id == b.id, m.DriverAssignment.status.in_(["rejected", "timeout"]))}
    recs = recommend_drivers(db, b, tried)
    if not recs:
        return False
    if st["broadcast_offers"]:
        broadcast_offer(db, b, recs)
    else:
        offer_to_driver(db, b, db.get(m.Driver, recs[0]["driver_id"]), "auto-test-mode")
    return True


def enter_pending_assignment(db: Session, b: m.Booking, by: m.User | None, note: str = ""):
    set_status(db, b, "pending_assignment", by, note)
    notify(db, b.customer_id, "booking_confirmed", b)
    for adm in db.query(m.User).filter_by(role="admin").all():
        db.add(m.Notification(user_id=adm.id, booking_id=b.id, kind="admin_new_booking", title="New booking awaiting assignment",
                              body=f"{b.code} · {b.pickup_address[:40]} → {b.drop_address[:40]}"))
    auto_assign(db, b)


def expire_offers(db: Session):
    """Time-out unanswered driver offers; return booking to the assignment pool. Called periodically."""
    changed = 0
    for a in db.query(m.DriverAssignment).filter(m.DriverAssignment.status == "offered", m.DriverAssignment.expires_at < now()).all():
        a.status, a.responded_at = "timeout", now()
        b = db.get(m.Booking, a.booking_id)
        if b and b.status == "driver_assigned" and b.driver_id == a.driver_id:
            b.driver_id, b.driver = None, None
            set_status(db, b, "pending_assignment", None, "Driver did not respond in time")
            auto_assign(db, b)
        elif b and b.status == "pending_assignment":
            db.flush()
            if not db.query(m.DriverAssignment).filter_by(booking_id=b.id, status="offered").count():
                auto_assign(db, b)
        changed += 1
    for b in db.query(m.Booking).filter(m.Booking.status == "awaiting_payment", m.Booking.expires_at < now()).all():
        set_status(db, b, "cancelled", None, "Payment window expired")
        b.cancel_reason, b.cancelled_by = "Payment not completed in time", "system"
        notify(db, b.customer_id, "booking_cancelled", b, reason="Payment window expired.")
        changed += 1
    if changed:
        db.commit()
    return changed


# ------------------------------------------------------------------ completion / money
def settle_completion(db: Session, b: m.Booking):
    d = b.driver
    if b.payment_method == "cod":
        add_txn(db, d.id, "cod_cash", "cod_collected", b.fare_total, b.id, f"Cash collected {b.code}")
        add_txn(db, d.id, "due", "commission_due", b.commission, b.id, f"Commission due {b.code}")
        b.payment_status = "cod_collected"
    else:
        kind = "earning_online" if b.payment_method == "online" else "earning_credit"
        add_txn(db, d.id, "wallet", kind, b.driver_share, b.id, f"Earning {b.code}")
        if b.payment_method == "online":
            b.customer.online_trips_done = (b.customer.online_trips_done or 0) + 1
    notify(db, b.customer_id, "invoice_generated", b)


# ------------------------------------------------------------------ cancellation & refunds
def refund_via_provider(db: Session, r: m.Refund, pay: m.Payment):
    """Try Razorpay refund. Status only becomes 'completed' via provider webhook (refund.processed) or admin entering provider reference."""
    if not (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET) or pay.mode not in ("razorpay_test", "razorpay_live"):
        return
    try:
        resp = httpx.post(f"https://api.razorpay.com/v1/payments/{pay.provider_payment_id}/refund", auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET),
                          json={"amount": int(round(r.amount * 100)), "notes": {"booking_id": str(r.booking_id)}}, timeout=15)
        if resp.status_code < 300:
            r.provider_refund_id, r.status = resp.json().get("id"), "processing"
        else:
            r.status, r.note = "failed", resp.text[:180]
    except Exception as e:  # noqa
        r.note = f"Provider unreachable: {str(e)[:120]}"
    r.updated_at = now()


def cancel_booking(db: Session, b: m.Booking, by: m.User, by_role: str, reason: str, waive_fee: bool = False):
    if by_role == "customer" and b.status in ("pickup_verified", "in_transit", "delivery_pending", "delivered", "completed", "cancelled"):
        raise HTTPException(409, "This booking can no longer be cancelled. Please contact support.")
    st = get_settings(db)
    fee = 0.0
    if by_role == "customer" and not waive_fee:
        fee = st["cancel_fee_reached"] if b.status == "driver_reached" else (st["cancel_fee_enroute"] if b.status == "driver_accepted" else 0.0)
    fee = min(fee, b.fare_total or 0)
    for a in db.query(m.DriverAssignment).filter(m.DriverAssignment.booking_id == b.id, m.DriverAssignment.status.in_(["offered", "accepted"])).all():
        a.status, a.responded_at = "withdrawn", now()
    driver = b.driver
    set_status(db, b, "cancelled", by, reason)
    b.cancel_reason, b.cancelled_by, b.cancel_fee = reason[:300], by_role, fee
    pay = db.query(m.Payment).filter_by(booking_id=b.id, status="captured").first()
    refund_msg = ""
    if b.payment_method == "online" and pay:
        amt = round((b.fare_total or 0) - fee)
        if amt > 0:
            r = m.Refund(booking_id=b.id, payment_id=pay.id, amount=amt, status="requested", reason=reason[:200])
            db.add(r)
            db.flush()
            refund_via_provider(db, r, pay)
            b.payment_status = "refund_pending"
            set_status(db, b, "refund_pending", by, f"Refund ₹{amt} {r.status}")
            refund_msg = f"Refund of ₹{amt} is {r.status}."
    elif b.payment_method == "cod":
        if fee == 0:
            b.customer.cod_used = max((b.customer.cod_used or 0) - 1, 0)
    elif b.payment_method == "credit":
        acc = db.query(m.CreditAccount).filter_by(user_id=b.customer_id).first()
        if acc:
            db.add(m.CreditTxn(account_id=acc.id, booking_id=b.id, kind="reversal", amount=-round((b.fare_total or 0) - fee), note=f"Cancelled {b.code}"))
    notify(db, b.customer_id, "booking_cancelled", b, reason=(reason + " " + refund_msg).strip())
    if driver:
        notify(db, driver.user_id, "booking_cancelled", b, reason=reason)
    system_message(db, b, "Booking cancelled. Chat and calls are now closed.")


def driver_release(db: Session, b: m.Booking, by: m.User | None, reason: str, status_to: str = "pending_assignment"):
    """Driver cancelled / rejected: no customer fee, booking goes back to the pool."""
    drv = b.driver
    for a in db.query(m.DriverAssignment).filter(m.DriverAssignment.booking_id == b.id, m.DriverAssignment.status.in_(["offered", "accepted"])).all():
        a.status, a.responded_at = "rejected", now()
    b.driver_id, b.driver = None, None
    set_status(db, b, status_to, by, reason)
    notify(db, b.customer_id, "booking_cancelled", b, reason="Your driver cancelled. We are finding another driver for you. No cancellation fee applies.")
    system_message(db, b, "Driver released the trip. A new driver will be assigned.")
    auto_assign(db, b)


def rating_update(db: Session, driver_id: int):
    avg, cnt = db.query(func.avg(m.Review.rating), func.count(m.Review.id)).filter(m.Review.driver_id == driver_id).one()
    d = db.get(m.Driver, driver_id)
    d.rating_avg, d.rating_count = float(avg or 0), cnt
