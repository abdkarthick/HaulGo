# ---- MSG91 OTP login (frontend la OTP verify aana aprom inga token vaangum) ----
class FirebaseLogin(BaseModel):
    phone: str | None = None
    role: str = "customer"
    name: str | None = None
    idToken: str | None = None
    token: str | None = None
    accessToken: str | None = None
    firebaseToken: str | None = None

    class Config:
        extra = "allow"

@router.post("/auth/firebase")
def firebase_login(body: FirebaseLogin, db: Session = Depends(get_db)):
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