import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, remembered, Role, tokens } from "../lib/api";
import { Field, Spinner, Warn } from "../components/ui";
import { Logo } from "../components/SvgArt";
import { useToast } from "../lib/session";
import { useIntroDone } from "./Intro";
import { useI18n } from "../lib/i18n";
import { LanguageButton, LanguagePicker } from "../components/Language";
import { sendOtpToPhone } from "../services/auth";
import type { ConfirmationResult } from "firebase/auth";

const Assistant = lazy(() => import("../components/Assistant"));
const HeroStage = lazy(() => import("../components/World3D").then((m) => ({ default: m.HeroStage })));

type Cfg = { google_client_id?: string | null; dev_mode: boolean; payment_mode: string; integrations: Record<string, boolean>; support_phone: string };

export default function Welcome() {
  const [role, setRole] = useState<"customer" | "driver">(() => (remembered.role() === "driver" ? "driver" : "customer"));
  const [cfg, setCfg] = useState<Cfg | null>(null);
  // PERF: config ah idle la thaan eduku - LCP ah block panna koodathu
  useEffect(() => {
    const id = setTimeout(() => { api<Cfg>("customer", "/config").then(setCfg).catch(() => {}); }, 800);
    return () => clearTimeout(id);
  }, []);
  const introDone = useIntroDone();
  const { t } = useI18n();
  const [firstRun] = useState(true);
  const [pickerDone, setPickerDone] = useState(false);

  // PERF FIX: Language Picker ah 1200ms delay - LCP element Welcome H1 thaan, Picker illa
  const [showPicker, setShowPicker] = useState(false);
  useEffect(() => {
    if (!introDone) return;
    const id = setTimeout(() => setShowPicker(true), 1200);
    return () => clearTimeout(id);
  }, [introDone]);

  const [show3D, setShow3D] = useState(false);
  useEffect(() => {
    if (!introDone) return;
    let timeoutId: number | undefined;
    const start3D = () => {
      window.removeEventListener("wheel", start3D);
      window.removeEventListener("touchmove", start3D);
      window.removeEventListener("keydown", onKeyDown);
      timeoutId = window.setTimeout(() => setShow3D(true), 1000);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowDown", "PageDown", " ", "End"].includes(event.key)) start3D();
    };
    window.addEventListener("wheel", start3D, { passive: true });
    window.addEventListener("touchmove", start3D, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("wheel", start3D);
      window.removeEventListener("touchmove", start3D);
      window.removeEventListener("keydown", onKeyDown);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [introDone]);

  // PERF FIX: scrollIntoView + querySelector ah thookiten - Forced Reflow pogum
  const pick = (r: "customer" | "driver") => { setRole(r); };

  return (
    <div className="min-h-screen bg-obsidian text-white relative overflow-hidden">
      <div id="recaptcha-container"></div>
      {introDone && showPicker && firstRun && !pickerDone && <LanguagePicker blocking onClose={() => setPickerDone(true)} />}
      {introDone && showPicker && (!firstRun || pickerDone) && (
        <Suspense fallback={null}><Assistant role={role} /></Suspense>
      )}
      {/* PERF: blur-3xl div ah thookiten - ithu thaan CPU ah saapuduthu */}
      <header className="relative z-10 w-full max-w-6xl mx-auto px-5 py-4 flex items-center justify-between">
        <Logo light size={24} />
        <div className="flex items-center gap-3"><LanguageButton light /><Link to="/admin" className="text-xs text-white/50 hover:text-white font-semibold">Admin sign in →</Link></div>
      </header>
      <main className="relative z-10 w-full max-w-6xl mx-auto px-5 pb-4 grid lg:grid-cols-2 gap-10 items-center pt-2 lg:pt-4">
        <section>
          <p className="chip bg-white/10 text-white/80 mb-5">{t("welcome.badge")}</p>
          <h1 className="text-4xl sm:text-6xl font-extrabold leading-[1.02]">{t("welcome.h1a")}<br /><span className="text-brand">{t("welcome.h1b")}</span></h1>
          <p className="mt-3 text-white/85 tracking-[.28em] text-xs sm:text-sm uppercase font-bold">Moving Industries Forward.</p>
          <p className="mt-5 text-white/65 max-w-md leading-relaxed">{t("welcome.desc")}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={() => pick("customer")} className="btn-primary !px-6 !py-3.5">{t("welcome.book")}</button>
            <button onClick={() => pick("driver")} className="inline-flex items-center justify-center rounded-xl border border-white/25 px-6 py-3.5 font-bold text-white hover:bg-white/10 transition">{t("welcome.driver")}</button>
          </div>
        </section>
        <section className="bg-white text-obsidian rounded-3xl p-5 sm:p-7 shadow-2xl">
          <div className="grid grid-cols-2 gap-2 p-1 bg-offwhite rounded-2xl mb-6" role="tablist" aria-label="Choose account type">
            {([["customer", t("tab.customer"), t("tab.customerSub")], ["driver", t("tab.driver"), t("tab.driverSub")]] as const).map(([k, title, s]) => (
              <button key={k} role="tab" aria-selected={role === k} onClick={() => setRole(k)} className={`text-left rounded-xl px-4 py-3 transition ${role === k ? "bg-obsidian text-white shadow" : "text-obsidian/70 hover:bg-white"}`}>
                <span className="block font-extrabold text-sm">{title}</span><span className={`block text-[11px] ${role === k ? "text-white/60" : "text-steel"}`}>{s}</span>
              </button>
            ))}
          </div>
          <Login role={role} cfg={cfg} />
        </section>
      </main>
      <div className="relative">
        {show3D ? (
          <Suspense fallback={<div className="h-[40vh] min-h-[300px]" />}>
            <HeroStage className="h-[40vh] min-h-[300px] w-full" paused={!introDone} />
          </Suspense>
        ) : (
          <div className="h-[40vh] min-h-[300px]" aria-hidden="true" />
        )}
      </div>
      <section className="relative z-10 w-full max-w-6xl mx-auto px-5 py-10">
          <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            {[["Fixed fares or admin quotation", "Heavy and special loads are quoted by our team"], ["OTP pickup and delivery", "Goods change hands only after verification"], ["Private chat and masked calls", "Phone numbers stay hidden"], ["Live GPS tracking", "Shareable receiver tracking link"]].map(([a, b]) => (
              <li key={a} className="rounded-xl bg-white/5 border border-white/10 p-3.5"><p className="font-bold">{a}</p><p className="text-white/50 text-xs mt-0.5">{b}</p></li>
            ))}
          </ul>
      </section>
    </div>
  );
}

function Login({ role, cfg }: { role: "customer" | "driver"; cfg: Cfg | null }) {
  const { t } = useI18n();
  const [method, setMethod] = useState<"mobile" | "email">("mobile");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 p-1 bg-offwhite rounded-xl" role="tablist">
        {(["mobile", "email"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={method === k} onClick={() => setMethod(k)}
            className={`rounded-lg py-2 text-xs font-bold transition ${method === k ? "bg-white shadow text-obsidian" : "text-obsidian/60"}`}>{k === "mobile" ? t("auth.mobileTab") : t("auth.emailTab")}</button>
        ))}
      </div>
      {method === "mobile" ? <MobileLogin role={role} cfg={cfg} /> : <EmailAuth role={role} cfg={cfg} />}
    </div>
  );
}

function MobileLogin({ role, cfg }: { role: "customer" | "driver"; cfg: Cfg | null }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const [phone, setPhone] = useState(remembered.phone(role));
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const confirmationRef = useRef<ConfirmationResult | null>(null);
  useEffect(() => { setPhone(remembered.phone(role)); setStep("phone"); setOtp(""); setIsNew(false); confirmationRef.current = null; }, [role]);
  useEffect(() => { if (left <= 0) return; const id = setTimeout(() => setLeft(left - 1), 1000); return () => clearTimeout(id); }, [left]);

  const request = async () => {
    if (phone.length !== 10) return;
    setBusy(true);
    try {
      // FIREBASE REAL SMS - +91 oda anuppu
      const confirmation = await sendOtpToPhone(`+91${phone}`);
      confirmationRef.current = confirmation;
      // Backend la user iruka nu check panna try pannu, illa na new user ah treat pannu
      try {
        const r = await api("customer", "/auth/otp/request", { body: { phone, role } });
        setIsNew(r.is_new);
      } catch { setIsNew(false); }
      setStep("otp"); setLeft(30);
      toast("OTP sent to your mobile", "ok");
    } catch (e: any) {
      console.error(e);
      toast(e.message || "Failed to send OTP. Try again.", "err");
    } finally { setBusy(false); }
  };

  const verify = async () => {
    if (!confirmationRef.current) { toast("Please request OTP again", "err"); return; }
    setBusy(true);
    try {
      // 1. Firebase la OTP verify pannu
      const result = await confirmationRef.current.confirm(otp);
      const idToken = await result.user.getIdToken();

      // 2. Backend ku Firebase token ah anuppi HaulGo token vaangu
      // Backend la /auth/firebase endpoint illa na, Firebase token ah vechu login pannu
      let haulgoToken = idToken;
      try {
        const r = await api("customer", "/auth/firebase", { body: { idToken, phone, role, name: name || undefined } });
        haulgoToken = r.token;
      } catch { /* backend ready illa na Firebase token eh podhum */ }

      tokens.set(role as Role, haulgoToken);
      remembered.setRole(role); remembered.setPhone(role, phone);
      nav(`/${role}`, { replace: true });
    } catch (e: any) {
      console.error(e);
      toast(e.message || "Invalid OTP", "err");
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); step === "phone" ? request() : verify(); }} className="space-y-4">
      <div>
        <h2 className="text-2xl font-extrabold">{role === "customer" ? t("login.titleC") : t("login.titleD")}</h2>
        <p className="text-sm text-steel mt-1">{role === "customer" ? t("login.subC") : t("login.subD")}</p>
      </div>
      <Field label={t("login.mobile")}>
        <div className="flex gap-2"><span className="input !w-16 text-center bg-offwhite">+91</span>
          <input className="input" inputMode="numeric" autoComplete="tel-national" maxLength={10} placeholder="10-digit number" value={phone} disabled={step === "otp"} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} autoFocus />
        </div>
      </Field>
      {step === "otp" && (
        <>
          {isNew && <Field label={t("login.name")}><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" required /></Field>}
          <Field label={t("login.enterOtp")}><input className="input tracking-[.5em] text-center text-lg font-bold" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} autoFocus /></Field>
          <button type="button" className="text-xs font-semibold text-steel disabled:opacity-50" disabled={left > 0} onClick={request}>{left > 0 ? t("login.resendIn", { n: left }) : t("login.resend")}</button>
        </>
      )}
      <button className="btn-primary w-full !py-3.5 text-base" disabled={busy || phone.length !== 10 || (step === "otp" && (otp.length !== 6 || (isNew && !name.trim())))}>
        {busy ? <Spinner /> : step === "phone" ? t("login.getOtp") : t("login.verify")}
      </button>
      {step === "otp" && <button type="button" className="w-full text-sm text-steel font-semibold" onClick={() => { setStep("phone"); setOtp(""); }}>{t("login.change")}</button>}
      {step === "phone" && (
        <>
          <div className="flex items-center gap-3 text-xs text-steel font-semibold"><span className="flex-1 h-px bg-line" />{t("login.or")}<span className="flex-1 h-px bg-line" /></div>
          <GoogleSignIn role={role} clientId={cfg?.google_client_id || null} />
        </>
      )}
      <p className="text-[11px] text-steel text-center">By continuing you agree to HaulGo's terms. Support: {cfg?.support_phone || "+91 81487 69354"}</p>
    </form>
  );
}

let gsiLoading: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  if ((window as any).google?.accounts?.id) return Promise.resolve();
  if (!gsiLoading) {
    gsiLoading = new Promise<void>((resolve, reject) => {
      const el = document.createElement("script");
      el.src = "https://accounts.google.com/gsi/client";
      el.async = true; el.defer = true;
      el.onload = () => resolve();
      el.onerror = () => { gsiLoading = null; reject(new Error("Could not load Google sign-in")); };
      document.head.appendChild(el);
    });
  }
  return gsiLoading;
}

function GoogleSignIn({ role, clientId }: { role: "customer" | "driver"; clientId: string | null }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const box = useRef<HTMLDivElement>(null);
  const roleRef = useRef(role);
  roleRef.current = role;
  useEffect(() => {
    if (!clientId || !box.current) return;
    let dead = false;
    const id = setTimeout(() => {
      loadGsi().then(() => {
        if (dead || !box.current) return;
        const g = (window as any).google.accounts.id;
        g.initialize({
          client_id: clientId,
          callback: async (resp: { credential: string }) => {
            try {
              const r = await api("customer", "/auth/google", { body: { credential: resp.credential, role: roleRef.current } });
              tokens.set(roleRef.current as Role, r.token);
              remembered.setRole(roleRef.current);
              nav(`/${roleRef.current}`, { replace: true });
            } catch (e: any) { toast(e.message, "err"); }
          },
        });
        box.current.innerHTML = "";
        // PERF FIX: clientWidth ah thookiten - Fixed 320, Forced Reflow illa
        g.renderButton(box.current, { theme: "outline", size: "large", shape: "pill", text: "continue_with", width: 320 });
      }).catch((e) => toast(e.message, "err"));
    }, 1500);
    return () => { dead = true; clearTimeout(id); };
  }, [clientId, nav, toast]);
  if (!clientId) {
    return (
      <button type="button" onClick={() => toast(t("login.googleOff"), "info")} className="w-full rounded-full border border-line bg-white py-3 text-sm font-bold text-obsidian/60 inline-flex items-center justify-center gap-2.5 hover:bg-offwhite transition">
        <GoogleG />{t("login.google")}
      </button>
    );
  }
  return <div ref={box} className="w-full flex justify-center min-h-[44px]" />;
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.800 2.400 30.300 0 24 0 14.600 0 6.500 5.400 2.600 13.200l7.900 6.100C12.400 13.600 17.700 9.500 24 9.500z"/><path fill="#4285F4" d="M46.500 24.500c0-1.600-.1-3.100-.4-4.500H24v9h12.700c-.6 3-2.300 5.500-4.800 7.200l7.600 5.900c4.400-4.100 7-10.100 7-17.600z"/><path fill="#FBBC05" d="M10.500 28.700A14.500 14.500 0 0 1 9.500 24c0-1.600.3-3.200.8-4.700l-7.900-6.100A24 24 0 0 0 0 24c0 3.900.9 7.500 2.600 10.800l7.900-6.100z"/><path fill="#34A853" d="M24 48c6.500 0 11.900-2.100 15.900-5.800l-7.600-5.900c-2.100 1.400-4.900 2.300-8.300 2.300-6.300 0-11.600-4.100-13.500-9.800l-7.900 6.100C6.500 42.600 14.600 48 24 48z"/></svg>
  );
}

function EmailAuth({ role, cfg }: { role: "customer" | "driver"; cfg: Cfg | null }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const [view, setView] = useState<"login" | "register" | "forgot" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setView("login"); setPassword(""); setCode(""); setDevCode(null); }, [role]);
  const finish = (r: { token: string }) => {
    tokens.set(role as Role, r.token);
    remembered.setRole(role);
    nav(`/${role}`, { replace: true });
  };
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); } };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (view === "login") run(async () => finish(await api("customer", "/auth/email/login", { body: { email, password, role } })));
    else if (view === "register") run(async () => finish(await api("customer", "/auth/email/register", { body: { email, password, name, role } })));
    else if (view === "forgot") run(async () => {
      const r = await api("customer", "/auth/password/forgot", { body: { email, role } });
      setDevCode(r.dev_code || null); setCode(""); setPassword(""); setView("reset");
      toast(r.message, "info");
    });
    else run(async () => {
      await api("customer", "/auth/password/reset", { body: { email, role, code, new_password: password } });
      setPassword(""); setCode(""); setDevCode(null); setView("login");
      toast(t("auth.resetDone"), "ok");
    });
  };
  const title = view === "login" ? t("auth.login") : view === "register" ? t("auth.register") : t("auth.forgotTitle");
  const valid = /^\S+@\S+\.\S+$/.test(email) && (view === "forgot" || password.length >= 8) && (view !== "register" || name.trim().length >= 2) && (view !== "reset" || code.length === 6);
  const btn = view === "login" ? t("auth.login") : view === "register" ? t("auth.register") : view === "forgot" ? t("auth.sendCode") : t("auth.resetBtn");
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="text-2xl font-extrabold">{title}</h2>
        {view === "forgot" && <p className="text-sm text-steel mt-1">{t("auth.forgotSub")}</p>}
      </div>
      {view === "register" && <Field label={t("login.name")}><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></Field>}
      <Field label={t("auth.email")}><input className="input" type="email" inputMode="email" autoComplete="email" value={email} disabled={view === "reset"} onChange={(e) => setEmail(e.target.value.trim())} autoFocus /></Field>
      {view === "reset" && (
        <>
          {devCode && <Warn>DEV MODE · Email is not configured, so the code is shown here and was <b>not emailed</b>. Your code: <b className="text-base tracking-widest">{devCode}</b></Warn>}
          <Field label={t("auth.codeLabel")}><input className="input tracking-[.5em] text-center text-lg font-bold" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></Field>
        </>
      )}
      {view !== "forgot" && (
        <Field label={view === "reset" ? t("auth.newPassword") : t("auth.password")}>
          <input className="input" type="password" autoComplete={view === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
          {view !== "login" && <span className="block text-[11px] text-steel mt-1">{t("auth.passHint")}</span>}
        </Field>
      )}
      <button className="btn-primary w-full !py-3.5 text-base" disabled={busy || !valid}>{busy ? <Spinner /> : btn}</button>
      {view === "login" && (
        <div className="flex justify-between text-sm font-semibold">
          <button type="button" className="text-brand" onClick={() => setView("forgot")}>{t("auth.forgot")}</button>
          <button type="button" className="text-steel" onClick={() => setView("register")}>{t("auth.noAccount")}</button>
        </div>
      )}
      {view === "register" && <button type="button" className="w-full text-sm text-steel font-semibold" onClick={() => setView("login")}>{t("auth.haveAccount")}</button>}
      {(view === "forgot" || view === "reset") && <button type="button" className="w-full text-sm text-steel font-semibold" onClick={() => { setView("login"); setDevCode(null); }}>{t("auth.backLogin")}</button>}
      {(view === "login" || view === "register") && (
        <>
          <div className="flex items-center gap-3 text-xs text-steel font-semibold"><span className="flex-1 h-px bg-line" />{t("login.or")}<span className="flex-1 h-px bg-line" /></div>
          <GoogleSignIn role={role} clientId={cfg?.google_client_id || null} />
        </>
      )}
      <p className="text-[11px] text-steel text-center">By continuing you agree to HaulGo's terms. Support: {cfg?.support_phone || "+91 81487 69354"}</p>
    </form>
  );
}