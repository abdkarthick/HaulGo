# HAULGO — Moving Industries Forward.
HighCodeX Technologies · industrial goods transport marketplace.

One responsive role-based app (customer / driver), a separate admin dashboard, and one FastAPI backend.

## Run (development)
Backend (port 8000):
```
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt                                                          
python -m uvicorn app.main:app --reload --port 8000
```
Frontend (port 5173, proxies /api to 8000):
```
cd frontend
npm install
npm run dev
```
Open http://localhost:5173 — every new tab starts at the login/landing page.
Admin: http://localhost:5173/admin

Production: `npm run build`, copy `frontend/dist` to `backend/static`, run uvicorn; FastAPI serves the app on one port.

## Default credentials (CHANGE BEFORE GOING LIVE)
- Admin: `admin@highcodex.online` / `Admin@12345` (set `ADMIN_EMAIL`, `ADMIN_PASSWORD` env before first start)
- Demo mode (`DEMO_MODE=1`, default in dev) seeds demo drivers 9000000001–9000000004 and demo customer 9000000100, all flagged "demo". Set `DEMO_MODE=0` in production.
- Dev mode (`DEV_MODE=1`): OTP is returned on screen and labelled "NOT sent by SMS". Set `DEV_MODE=0` once an SMS provider is wired.

## What works without any external account
Full booking journey, server-side fares (OSRM road distance, labelled fallback estimate if OSRM is unreachable), driver offers, OTP pickup/delivery, live GPS tracking, chat, wallet/commission/COD, credit ledger, cancellation fees, admin quotation, invoices (PDF), SOS, complaints, admin dashboard and CSV reports.

## Integrations — honest status
| Feature | Env vars | Without credentials |
|---|---|---|
| Razorpay payments | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | `dev_simulated` mode with a clearly labelled dev-confirm button |
| SMS OTP / alerts (DLT-registered gateway) | `SMS_PROVIDER` + provider keys; implement `send_sms_otp` in `core.py` | logged as `not_configured`; never shown as sent |
| WhatsApp Business API | `WHATSAPP_PROVIDER` + keys | click-to-chat links only; logs `not_configured` |
| Masked calling (Exotel / Knowlarity) | `CALL_PROVIDER` + keys | demo call session, labelled demo |
| Push (FCM) | `FCM_CREDENTIALS` | device tokens stored, push logged `not_configured` |
| AI chatbot + voice assistant | `GEMINI_API_KEY` (free key from Google AI Studio), optional `GEMINI_MODEL` | Basic built-in FAQ answers, labelled "Basic mode" in the chat window |
| Email login + forgot password (6-digit code by email) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | In dev mode the reset code is shown on screen, labelled "NOT emailed"; with `DEV_MODE=0` the reset is refused until SMTP is set |
| Sign in with Google | `GOOGLE_CLIENT_ID` (OAuth web client; add your site URL under Authorised JavaScript origins) | Button shows "not set up yet"; mobile OTP login still works |
| Database | `DATABASE_URL` (PostgreSQL URL) | SQLite file |
| Routing | `OSRM_URL`, `NOMINATIM_URL` | public OSRM/Nominatim (use your own for production load) |

## AI assistant, voice and Google sign-in
- A floating **Ask HaulGo** button (customer, driver and login pages) opens the assistant with two tabs: **Chat** (type or dictate, optional "Read replies aloud") and **Voice** (tap the mic, speak, the answer is spoken back).
- Speech-to-text and text-to-speech use the browser (Chrome / Edge work best) in the selected app language. Voice quality for a language depends on the voices installed on the phone/PC.
- Backend: `POST /api/ai/chat` (Gemini when `GEMINI_API_KEY` is set). It only answers HaulGo questions and sees the logged-in user's last 3 bookings for context.
- Google sign-in: `POST /api/auth/google` verifies the Google ID token and creates/finds the account by Google user id. Google accounts are not auto-merged with existing mobile-number accounts. A new `users.google_sub` column is added automatically on startup.
- Email accounts: the login page has **Mobile OTP / Email** tabs. Email supports create account, sign in and forgot password (`/api/auth/email/register`, `/email/login`, `/password/forgot`, `/password/reset`). Passwords are stored hashed. A mobile account and an email account are separate accounts.
- Keys can be put in `backend/.env` (copy `backend/.env.example`) instead of setting them in the terminal each time. Restart the backend after editing.
- Languages: English, Tamil, Hindi, Telugu, Kannada, Malayalam, Bengali, Marathi.

## Notes
- Test mode: `auto_assign_test_mode` (Admin → Pricing & settings) auto-offers each paid booking to the best driver; admin can still assign/reassign manually. Turn off for production.
- Bookings are allowed from any location unless "Enforce service areas" is switched on.
- Refunds become "completed" only via provider confirmation or an admin-entered provider reference.
- Tips are recorded only. The mobile app is a responsive PWA (Capacitor wrap is a later step).
- Tests: `cd backend && pytest -q`.
