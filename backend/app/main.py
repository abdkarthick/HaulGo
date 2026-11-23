import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import models as m
from .core import BASE_DIR, SessionLocal, engine
from sqlalchemy import inspect, text

from .routers import admin, ai, comms, common, customer, driver
from .seed import seed
from .services import expire_offers

log = logging.getLogger("haulgo")

async def _housekeeping():
    while True:
        await asyncio.sleep(5)
        try:
            with SessionLocal() as db:
                expire_offers(db)
        except Exception:  # noqa
            log.exception("housekeeping failed")

def _add_missing_columns():
    """Existing databases: add the google_sub column used by Sign in with Google (create_all does not alter tables)."""
    cols = {c["name"] for c in inspect(engine).get_columns("users")}
    if "google_sub" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN google_sub VARCHAR(40)"))

@asynccontextmanager
async def lifespan(app: FastAPI):
    m.Base.metadata.create_all(engine)
    _add_missing_columns()
    with SessionLocal() as db:
        seed(db)
        for d in db.query(m.Driver).filter(m.Driver.vehicle_type_id.isnot(None), m.Driver.reg_no.isnot(None)).all():  # older drivers: one vehicle row
            if not db.query(m.DriverVehicle).filter_by(driver_id=d.id).count():
                db.add(m.DriverVehicle(driver_id=d.id, vehicle_type_id=d.vehicle_type_id, reg_no=d.reg_no, capacity_kg=d.capacity_kg, rc_no=d.rc_no,
                                       insurance_no=d.insurance_no, permit_no=d.permit_no, is_active=True))
        db.commit()
    task = asyncio.create_task(_housekeeping())
    yield
    task.cancel()

app = FastAPI(title="HaulGo API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://haulgo.highcodex.online",
        "https://haul-go.vercel.app",
        "https://www.haul-go.vercel.app",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

for r in (common.router, customer.router, customer.webhook_router, driver.router, comms.router, ai.router, admin.router):
    app.include_router(r, prefix="/api")

# Serve the built React app (frontend/dist copied to backend/static) in production
STATIC = BASE_DIR / "static"
if STATIC.exists():
    app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = STATIC / path
        return FileResponse(f if f.is_file() else STATIC / "index.html")