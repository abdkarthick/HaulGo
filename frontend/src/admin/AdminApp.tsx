import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { SessionProvider, useSession, useToast } from "../lib/session";
import { api, tokens } from "../lib/api";
import { Field, Loading, Spinner, Warn } from "../components/ui";
import { Logo } from "../components/SvgArt";
import { IcAlert, IcBox, IcBuilding, IcChart, IcChatBubble, IcRadar, IcReceipt, IcSliders, IcTruck, IcWallet } from "../components/Icons";
import { useLiveAlerts } from "../components/Shared";
import { usePoll, money } from "../lib/util";
import { Overview, LiveMap } from "./Overview";
import { Bookings } from "./Bookings";
import { Drivers, Customers } from "./People";
import { Pricing, Payments, Credit } from "./Money";
import { Safety, Communication, Reports } from "./Safety";

export default function AdminApp() {
  return <SessionProvider role="admin"><Root /></SessionProvider>;
}

function Root() {
  const { me, loading } = useSession();
  if (tokens.get("admin") && loading) return <div className="min-h-screen bg-obsidian"><Loading /></div>;
  if (!me || me.role !== "admin") return <AdminLogin />;
  return <Shell />;
}

function AdminLogin() {
  const { setSession } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { const r = await api("admin", "/auth/admin/login", { body: { email, password: pw } }); setSession(r.token, r.user); } catch (er: any) { toast(er.message, "err"); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen bg-obsidian flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-3xl p-7 w-full max-w-sm space-y-4 animate-rise">
        <Logo size={24} /><div><h1 className="text-xl font-extrabold">Admin control centre</h1><p className="text-sm text-steel">Authorised HighCodeX staff only. All actions are audit-logged.</p></div>
        <Field label="Email"><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Password"><input className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
        <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner /> : "Sign in"}</button>
        <button type="button" onClick={() => nav("/")} className="w-full text-xs text-steel font-semibold">← Back to HaulGo</button>
      </form>
    </div>
  );
}

const NAV: [string, string, (p: { size?: number }) => JSX.Element][] = [
  ["/admin", "Overview", IcChart], ["/admin/live", "Live trips", IcRadar], ["/admin/bookings", "Bookings", IcBox], ["/admin/drivers", "Drivers", IcTruck], ["/admin/customers", "Customers", IcBuilding],
  ["/admin/pricing", "Pricing & settings", IcSliders], ["/admin/payments", "Payments & payouts", IcWallet], ["/admin/credit", "Business credit", IcReceipt], ["/admin/safety", "Emergency & safety", IcAlert],
  ["/admin/communication", "Communication", IcChatBubble], ["/admin/reports", "Reports & audit", IcChart],
];

function Shell() {
  const { me, logout } = useSession();
  const nav = useNavigate();
  const ov = usePoll(() => api("admin", "/admin/overview"), 6000);
  useLiveAlerts("admin", true);
  const [menu, setMenu] = useState(false);
  const sos = ov.data?.active_sos || 0;
  return (
    <div className="min-h-screen lg:flex bg-offwhite">
      <aside className={`${menu ? "block" : "hidden"} lg:block fixed lg:sticky top-0 z-[1300] h-screen w-64 shrink-0 bg-obsidian text-white p-4 overflow-y-auto`}>
        <div className="flex items-center justify-between mb-6"><Logo light /><button className="lg:hidden" onClick={() => setMenu(false)} aria-label="Close menu">✕</button></div>
        <nav className="space-y-1" aria-label="Admin">
          {NAV.map(([to, l, Ico]) => (
            <NavLink key={to} to={to} end={to === "/admin"} onClick={() => setMenu(false)} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${isActive ? "bg-white/10 text-white border-l-4 border-brand" : "text-white/60 hover:text-white hover:bg-white/5"}`}>
              <Ico size={19} /><span className="flex-1">{l}</span>
              {l === "Emergency & safety" && sos > 0 && <span className="bg-danger text-white text-[11px] rounded-full px-2 animate-siren">{sos}</span>}
              {l === "Bookings" && ov.data?.awaiting_assignment > 0 && <span className="bg-white/15 text-[11px] rounded-full px-2">{ov.data.awaiting_assignment}</span>}
              {l === "Drivers" && ov.data?.pending_driver_approvals > 0 && <span className="bg-white/15 text-[11px] rounded-full px-2">{ov.data.pending_driver_approvals}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="mt-8 border-t border-white/10 pt-4 text-xs text-white/50"><p className="font-bold text-white/80">{me?.name}</p><p>{me?.email} · {me?.admin_level}</p><button className="mt-3 text-brand font-bold" onClick={() => { logout(); nav("/admin"); }}>Sign out</button></div>
      </aside>
      <div className="flex-1 min-w-0">
        <header className="lg:hidden sticky top-0 z-[1000] bg-obsidian text-white px-4 py-3 flex items-center justify-between"><button onClick={() => setMenu(true)} aria-label="Open menu" className="text-2xl">☰</button><Logo light /><span className="w-6" /></header>
        {sos > 0 && <button onClick={() => nav("/admin/safety")} className="w-full bg-danger text-white text-sm font-extrabold py-2.5 px-4 text-left animate-pulseDot">🚨 {sos} active SOS alert{sos > 1 ? "s" : ""} need attention → open Emergency & Safety Centre</button>}
        <main className="p-4 lg:p-8 max-w-[1400px]">
          <Routes>
            <Route index element={<Overview data={ov.data} />} />
            <Route path="live" element={<LiveMap />} />
            <Route path="bookings" element={<Bookings />} />
            <Route path="drivers" element={<Drivers />} />
            <Route path="customers" element={<Customers />} />
            <Route path="pricing" element={<Pricing />} />
            <Route path="payments" element={<Payments />} />
            <Route path="credit" element={<Credit />} />
            <Route path="safety" element={<Safety />} />
            <Route path="communication" element={<Communication />} />
            <Route path="reports" element={<Reports />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
