"""Idempotent seed: admin account, vehicle categories, notification templates, and (DEMO_MODE only) clearly marked demo accounts."""
from . import models as m
from .core import ADMIN_EMAIL, ADMIN_PASSWORD, DEMO_MODE, hash_pw, seed_templates

VEHICLES = [
    dict(key="scooty", name="Scooty (Delivery)", description="Two-wheeler scooter for documents, parcels and very light loads", capacity_kg=20, max_length_cm=50, base_fare=30, per_km=7, min_fare=45, helper_charge=0, waiting_per_min=1, special_charge=0, avg_speed_kmph=28, sort=1,
         goods_categories="finished_products,packaging_materials,general_commercial"),
    dict(key="bike", name="Bike (Delivery)", description="Motorbike for small boxes, spares and urgent light deliveries", capacity_kg=50, max_length_cm=70, base_fare=35, per_km=9, min_fare=55, helper_charge=0, waiting_per_min=1, special_charge=0, avg_speed_kmph=30, sort=2,
         goods_categories="finished_products,industrial_components,packaging_materials,general_commercial"),
    dict(key="auto", name="Auto (Cargo)", description="Three-wheeler cargo auto for small loads inside the city", capacity_kg=500, max_length_cm=150, base_fare=120, per_km=14, min_fare=160, helper_charge=150, waiting_per_min=1.5, special_charge=200, avg_speed_kmph=28, sort=3,
         goods_categories="raw_materials,finished_products,industrial_components,packaging_materials,general_commercial"),
    dict(key="mini_truck", name="Mini Truck (Tata Ace)", description="Compact goods carrier for small loads and local runs", capacity_kg=750, max_length_cm=240, base_fare=250, per_km=18, min_fare=300, helper_charge=250, waiting_per_min=2, special_charge=300, avg_speed_kmph=30, sort=1,
         goods_categories="raw_materials,finished_products,industrial_components,packaging_materials,general_commercial"),
    dict(key="pickup", name="Pickup Truck", description="Open pickup for medium loads, components and equipment", capacity_kg=1500, max_length_cm=300, base_fare=400, per_km=22, min_fare=500, helper_charge=300, waiting_per_min=3, special_charge=400, avg_speed_kmph=35, sort=2,
         goods_categories="raw_materials,finished_products,industrial_components,equipment,packaging_materials,general_commercial"),
    dict(key="medium_truck", name="Medium Goods Truck", description="14 ft truck for pallets, machinery parts and bulk goods", capacity_kg=4000, max_length_cm=430, base_fare=900, per_km=32, min_fare=1100, helper_charge=450, waiting_per_min=4, special_charge=800, avg_speed_kmph=40, sort=3,
         goods_categories="raw_materials,finished_products,industrial_components,machinery,equipment,packaging_materials,general_commercial"),
    dict(key="heavy_truck", name="Heavy Goods Truck", description="Large truck for heavy industrial loads and long haul", capacity_kg=9000, max_length_cm=600, base_fare=1800, per_km=48, min_fare=2400, helper_charge=700, waiting_per_min=6, special_charge=1500, avg_speed_kmph=45, sort=4,
         goods_categories="raw_materials,finished_products,industrial_components,machinery,equipment,packaging_materials,general_commercial"),
    dict(key="trailer", name="Trailer / Container (16T)", description="Heavy haulage for machinery and large consignments", capacity_kg=16000, max_length_cm=1000, base_fare=3500, per_km=65, min_fare=5000, helper_charge=900, waiting_per_min=8, special_charge=2500, avg_speed_kmph=45, sort=5,
         goods_categories="raw_materials,finished_products,industrial_components,machinery,equipment,packaging_materials"),
]

# Demo drivers around Chennai (Pattabiram / Ambattur / Avadi). Only created when DEMO_MODE=1 and flagged is_demo.
DEMO_DRIVERS = [
    ("9000000001", "Demo Driver Murugan", "mini_truck", "TN09DM0001", 750, 13.1180, 80.0980),
    ("9000000002", "Demo Driver Selvam", "pickup", "TN09DM0002", 1500, 13.1050, 80.1100),
    ("9000000003", "Demo Driver Raja", "medium_truck", "TN09DM0003", 4000, 13.1230, 80.0700),
    ("9000000004", "Demo Driver Kumar", "heavy_truck", "TN09DM0004", 9000, 13.0900, 80.1300),
    ("9000000005", "Demo Rider Scooty", "scooty", "TN09DM0005", 20, 13.1120, 80.0900),
    ("9000000006", "Demo Rider Bike", "bike", "TN09DM0006", 50, 13.1010, 80.1050),
    ("9000000007", "Demo Driver Auto", "auto", "TN09DM0007", 500, 13.1150, 80.1150),
]


def seed(db):
    if not db.query(m.User).filter_by(role="admin").first():
        db.add(m.User(role="admin", admin_level="super", email=ADMIN_EMAIL.lower(), password_hash=hash_pw(ADMIN_PASSWORD), name="HaulGo Admin", status="active"))
    have = {v.key for v in db.query(m.VehicleType)}
    added = False
    for v in VEHICLES:
        if v["key"] not in have:
            db.add(m.VehicleType(**v))
            added = True
    if added:
        db.flush()
        for i, vt in enumerate(sorted(db.query(m.VehicleType).all(), key=lambda x: x.capacity_kg or 0), start=1):
            vt.sort = i
    if not db.query(m.ServiceArea).count():
        db.add(m.ServiceArea(city="Chennai", lat=13.0827, lng=80.2707, radius_km=60, active=True))
    seed_templates(db)
    db.flush()
    if DEMO_MODE:
        first_run = not db.query(m.User).filter_by(is_demo=True).count()
        vts = {v.key: v for v in db.query(m.VehicleType)}
        for phone, name, vk, reg, cap, lat, lng in DEMO_DRIVERS:
            if db.query(m.User).filter_by(phone=phone).first():
                continue
            u = m.User(role="driver", phone=phone, name=name, is_demo=True)
            db.add(u)
            db.flush()
            db.add(m.Driver(user_id=u.id, status="approved", online=False, vehicle_type_id=vts[vk].id, reg_no=reg, capacity_kg=cap, license_no="DEMO-DL-" + phone[-4:],
                            rc_no="DEMO-RC", service_city="Chennai", lat=lat, lng=lng, payout_upi=f"demo{phone[-1]}@upi"))
        if first_run:
            db.add(m.User(role="customer", phone="9000000100", name="Demo Customer", company_name="Demo Industries Pvt Ltd", gstin="33AAAAA0000A1Z5", contact_person="Demo Customer", is_demo=True, verified=True))
    db.commit()
