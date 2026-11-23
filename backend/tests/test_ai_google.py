import os
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/t.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def test_ai_chat_basic_mode_and_google_not_configured():
    with TestClient(app) as c:
        cfg = c.get("/api/config").json()
        assert "google_client_id" in cfg and "ai_provider" in cfg
        r = c.post("/api/ai/chat", json={"message": "how does the OTP work?", "lang": "ta"})
        assert r.status_code == 200 and r.json()["reply"]
        assert c.post("/api/auth/google", json={"credential": "x" * 30, "role": "customer"}).status_code in (401, 503)


def test_email_register_login_forgot_reset():
    with TestClient(app) as c:
        reg = {"email": "Test.User@Example.com", "password": "secret123", "name": "Test User", "role": "customer"}
        r = c.post("/api/auth/email/register", json=reg)
        assert r.status_code == 200 and r.json()["user"]["email"] == "test.user@example.com"
        assert c.post("/api/auth/email/register", json=reg).status_code == 409
        assert c.post("/api/auth/email/login", json={"email": "test.user@example.com", "password": "wrong", "role": "customer"}).status_code == 401
        assert c.post("/api/auth/email/login", json={"email": "test.user@example.com", "password": "secret123", "role": "driver"}).status_code == 401
        ok = c.post("/api/auth/email/login", json={"email": "TEST.user@example.com", "password": "secret123", "role": "customer"})
        assert ok.status_code == 200 and c.get("/api/me", headers={"Authorization": "Bearer " + ok.json()["token"]}).json()["name"] == "Test User"
        f = c.post("/api/auth/password/forgot", json={"email": "test.user@example.com", "role": "customer"}).json()
        assert f["dev_code"]
        assert c.post("/api/auth/password/reset", json={"email": "test.user@example.com", "role": "customer", "code": "000000", "new_password": "newpass123"}).status_code == 400
        assert c.post("/api/auth/password/reset", json={"email": "test.user@example.com", "role": "customer", "code": f["dev_code"], "new_password": "newpass123"}).status_code == 200
        assert c.post("/api/auth/email/login", json={"email": "test.user@example.com", "password": "secret123", "role": "customer"}).status_code == 401
        assert c.post("/api/auth/email/login", json={"email": "test.user@example.com", "password": "newpass123", "role": "customer"}).status_code == 200
        # unknown email gets the same answer and no code
        u = c.post("/api/auth/password/forgot", json={"email": "nobody@example.com", "role": "customer"}).json()
        assert u["ok"] and "dev_code" not in u
