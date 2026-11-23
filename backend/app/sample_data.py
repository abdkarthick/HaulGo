"""Optional sample data so every admin page has something to show. All rows are tagged (code prefix SMP / reference SAMPLE) and can be removed."""
import json
import random
import secrets
from datetime import timedelta

from sqlalchemy.orm import Session

from . import models as m
from .core import add_txn, now

ROUTES = [
    ("Ambattur Industrial Estate", 13.0985, 80.1619, "Guindy Industrial Estate", 13.0067, 80.2206, 14),
    ("Pattabiram, Chennai", 13.1241, 80.0707, "Koyambedu Market", 13.0694, 80.1948, 15),
    ("Avadi, Chennai", 13.1147, 80.1098, "Sriperumbudur", 12.9675, 79.9419, 32),
    ("Kundrathur", 12.9965, 80.0987, "Tambaram", 12.9249, 80.1000, 12),
    ("Red Hills", 13.1862, 80.1802, "Ennore Port", 13.2257, 80.3250, 17),
    ("Poonamallee", 13.0473, 80.0945, "Porur", 13.0382, 80.1565, 9),
]
GOODS = ["Machinery parts", "Steel rods", "Packed cartons", "Plastic moulds", "Electrical panels", "Raw material sacks"]
SAMPLE_PHONES = ["9000000201", "9000000202", "9000000203"]


def _code(i: int) -> str:
    return f"SMP{i:05d}"


def has_sample(db: Session) -> bool:
    return db.query(m.Booking).filter(m.Booking.code.like("SMP%")).count() > 0


def load_sample(db: Session) -> dict:
    if has_sample(db):
        return {"created": 0, "message": "Sample data already loaded"}
    rnd = random.Random(7)
    vts = db.query(m.VehicleType).filter_by(active=True).all()
    drivers = db.query(m.Driver).filter_by(status="approved").all()
    if not vts or not drivers:
        return {"created": 0, "message": "No vehicle types or approved drivers found"}
    for i, d in enumerate(drivers):
        d.online = i < 3
        d.rating_avg, d.rating_count = round(4.3 + (i % 5) * 0.14, 1), 6 + i
    custs = [db.query(m.User).filter_by(role="customer", is_demo=True).first()]
    for k, (ph, nm, co) in enumerate(zip(SAMPLE_PHONES, ["Ravi Kumar", "Meena S", "Arun Prakash"], ["Sri Murugan Moulds", "Meena Fabricators", "Arun Engineering Works"])):
        if not db.query(m.User).filter_by(phone=ph).first():
            u = m.User(role="customer", phone=ph, name=nm, company_name=co, gstin=f"33AAAC{k}0000A1Z{k + 1}", contact_person=nm, is_demo=True, verified=k != 2)
            db.add(u)
        custs.append(db.query(m.User).filter_by(phone=ph).first() or u)
    db.flush()
    custs = [c for c in custs if c]
    acc = db.query(m.CreditAccount).filter_by(user_id=custs[0].id).first()
    if not acc:
        acc = m.CreditAccount(user_id=custs[0].id, status="approved", requested_limit=100000, credit_limit=100000, note="SAMPLE")
        db.add(acc)
    pend = db.query(m.CreditAccount).filter_by(user_id=custs[2].id).first()
    if not pend:
        db.add(m.CreditAccount(user_id=custs[2].id, status="requested", requested_limit=50000, note="SAMPLE"))
    db.flush()

    n, t0 = 0, now()
    def make(i, status, day, pay_method, paid=True):
        nonlocal n
        pk, pl, pa, dk, dl, da, km = ROUTES[i % len(ROUTES)]
        vt, drv, cu = vts[i % len(vts)], drivers[i % len(drivers)], custs[i % len(custs)]
        fare = round(max(vt.min_fare or 0, (vt.base_fare or 0) + km * (vt.per_km or 0)), 0)
        comm = round(fare * 0.12, 0)
        at = t0 - timedelta(days=day, hours=rnd.randint(0, 9))
        n += 1
        b = m.Booking(code=_code(n), customer_id=cu.id, driver_id=drv.id if status != "awaiting_payment" and status != "pending_assignment" else None, vehicle_type_id=vt.id, status=status,
                      pricing_mode="fixed", pickup_address=pk, pickup_lat=pl, pickup_lng=pa, drop_address=dk, drop_lat=dl, drop_lng=da, distance_km=km, distance_source="fallback_estimate",
                      goods_category="General", goods_description=GOODS[i % len(GOODS)], quantity=1, weight_kg=rnd.choice([120, 300, 650, 900]), packages=rnd.randint(1, 8),
                      receiver_name="Site Manager", receiver_phone="9876500000", fare_base=vt.base_fare or 0, fare_distance=round(km * (vt.per_km or 0), 0), fare_total=fare,
                      commission_pct=12, commission=comm, driver_share=fare - comm, payment_method=pay_method, payment_status="unpaid",
                      track_token=secrets.token_hex(12), created_at=at)
        db.add(b)
        db.flush()
        if status == "completed":
            b.completed_at = b.delivered_at = at + timedelta(hours=3)
            b.payment_status = {"online": "paid", "cod": "cod_collected", "credit": "credit_billed"}[pay_method]
            db.add(m.BookingStatusHistory(booking_id=b.id, from_status="in_transit", to_status="completed", note="SAMPLE", at=b.completed_at))
            if pay_method == "online":
                db.add(m.Payment(booking_id=b.id, method="online", amount=fare, status="captured", mode="dev_simulated", provider_order_id=f"order_smp{n}", provider_payment_id=f"pay_smp{n}", created_at=at))
                add_txn(db, drv.id, "wallet", "earning_online", fare - comm, b.id, f"Trip {b.code}")
            elif pay_method == "cod":
                db.add(m.Payment(booking_id=b.id, method="cod", amount=fare, status="captured", mode="cod", provider_payment_id=f"cod_smp{n}", created_at=at))
                add_txn(db, drv.id, "cod_cash", "cod_collected", fare, b.id, f"Cash for {b.code}")
                add_txn(db, drv.id, "due", "commission_due", comm, b.id, f"Commission {b.code}")
            else:
                db.add(m.Payment(booking_id=b.id, method="credit", amount=fare, status="captured", mode="credit", provider_payment_id=f"cr_smp{n}", created_at=at))
                db.add(m.CreditTxn(account_id=acc.id, booking_id=b.id, kind="charge", amount=fare, note=f"Trip {b.code}", created_at=at))
                add_txn(db, drv.id, "wallet", "earning_online", fare - comm, b.id, f"Trip {b.code}")
            db.add(m.Review(booking_id=b.id, from_user_id=cu.id, driver_id=drv.id, rating=rnd.choice([4, 5, 5, 5, 3]), comment=rnd.choice(["On time delivery", "Careful with goods", "Good driver", "Smooth trip"])))
            b.rated = True
        return b

    plan = [(0, 13), (1, 13), (2, 12), (3, 11), (4, 11), (5, 10), (0, 10), (1, 9), (2, 8), (3, 8), (4, 7), (5, 6), (0, 6), (1, 5), (2, 5), (3, 4), (4, 3), (5, 3), (0, 2), (1, 2), (2, 1), (3, 1), (4, 0), (5, 0)]
    methods = ["online", "cod", "online", "credit", "online", "cod"]
    for k, (ri, day) in enumerate(plan):
        make(ri, "completed", day, methods[k % len(methods)])
    cx = make(1, "cancelled", 4, "online")
    cx.cancelled_by, cx.cancel_reason, cx.payment_status = "customer", "Plan changed", "refund_pending"
    pay = m.Payment(booking_id=cx.id, method="online", amount=cx.fare_total, status="captured", mode="dev_simulated", provider_order_id="order_smpx", provider_payment_id="pay_smpx")
    db.add(pay)
    db.flush()
    db.add(m.Refund(booking_id=cx.id, payment_id=pay.id, amount=cx.fare_total, status="processing", reason="Customer cancelled", note="SAMPLE"))
    c2 = make(2, "cancelled", 2, "cod")
    c2.cancelled_by, c2.cancel_reason = "customer", "Booked by mistake"
    live = make(3, "in_transit", 0, "online")
    live.payment_status, live.picked_at = "paid", now() - timedelta(minutes=40)
    db.add(m.Payment(booking_id=live.id, method="online", amount=live.fare_total, status="captured", mode="dev_simulated", provider_order_id="order_smpl", provider_payment_id="pay_smpl"))
    drivers[0].lat, drivers[0].lng, drivers[0].loc_updated_at = 13.1020, 80.1420, now()
    make(0, "pending_assignment", 0, "online").payment_status = "paid"
    make(4, "awaiting_payment", 0, "online")

    done = db.query(m.Booking).filter(m.Booking.code.like("SMP%"), m.Booking.status == "completed").all()
    for d in drivers[:3]:
        db.add(m.Payout(driver_id=d.id, amount=1500, status="paid", method="UPI", destination=d.payout_upi, reference="SAMPLE", admin_note="Weekly payout", created_at=now() - timedelta(days=3), processed_at=now() - timedelta(days=2)))
        add_txn(db, d.id, "wallet", "payout", -1500, None, "Weekly payout (sample)")
    db.add(m.Payout(driver_id=drivers[0].id, amount=800, status="requested", method="UPI", destination=drivers[0].payout_upi, reference="SAMPLE"))
    for b, cat, txt, st in [(done[0], "Delay", "Driver reached the pickup late by 30 minutes.", "open"), (done[3], "Goods damage", "One carton was bent on delivery.", "in_review"), (done[6], "Billing", "Fare shown was different from invoice.", "resolved")]:
        db.add(m.Complaint(user_id=b.customer_id, booking_id=b.id, category=cat, description=txt, status=st, admin_response="Looking into it." if st != "open" else None))
    snap = json.dumps({"booking": live.code, "note": "sample"})
    db.add(m.SosAlert(booking_id=done[1].id, raised_by_id=done[1].customer_id, role="customer", lat=13.05, lng=80.12, loc_note="last_known", note="Sample alert (resolved)", snapshot=snap, status="resolved", resolved_at=now()))
    db.add(m.CallSession(booking_id=done[2].id, caller_id=done[2].customer_id, callee_id=drivers[0].user_id, provider="masked", status="demo_not_connected", detail="SAMPLE"))
    db.commit()
    return {"created": n, "message": f"{n} sample bookings with payments, payouts, complaints and credit added"}


def remove_sample(db: Session) -> dict:
    ids = [b.id for b in db.query(m.Booking).filter(m.Booking.code.like("SMP%"))]
    if ids:
        for M in (m.Payment, m.Refund, m.WalletTxn, m.CreditTxn, m.Review, m.Complaint, m.SosAlert, m.CallSession, m.BookingStatusHistory):
            db.query(M).filter(M.booking_id.in_(ids)).delete(synchronize_session=False)
        db.query(m.Booking).filter(m.Booking.id.in_(ids)).delete(synchronize_session=False)
    db.query(m.WalletTxn).filter(m.WalletTxn.note.like("%(sample)")).delete(synchronize_session=False)
    db.query(m.Payout).filter_by(reference="SAMPLE").delete(synchronize_session=False)
    db.query(m.CreditAccount).filter_by(note="SAMPLE").delete(synchronize_session=False)
    for u in db.query(m.User).filter(m.User.phone.in_(SAMPLE_PHONES)):
        db.delete(u)
    db.commit()
    return {"removed": len(ids)}
