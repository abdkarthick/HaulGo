"""HaulGo database models (SQLAlchemy 2.x, SQLite by default, PostgreSQL ready)."""
from datetime import datetime, timezone

from sqlalchemy import (Boolean, Column, DateTime, Float, ForeignKey, Integer,
                        String, Text, UniqueConstraint)
from sqlalchemy.orm import DeclarativeBase, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("phone", "role", name="uq_user_phone_role"),)
    id = Column(Integer, primary_key=True)
    role = Column(String(16), nullable=False, index=True)  # customer | driver | admin
    admin_level = Column(String(16))  # super | ops (admin only)
    phone = Column(String(15), index=True)
    email = Column(String(120), index=True)
    password_hash = Column(String(200))
    google_sub = Column(String(40), index=True)  # Google account id (sign in with Google)
    name = Column(String(120))
    company_name = Column(String(160))
    gstin = Column(String(20))
    contact_person = Column(String(120))
    business_phone = Column(String(15))
    verified = Column(Boolean, default=False)  # business verification (customer)
    status = Column(String(16), default="active")  # active | suspended
    cod_used = Column(Integer, default=0)
    online_trips_done = Column(Integer, default=0)
    is_demo = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)


class OtpCode(Base):
    __tablename__ = "otp_codes"
    id = Column(Integer, primary_key=True)
    phone = Column(String(15), index=True)
    role = Column(String(16))
    code_hash = Column(String(100))
    expires_at = Column(DateTime)
    attempts = Column(Integer, default=0)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)


class PasswordReset(Base):
    __tablename__ = "password_resets"
    id = Column(Integer, primary_key=True)
    email = Column(String(120), index=True)
    role = Column(String(16))
    code_hash = Column(String(100))
    expires_at = Column(DateTime)
    attempts = Column(Integer, default=0)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)


class SavedLocation(Base):
    __tablename__ = "locations"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    label = Column(String(60))
    address = Column(String(300))
    lat = Column(Float)
    lng = Column(Float)


class ServiceArea(Base):
    __tablename__ = "service_areas"
    id = Column(Integer, primary_key=True)
    city = Column(String(80))
    lat = Column(Float)
    lng = Column(Float)
    radius_km = Column(Float, default=50)
    active = Column(Boolean, default=True)


class VehicleType(Base):
    __tablename__ = "vehicle_types"
    id = Column(Integer, primary_key=True)
    key = Column(String(40), unique=True)
    name = Column(String(80))
    description = Column(String(200))
    capacity_kg = Column(Float)
    max_length_cm = Column(Float, default=0)
    base_fare = Column(Float)
    per_km = Column(Float)
    min_fare = Column(Float)
    helper_charge = Column(Float, default=0)
    waiting_per_min = Column(Float, default=0)
    free_wait_min = Column(Integer, default=15)
    special_charge = Column(Float, default=0)
    goods_categories = Column(String(300))  # csv of allowed categories
    avg_speed_kmph = Column(Float, default=35)
    sort = Column(Integer, default=0)
    active = Column(Boolean, default=True)


class Driver(Base):
    __tablename__ = "drivers"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)
    status = Column(String(16), default="pending")  # pending | approved | rejected | blocked
    reject_reason = Column(String(200))
    online = Column(Boolean, default=False)
    lat = Column(Float)
    lng = Column(Float)
    loc_updated_at = Column(DateTime)
    vehicle_type_id = Column(Integer, ForeignKey("vehicle_types.id"))
    reg_no = Column(String(20))
    capacity_kg = Column(Float)
    license_no = Column(String(40))
    rc_no = Column(String(40))
    insurance_no = Column(String(60))
    permit_no = Column(String(60))
    service_city = Column(String(80))
    payout_upi = Column(String(80))
    payout_bank_name = Column(String(80))
    payout_bank_acc = Column(String(30))
    payout_ifsc = Column(String(20))
    daily_target = Column(Float, default=0)
    rating_avg = Column(Float, default=0)
    rating_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=utcnow)
    user = relationship("User")
    vehicle_type = relationship("VehicleType")


class DriverVehicle(Base):
    """A vehicle owned by a driver. Exactly one is active; its fields are mirrored onto the Driver row (legacy columns)."""
    __tablename__ = "driver_vehicles"
    id = Column(Integer, primary_key=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), index=True)
    vehicle_type_id = Column(Integer, ForeignKey("vehicle_types.id"))
    reg_no = Column(String(20))
    capacity_kg = Column(Float)
    rc_no = Column(String(40))
    insurance_no = Column(String(60))
    permit_no = Column(String(60))
    is_active = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)
    vehicle_type = relationship("VehicleType")


class Attachment(Base):
    """Uploaded files: driver docs, goods/pickup/delivery photos, complaint photos, chat images."""
    __tablename__ = "attachments"
    id = Column(Integer, primary_key=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), index=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), index=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), index=True)
    kind = Column(String(30), index=True)  # driver_doc:<type> | goods | pickup_location | pickup_goods | delivery_proof | complaint | chat | vehicle | profile
    ref_id = Column(Integer)  # complaint id etc
    path = Column(String(300))
    mime = Column(String(60))
    doc_status = Column(String(16), default="pending")  # pending | verified | rejected (driver docs)
    doc_note = Column(String(200))
    created_at = Column(DateTime, default=utcnow)


class Booking(Base):
    __tablename__ = "bookings"
    id = Column(Integer, primary_key=True)
    code = Column(String(16), unique=True, index=True)
    customer_id = Column(Integer, ForeignKey("users.id"), index=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), index=True)
    vehicle_type_id = Column(Integer, ForeignKey("vehicle_types.id"))
    status = Column(String(24), index=True)
    booking_mode = Column(String(12), default="instant")  # instant | scheduled
    scheduled_at = Column(DateTime)
    pricing_mode = Column(String(12), default="fixed")  # fixed | quotation
    pickup_address = Column(String(300))
    pickup_lat = Column(Float)
    pickup_lng = Column(Float)
    drop_address = Column(String(300))
    drop_lat = Column(Float)
    drop_lng = Column(Float)
    distance_km = Column(Float)
    distance_source = Column(String(24))  # osrm | fallback_estimate
    route_polyline = Column(Text)  # json [[lat,lng],...]
    # goods
    goods_category = Column(String(40))
    goods_description = Column(String(400))
    quantity = Column(Integer, default=1)
    weight_kg = Column(Float)
    length_cm = Column(Float)
    width_cm = Column(Float)
    height_cm = Column(Float)
    packages = Column(Integer, default=1)
    handling = Column(String(400))
    loading_notes = Column(String(400))
    helper_needed = Column(Boolean, default=False)
    receiver_name = Column(String(120))
    receiver_phone = Column(String(15))
    # pickup assistance
    pickup_landmark = Column(String(300))
    pickup_gate = Column(String(120))
    pickup_floor = Column(String(120))
    pickup_entry = Column(String(300))
    pickup_help_requested_at = Column(DateTime)
    # fare (all server computed)
    fare_base = Column(Float, default=0)
    fare_distance = Column(Float, default=0)
    night_charge = Column(Float, default=0)
    helper_charge = Column(Float, default=0)
    special_charge = Column(Float, default=0)
    waiting_charge = Column(Float, default=0)
    fare_total = Column(Float, default=0)
    commission_pct = Column(Float, default=0)
    commission = Column(Float, default=0)
    driver_share = Column(Float, default=0)
    payment_method = Column(String(10))  # online | cod | credit
    payment_status = Column(String(20), default="unpaid")  # unpaid | paid | cod_pending | cod_collected | credit_billed | refund_pending | refunded
    pickup_otp = Column(String(6))
    delivery_otp = Column(String(6))
    pickup_otp_attempts = Column(Integer, default=0)
    delivery_otp_attempts = Column(Integer, default=0)
    delivery_otp_ok = Column(Boolean, default=False)
    track_token = Column(String(40), unique=True, index=True)
    expires_at = Column(DateTime)  # payment expiry
    cancel_reason = Column(String(300))
    cancelled_by = Column(String(16))
    cancel_fee = Column(Float, default=0)
    created_at = Column(DateTime, default=utcnow)
    assigned_at = Column(DateTime)
    accepted_at = Column(DateTime)
    reached_at = Column(DateTime)
    picked_at = Column(DateTime)
    delivered_at = Column(DateTime)
    completed_at = Column(DateTime)
    rated = Column(Boolean, default=False)
    customer = relationship("User", foreign_keys=[customer_id])
    driver = relationship("Driver", foreign_keys=[driver_id])
    vehicle_type = relationship("VehicleType")


class BookingStatusHistory(Base):
    __tablename__ = "booking_status_history"
    id = Column(Integer, primary_key=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), index=True)
    from_status = Column(String(24))
    to_status = Column(String(24))
    by_user_id = Column(Integer)
    note = Column(String(300))
    at = Column(DateTime, default=utcnow)


class DriverAssignment(Base):
    __tablename__ = "driver_assignments"
    id = Column(Integer, primary_key=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), index=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), index=True)
    status = Column(String(12), default="offered")  # offered | accepted | rejected | timeout | withdrawn
    assigned_by = Column(String(40))  # admin:<id> | auto-test-mode
    offered_at = Column(DateTime, default=utcnow)
    expires_at = Column(DateTime)
    responded_at = Column(DateTime)


class Quotation(Base):
    __tablename__ = "quotations"
    id = Column(Integer, primary_key=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), index=True)
    amount = Column(Float)
    notes = Column(String(500))
    status = Column(String(12), default="sent")  # sent | accepted | rejected | superseded
    created_by = Column(Integer)
    created_at = Column(DateTime, default=utcnow)


class Payment(Base):
    __tablename__ = "payments"
    id = Column(Integer, primary_key=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), index=True)
    method = Column(String(10))
    amount = Column(Float)
    status = Column(String(14), default="created")  # created | captured | failed | refunded
    mode = Column(String(16))  # razorpay_test | razorpay_live | dev_simulated | cod | credit
    provider_order_id = Column(String(60), index=True)
    provider_payment_id = Column(String(60), unique=True)
    signature = Column(String(200))
    created_at = Column(DateTime, default=utcnow)


class Refund(Base):
    __tablename__ = "refunds"
    id = Column(Integer, primary_key=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), index=True)
    payment_id = Column(Integer, ForeignKey("payments.id"))
    amount = Column(Float)
    status = Column(String(12), default="requested")  # requested | processing | completed | failed
    provider_refund_id = Column(String(60))
    reason = Column(String(200))
    note = Column(String(200))
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow)


class WalletTxn(Base):
    """Driver ledger. bucket=wallet -> withdrawable balance. bucket=due -> commission owed to platform.
    bucket=cod_cash -> informational cash collected by driver (not part of balance)."""
    __tablename__ = "driver_wallet_transactions"
    id = Column(Integer, primary_key=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), index=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"))
    bucket = Column(String(10))
    kind = Column(String(24))
    amount = Column(Float)  # signed
    note = Column(String(200))
    created_at = Column(DateTime, default=utcnow)


class Payout(Base):
    __tablename__ = "driver_payouts"
    id = Column(Integer, primary_key=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), index=True)
    amount = Column(Float)
    status = Column(String(10), default="requested")  # requested | approved | paid | rejected
    method = Column(String(40))
    destination = Column(String(120))
    reference = Column(String(80))
    admin_note = Column(String(200))
    created_at = Column(DateTime, default=utcnow)
    processed_at = Column(DateTime)


class CreditAccount(Base):
    __tablename__ = "company_credit_accounts"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)
    status = Column(String(12), default="requested")  # requested | approved | rejected | suspended
    requested_limit = Column(Float, default=0)
    credit_limit = Column(Float, default=0)
    note = Column(String(300))
    created_at = Column(DateTime, default=utcnow)
    user = relationship("User")


class CreditTxn(Base):
    __tablename__ = "company_credit_transactions"
    id = Column(Integer, primary_key=True)
    account_id = Column(Integer, ForeignKey("company_credit_accounts.id"), index=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"))
    kind = Column(String(12))  # charge | reversal | payment | adjustment
    amount = Column(Float)  # charge positive (increases used), payment/reversal negative
    note = Column(String(200))
    created_at = Column(DateTime, default=utcnow)


class Review(Base):
    __tablename__ = "reviews"
    id = Column(Integer, primary_key=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), unique=True)
    from_user_id = Column(Integer)
    driver_id = Column(Integer)
    rating = Column(Integer)
    comment = Column(String(400))
    tip = Column(Float, default=0)  # recorded only; tip is handed directly to the driver
    created_at = Column(DateTime, default=utcnow)


class Complaint(Base):
    __tablename__ = "support_tickets"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"))
    category = Column(String(40))
    description = Column(String(1000))
    status = Column(String(12), default="open")  # open | in_review | resolved | rejected
    admin_response = Column(String(1000))
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow)


class ComplaintEvent(Base):
    __tablename__ = "complaint_events"
    id = Column(Integer, primary_key=True)
    complaint_id = Column(Integer, ForeignKey("support_tickets.id"), index=True)
    actor = Column(String(40))
    status = Column(String(12))
    text = Column(String(1000))
    at = Column(DateTime, default=utcnow)


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    booking_id = Column(Integer)
    kind = Column(String(30))
    title = Column(String(120))
    body = Column(String(400))
    read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)


class NotificationTemplate(Base):
    __tablename__ = "notification_templates"
    id = Column(Integer, primary_key=True)
    event = Column(String(40), unique=True)
    title = Column(String(120))
    body = Column(String(400))
    to_receiver = Column(Boolean, default=False)
    sms = Column(Boolean, default=True)
    whatsapp = Column(Boolean, default=False)
    email = Column(Boolean, default=False)
    enabled = Column(Boolean, default=True)


class NotificationLog(Base):
    __tablename__ = "notification_logs"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer)
    booking_id = Column(Integer)
    event = Column(String(40))
    channel = Column(String(12))  # in_app | sms | whatsapp | email | push
    recipient = Column(String(40))  # masked
    status = Column(String(16))  # delivered_in_app | sent | not_configured | failed | skipped_no_consent
    detail = Column(String(300))
    created_at = Column(DateTime, default=utcnow)


class DeviceToken(Base):
    __tablename__ = "device_tokens"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    token = Column(String(300), unique=True)
    platform = Column(String(12), default="android")
    created_at = Column(DateTime, default=utcnow)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id = Column(Integer, primary_key=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), index=True)
    sender_id = Column(Integer, ForeignKey("users.id"))
    kind = Column(String(10), default="text")  # text | quick | location | image | system
    body = Column(String(600))
    lat = Column(Float)
    lng = Column(Float)
    attachment_id = Column(Integer)
    created_at = Column(DateTime, default=utcnow)
    delivered_at = Column(DateTime)
    read_at = Column(DateTime)


class CallSession(Base):
    __tablename__ = "call_sessions"
    id = Column(Integer, primary_key=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), index=True)
    caller_id = Column(Integer)
    callee_id = Column(Integer)
    provider = Column(String(20))
    provider_call_id = Column(String(60))
    status = Column(String(16))  # demo_not_connected | initiated | connected | failed | ended
    detail = Column(String(200))
    created_at = Column(DateTime, default=utcnow)


class SosAlert(Base):
    __tablename__ = "sos_alerts"
    id = Column(Integer, primary_key=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), index=True)
    raised_by_id = Column(Integer, ForeignKey("users.id"))
    role = Column(String(10))
    lat = Column(Float)
    lng = Column(Float)
    loc_note = Column(String(60))  # live | last_known | none
    note = Column(String(400))
    snapshot = Column(Text)  # json with customer/driver/vehicle details at alert time
    status = Column(String(14), default="active")  # active | acknowledged | resolved
    ack_by = Column(Integer)
    ack_at = Column(DateTime)
    resolved_at = Column(DateTime)
    created_at = Column(DateTime, default=utcnow)


class SosActionLog(Base):
    __tablename__ = "sos_action_logs"
    id = Column(Integer, primary_key=True)
    sos_id = Column(Integer, ForeignKey("sos_alerts.id"), index=True)
    actor_id = Column(Integer)
    action = Column(String(30))
    note = Column(String(400))
    at = Column(DateTime, default=utcnow)


class LocationPing(Base):
    __tablename__ = "location_pings"
    id = Column(Integer, primary_key=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), index=True)
    driver_id = Column(Integer)
    lat = Column(Float)
    lng = Column(Float)
    at = Column(DateTime, default=utcnow)


class Setting(Base):
    __tablename__ = "admin_settings"
    key = Column(String(60), primary_key=True)
    value = Column(Text)  # json


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True)
    actor_id = Column(Integer)
    action = Column(String(60))
    entity = Column(String(30))
    entity_id = Column(Integer)
    detail = Column(String(500))
    at = Column(DateTime, default=utcnow)
