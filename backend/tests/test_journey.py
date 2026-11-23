"""End-to-end API journey test. Run: DATABASE_URL=sqlite:///test.db python -m pytest -q tests  (or python tests/test_journey.py)"""
import os
import sys
import tempfile
from pathlib import Path

tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{tmp}/t.db"
os.environ["UPLOAD_DIR"] = f"{tmp}/up"
os.environ["DEV_MODE"] = "1"
os.environ["DEMO_MODE"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app import core  # noqa: E402
from app.main import app  # noqa: E402

# Never hit the network in tests: OSRM fallback is exercised on purpose
core.OSRM_URL = "http://127.0.0.1:9"


def login(c, phone, role, name=None):
    r = c.post("/api/auth/otp/request", json={"phone": phone, "role": role})
    assert r.status_code == 200, r.text
    otp = r.json()["dev_otp"]
    r = c.post("/api/auth/otp/verify", json={"phone": phone, "role": role, "otp": otp, "name": name})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


GOODS = dict(category="finished_products", description="Steel brackets", quantity=10, weight_kg=500, packages=10, receiver_name="Ravi", receiver_phone="9876543210", helper_needed=True)
P, D = (13.1180, 80.0990), (12.9800, 80.2100)


def est_body():
    return dict(pickup_lat=P[0], pickup_lng=P[1], drop_lat=D[0], drop_lng=D[1], goods=GOODS)


def book(c, h, method, **extra):
    est = c.post("/api/customer/estimate", json=est_body(), headers=h)
    assert est.status_code == 200, est.text
    e = est.json()
    vt = e["suggested_vehicle_type_id"]
    body = {**est_body(), "pickup_address": "Pattabiram", "drop_address": "Adyar", "vehicle_type_id": vt, "payment_method": method, **extra}
    return c.post("/api/customer/bookings", json=body, headers=h), e


def test_all():
    with TestClient(app) as c:
        cust = login(c, "9111111111", "customer", "Test Co")
        assert c.put("/api/me", json={"company_name": "Test Industries", "gstin": "33AAAAA0000A1Z5"}, headers=cust).status_code == 200

        # --- role isolation
        assert c.get("/api/admin/overview", headers=cust).status_code == 403
        assert c.get("/api/driver/me", headers=cust).status_code == 403

        # --- estimate: server fare, vehicle suitability
        est = c.post("/api/customer/estimate", json=est_body(), headers=cust).json()
        assert est["distance_km"] > 10 and est["pricing_mode"] == "fixed"
        fits = [v for v in est["vehicles"] if v["suitable"]]
        assert all(v["capacity_kg"] >= 500 for v in fits)
        assert est["suggested_vehicle_type_id"] == fits[0]["id"]
        small = next(v for v in est["vehicles"] if v["key"] == "mini_truck")
        assert small["fare"] >= small["min_fare"]
        # heavy load -> never recommends tiny vehicle
        heavy = {**est_body(), "goods": {**GOODS, "weight_kg": 3000}}
        e2 = c.post("/api/customer/estimate", json=heavy, headers=cust).json()
        assert not next(v for v in e2["vehicles"] if v["key"] == "mini_truck")["suitable"]
        # machinery heavy -> quotation
        mach = {**est_body(), "goods": {**GOODS, "category": "machinery", "weight_kg": 3000}}
        assert c.post("/api/customer/estimate", json=mach, headers=cust).json()["pricing_mode"] == "quotation"

        # --- online booking: awaiting payment, then dev-confirm (simulated)
        r, e = book(c, cust, "online")
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["status"] == "awaiting_payment"
        fare = b["fare"]["total"]
        assert fare == next(v for v in e["vehicles"] if v["id"] == b["vehicle_type"]["id"])["fare"]
        # client cannot dictate fare
        r2 = c.post("/api/customer/bookings", json={**est_body(), "pickup_address": "a", "drop_address": "b", "vehicle_type_id": b["vehicle_type"]["id"], "payment_method": "online", "fare_total": 1}, headers=cust)
        assert r2.json()["fare"]["total"] == fare
        order = c.post(f"/api/customer/bookings/{b['id']}/pay/order", headers=cust).json()
        assert order["mode"] == "dev_simulated"
        # forged signature path is rejected (razorpay verify only for real orders)
        assert c.post(f"/api/customer/bookings/{b['id']}/pay/verify", json={"razorpay_order_id": order["order_id"], "razorpay_payment_id": "x", "razorpay_signature": "bad"}, headers=cust).status_code == 404
        # no driver online yet -> stays pending, never falsely assigned
        paid = c.post(f"/api/customer/bookings/{b['id']}/pay/dev-confirm", headers=cust).json()
        assert paid["status"] == "pending_assignment" and paid["payment_status"] == "paid" and paid["driver"] is None

        # --- admin sees recommendations (none, drivers offline), then driver goes online
        adm = c.post("/api/auth/admin/login", json={"email": "admin@highcodex.online", "password": "Admin@12345"}).json()
        ah = {"Authorization": "Bearer " + adm["token"]}
        assert c.post("/api/auth/admin/login", json={"email": "admin@highcodex.online", "password": "wrong"}).status_code == 401
        det = c.get(f"/api/admin/bookings/{b['id']}", headers=ah).json()
        assert det["recommendations"] == []

        # find the matching demo driver by vehicle type
        drivers = c.get("/api/admin/drivers", headers=ah).json()
        vt_id = b["vehicle_type"]["id"]
        dr = next(d for d in drivers if d["vehicle_type_id"] == vt_id and d["is_demo"])
        phone = dr["phone"]
        dh = login(c, phone, "driver")
        assert c.post("/api/driver/online", json={"online": True}, headers=dh).status_code == 200
        recs = c.get(f"/api/admin/bookings/{b['id']}", headers=ah).json()["recommendations"]
        assert recs and recs[0]["driver_id"] == dr["id"]

        # admin assignment (test-mode auto assign disabled to prove admin flow)
        assert c.put("/api/admin/settings", json={"auto_assign_test_mode": False}, headers=ah).status_code == 200
        r = c.post(f"/api/admin/bookings/{b['id']}/assign", json={"driver_id": dr["id"]}, headers=ah)
        assert r.status_code == 200, r.text
        dash = c.get("/api/driver/dashboard", headers=dh).json()
        assert len(dash["offers"]) == 1 and dash["offers"][0]["offer_seconds_left"] > 0
        # chat closed until accepted? (comms open from assigned) - customer cannot see driver phone
        cb = c.get(f"/api/customer/bookings/{b['id']}", headers=cust).json()
        assert "phone" not in str(cb["driver"]).lower() and cb["pickup_otp"]

        # driver rejects -> back to pool, then admin reassigns same driver
        assert c.post(f"/api/driver/offers/{b['id']}/reject", headers=dh).status_code == 200
        assert c.get(f"/api/customer/bookings/{b['id']}", headers=cust).json()["status"] == "pending_assignment"
        assert c.post(f"/api/admin/bookings/{b['id']}/assign", json={"driver_id": dr["id"]}, headers=ah).status_code == 200
        assert c.post(f"/api/driver/offers/{b['id']}/accept", headers=dh).status_code == 200

        # --- chat: privacy + quick reply + access control
        other = login(c, "9222222222", "customer", "Other")
        assert c.get(f"/api/chat/{b['id']}/messages", headers=other).status_code == 403
        assert c.post(f"/api/chat/{b['id']}/messages", json={"kind": "quick", "body": "Coming in 5 minutes"}, headers=dh).status_code == 200
        m1 = c.post(f"/api/chat/{b['id']}/messages", json={"body": "call me 98765 43210 now"}, headers=cust).json()
        assert "98765" not in m1["body"]
        msgs = c.get(f"/api/chat/{b['id']}/messages", headers=cust).json()
        assert msgs["unread"] >= 1
        c.post(f"/api/chat/{b['id']}/read", headers=cust)
        assert c.get("/api/chat-unread", headers=cust).json()["total"] == 0
        # masked call: demo, honest
        call = c.post(f"/api/calls/{b['id']}/start", headers=cust).json()
        assert call["connected"] is False and call["demo"] is True
        # WhatsApp links are gone: everything stays inside the app
        assert "wa.me" not in c.get(f"/api/whatsapp/{b['id']}?action=driver", headers=cust).text
        # pickup assistance
        assert c.post(f"/api/pickup/{b['id']}/cannot-find?lat=13.1&lng=80.1", headers=dh).status_code == 200
        notifs = c.get("/api/notifications", headers=cust).json()
        assert any(n["kind"] == "pickup_help" for n in notifs["items"])
        assert c.post(f"/api/pickup/{b['id']}/reply", json={"lat": 13.119, "lng": 80.1, "landmark": "Blue gate"}, headers=cust).status_code == 200

        # --- trip flow with OTPs
        assert c.post(f"/api/driver/trips/{b['id']}/verify-pickup", json={"otp": "0000"}, headers=dh).status_code == 409  # not reached yet
        assert c.post(f"/api/driver/trips/{b['id']}/reached", headers=dh).status_code == 200
        bad = c.post(f"/api/driver/trips/{b['id']}/verify-pickup", json={"otp": "0000" if cb["pickup_otp"] != "0000" else "1111"}, headers=dh)
        assert bad.status_code == 400
        assert c.post(f"/api/driver/trips/{b['id']}/start", headers=dh).status_code == 409  # cannot skip OTP
        assert c.post(f"/api/driver/trips/{b['id']}/verify-pickup", json={"otp": cb["pickup_otp"]}, headers=dh).status_code == 200
        assert c.post("/api/driver/location", json={"lat": 13.05, "lng": 80.15}, headers=dh).status_code == 200
        assert c.post(f"/api/driver/trips/{b['id']}/start", headers=dh).status_code == 200
        track = c.get(f"/api/customer/bookings/{b['id']}", headers=cust).json()
        pub = c.get(track["track_url"].replace("/track/", "/api/track/")).json()
        assert pub["status"] == "in_transit" and pub["driver"]["lat"] == 13.05 and "phone" not in str(pub)
        # SOS while active
        sos = c.post("/api/sos", json={"booking_id": b["id"], "lat": 13.0, "lng": 80.1}, headers=dh).json()
        assert sos["emergency_numbers"]["Unified emergency"] == "112"
        alerts = c.get("/api/admin/sos", headers=ah).json()["alerts"]
        assert alerts[0]["status"] == "active" and alerts[0]["snapshot"]["driver"]["reg_no"]
        assert c.post(f"/api/admin/sos/{alerts[0]['id']}", json={"action": "resolve"}, headers=ah).status_code == 400
        assert c.post(f"/api/admin/sos/{alerts[0]['id']}", json={"action": "acknowledge"}, headers=ah).json()["status"] == "acknowledged"
        assert c.post(f"/api/admin/sos/{alerts[0]['id']}", json={"action": "resolve", "note": "false alarm"}, headers=ah).json()["status"] == "resolved"

        assert c.post(f"/api/driver/trips/{b['id']}/deliver", headers=dh).status_code == 409
        assert c.post(f"/api/driver/trips/{b['id']}/arrived-drop", headers=dh).status_code == 200
        assert c.post(f"/api/driver/trips/{b['id']}/deliver", headers=dh).status_code == 400  # OTP first
        cb = c.get(f"/api/customer/bookings/{b['id']}", headers=cust).json()
        assert c.post(f"/api/driver/trips/{b['id']}/verify-delivery", json={"otp": cb["delivery_otp"]}, headers=dh).status_code == 200
        assert c.post(f"/api/driver/trips/{b['id']}/deliver", headers=dh).status_code == 400  # proof photo needed
        png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
        up = c.post(f"/api/driver/trips/{b['id']}/delivery-proof", files={"file": ("p.png", png, "image/png")}, headers=dh)
        assert up.status_code == 200, up.text
        assert c.post(f"/api/driver/trips/{b['id']}/deliver", headers=dh).status_code == 200
        assert c.post(f"/api/driver/trips/{b['id']}/complete", headers=dh).status_code == 200
        # chat closes after completion
        assert c.post(f"/api/chat/{b['id']}/messages", json={"body": "hi"}, headers=cust).status_code == 409
        # wallet math from ledger
        earn = c.get("/api/driver/earnings", headers=dh).json()
        assert round(earn["wallet_balance"]) == round(b["fare"]["total"] * 0.9) and earn["trips_completed"] == 1
        inv = c.get(f"/api/customer/bookings/{b['id']}/invoice", headers=cust)
        assert inv.status_code == 200 and inv.content[:4] == b"%PDF"
        assert c.post(f"/api/customer/bookings/{b['id']}/rate", json={"rating": 5, "tip": 20}, headers=cust).status_code == 200

        # --- payout flow
        assert c.post("/api/driver/withdraw", json={"amount": 100}, headers=dh).status_code == 200
        po = c.get("/api/admin/payouts", headers=ah).json()[0]
        assert c.post(f"/api/admin/payouts/{po['id']}", json={"action": "paid"}, headers=ah).status_code == 400  # needs reference
        assert c.post(f"/api/admin/payouts/{po['id']}", json={"action": "paid", "reference": "UTR123"}, headers=ah).status_code == 200

        # --- COD limit + commission block
        c.put("/api/admin/settings", json={"cod_limit": 2, "cod_bonus_after_online": 0, "auto_assign_test_mode": True}, headers=ah)
        ids = []
        for i in range(2):
            r, _ = book(c, other, "cod")
            assert r.status_code == 200, r.text
            ids.append(r.json()["id"])
        r, _ = book(c, other, "cod")
        assert r.status_code == 400 and "limit" in r.json()["detail"].lower()
        # cancel before assignment frees a COD slot
        pend = [i for i in ids if c.get(f"/api/customer/bookings/{i}", headers=other).json()["status"] == "pending_assignment"]
        # driver has no auto offer? (driver online & free) -> first booking is offered; cancel it anyway
        cx = c.post(f"/api/customer/bookings/{ids[1]}/cancel", json={"reason": "changed plan"}, headers=other)
        assert cx.status_code == 200 and cx.json()["status"] == "cancelled" and cx.json()["fare"]["cancel_fee"] == 0
        r, _ = book(c, other, "cod")
        assert r.status_code == 200

        # --- credit limit enforcement
        assert book(c, cust, "credit")[0].status_code == 400
        assert c.post("/api/customer/credit/request", json={"requested_limit": 3000}, headers=cust).status_code == 200
        acc = c.get("/api/admin/credit", headers=ah).json()[0]
        assert c.post(f"/api/admin/credit/{acc['id']}", json={"action": "approve", "limit": 3000}, headers=ah).json()["available"] == 3000
        r, _ = book(c, cust, "credit")
        assert r.status_code == 200, r.text
        left = c.get("/api/customer/overview", headers=cust).json()["credit"]
        assert left["used"] == r.json()["fare"]["total"] and left["available"] == 3000 - left["used"]
        c.put("/api/admin/settings", json={"auto_assign_test_mode": False}, headers=ah)
        big = c.post("/api/admin/credit/%d" % acc["id"], json={"action": "set_limit", "limit": 10}, headers=ah).json()
        assert book(c, cust, "credit")[0].status_code == 400

        # --- invalid transitions blocked; overview + csv
        assert c.post(f"/api/driver/trips/{b['id']}/reached", headers=dh).status_code in (404, 409)
        ov = c.get("/api/admin/overview", headers=ah).json()
        assert ov["completed"] == 1 and ov["platform_commission"] > 0 and ov["demo_data_present"] is True
        csvr = c.get("/api/admin/reports/bookings.csv", headers=ah)
        assert csvr.status_code == 200 and "code,created" in csvr.text
        # ops admin cannot change settings
        print("ALL JOURNEY CHECKS PASSED")


if __name__ == "__main__":
    test_all()
