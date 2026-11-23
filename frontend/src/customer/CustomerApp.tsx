import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { SessionProvider, useSession, useToast } from "../lib/session";
import { api, tokens } from "../lib/api";
import { fmtDate, km, money, soundPrefs, usePoll } from "../lib/util";
import { Chip, Field, Loading, Row, Sheet, Spinner, StatusBadge, Switch, Warn } from "../components/ui";
import { EmptyArt, Logo } from "../components/SvgArt";
import MapView from "../components/MapView";
import { ComplaintCenter, NotificationCenter, useLiveAlerts } from "../components/Shared";
import { VehicleViewer } from "../components/Truck3D";
import { IcArrow, IcBell, IcBolt, IcBox, IcCalendar, IcCheck, IcHome, IcPin, IcReceipt, IcRepeat, IcShield, IcTruck, IcUser } from "../components/Icons";
import { LanguageButton } from "../components/Language";
import Assistant from "../components/Assistant";
import { useI18n, Key } from "../lib/i18n";
import Book from "./Book";
import TripDetail from "./TripDetail";

export default function CustomerApp() {
  return <SessionProvider role="customer"><Guard /></SessionProvider>;
}

function Guard() {
  const { me, loading } = useSession();
  if (!tokens.get("customer")) return <Navigate to="/" replace />;
  if (loading) return <div className="min-h-screen bg-obsidian"><Loading /></div>;
  if (!me) return <Navigate to="/" replace />;
  return <Shell />;
}

function Shell() {
  const { me, logout } = useSession();
  const { t } = useI18n();
  const nav = useNavigate();
  const [bell, setBell] = useState(false);
  const { unread, chatUnread } = useLiveAlerts("customer", true);
  const items = [["/customer", t("nav.home"), IcHome, true], ["/customer/book", t("nav.book"), IcTruck, false], ["/customer/trips", t("nav.trips"), IcBox, false], ["/customer/account", t("nav.account"), IcUser, false]] as const;
  return (
    <div className="min-h-screen max-w-2xl mx-auto bg-offwhite">
      <header className="sticky top-0 z-[1000] bg-offwhite/90 backdrop-blur px-4 py-3 flex items-center justify-between border-b border-line/60">
        <Link to="/customer"><Logo /></Link>
        <div className="flex items-center gap-2">
          <LanguageButton />
          <button onClick={() => setBell(true)} className="relative w-10 h-10 rounded-full bg-white border border-line flex items-center justify-center" aria-label="Notifications"><IcBell size={19} />{unread > 0 && <span className="absolute -top-1 -right-1 bg-brand text-white text-[10px] min-w-4 h-4 rounded-full px-1 flex items-center justify-center">{unread}</span>}</button>
          <button onClick={() => nav("/customer/account")} className="w-10 h-10 rounded-full bg-obsidian text-white font-extrabold" aria-label="Account">{(me?.name || "U")[0].toUpperCase()}</button>
        </div>
      </header>
      <main className="px-4 py-4 pb-28">
        <Routes>
          <Route index element={<Home />} />
          <Route path="book" element={<Book />} />
          <Route path="trips" element={<Trips />} />
          <Route path="trips/:id" element={<TripDetail chatUnread={chatUnread.bookings} />} />
          <Route path="account" element={<Account onLogout={() => { logout(); nav("/", { replace: true }); }} />} />
          <Route path="*" element={<Navigate to="/customer" replace />} />
        </Routes>
      </main>
      <nav className="fixed bottom-0 left-0 right-0 z-[1100] bg-white/95 backdrop-blur border-t border-line safe-b" aria-label="Main">
        <div className="max-w-2xl mx-auto flex px-2">
          {items.map(([to, l, Ic, end]) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `relative flex-1 flex flex-col items-center gap-1 pt-3 pb-2.5 text-[11px] font-bold transition ${isActive ? "text-brand" : "text-steel"}`}>
              {({ isActive }) => (<>{isActive && <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-brand" />}<Ic size={22} />{l}</>)}
            </NavLink>
          ))}
        </div>
      </nav>
      {bell && <NotificationCenter role="customer" onClose={() => setBell(false)} />}
      <Assistant role="customer" />
    </div>
  );
}

function TripCard({ b }: { b: any }) {
  return (
    <Link to={`/customer/trips/${b.id}`} className="card p-4 block hover:shadow-lg transition">
      <div className="flex justify-between items-start"><div><p className="font-extrabold">{b.code}</p><p className="text-xs text-steel">{fmtDate(b.created_at)} · {b.vehicle_type?.name}</p></div><StatusBadge s={b.status} /></div>
      <p className="text-sm mt-2 truncate">{b.pickup_address}</p><p className="text-sm text-steel truncate">→ {b.drop_address}</p>
      <div className="flex justify-between mt-2 text-sm"><span className="text-steel">{km(b.distance_km)}</span><span className="font-extrabold">{b.fare.total ? money(b.fare.total) : "Quotation"}</span></div>
    </Link>
  );
}

const DONE = ["completed", "cancelled", "refunded", "refund_pending"];
const shortName = (n: string) => n.split("(")[0].trim();
const capLabel = (kg: number) => (kg >= 1000 ? `${+(kg / 1000).toFixed(1)} t` : `${kg} kg`);
const place = (a: string) => { const p = (a || "").split(",").map((x) => x.trim()).filter(Boolean); return p[0] && p[0].length < 4 && p[1] ? p[1] : p[0] || "—"; };
const greeting = (h: number): "greet.morning" | "greet.afternoon" | "greet.evening" => (h < 12 ? "greet.morning" : h < 17 ? "greet.afternoon" : "greet.evening");

/** Vehicle picker with a live 3D preview and a weight slider that recommends the smallest vehicle that fits. */
function VehicleAdvisor() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [types, setTypes] = useState<any[]>([]);
  const [p, setP] = useState(30);
  const [manual, setManual] = useState<number | null>(null);
  useEffect(() => { api<any[]>("customer", "/vehicle-types").then((r) => setTypes([...r].sort((a, b) => a.capacity_kg - b.capacity_kg))).catch(() => {}); }, []);
  const maxCap = types.length ? types[types.length - 1].capacity_kg : 0;
  const top = maxCap * 1.25;
  const w = useMemo(() => { if (!maxCap) return 0; const lo = 10, raw = lo * Math.pow(top / lo, p / 100); return raw < 100 ? Math.max(Math.round(raw / 5) * 5, 5) : raw < 1000 ? Math.round(raw / 10) * 10 : Math.round(raw / 50) * 50; }, [p, top, maxCap]);
  const fit = types.find((v) => v.capacity_kg >= w);
  const heavy = !!maxCap && !fit;
  const sel = types.find((v) => v.id === manual) || fit || types[types.length - 1];
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = rail.current?.querySelector<HTMLElement>('[aria-pressed="true"]'); if (el && rail.current) rail.current.scrollTo({ left: Math.max(el.offsetLeft - 20, 0), behavior: "smooth" }); }, [sel?.id]);
  if (!types.length || !sel) return null;
  return (
    <section className="rounded-3xl bg-graphite text-white overflow-hidden shadow-card">
      <div className="px-5 pt-5 flex items-start justify-between gap-3">
        <div><h2 className="text-lg font-extrabold">{t("home.vehicles")}</h2><p className="text-xs text-white/60 mt-0.5 max-w-[16rem]">{t("home.vehiclesSub")}</p></div>
        {!manual && !heavy && <span className="chip bg-brand text-white whitespace-nowrap shrink-0">{t("home.best")}</span>}
      </div>
      <VehicleViewer kind={sel.key} className="h-52 sm:h-60" />
      <div className="px-5 -mt-1 mb-4">
        <p className="font-extrabold leading-tight">{shortName(sel.name)}</p>
        <p className="text-xs text-white/60">{t("home.upTo", { n: capLabel(sel.capacity_kg) })} · {t("home.rate", { x: sel.per_km })}</p>
      </div>
      <div className="px-5 pb-5 space-y-4">
        <div>
          <div className="flex items-baseline justify-between"><span className="text-xs font-bold uppercase tracking-wide text-white/60">{t("home.weight")}</span><span className="text-xl font-extrabold">{capLabel(w)}</span></div>
          <input type="range" min={0} max={100} value={p} onChange={(e) => { setP(Number(e.target.value)); setManual(null); }} aria-label={t("home.weight")} className="w-full mt-2 accent-[#A8651A]" />
          {heavy && <p className="text-xs text-amber-300 mt-1">{t("home.heavy")}</p>}
        </div>
        <div ref={rail} className="relative flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
          {types.map((v) => (
            <button key={v.id} onClick={() => setManual(v.id)} aria-pressed={sel.id === v.id}
              className={`shrink-0 rounded-xl px-3.5 py-2 text-left border transition ${sel.id === v.id ? "bg-white text-obsidian border-white" : "border-white/15 text-white/80 hover:bg-white/10"}`}>
              <span className="block text-xs font-extrabold whitespace-nowrap">{shortName(v.name)}</span>
              <span className={`block text-[11px] ${sel.id === v.id ? "text-steel" : "text-white/50"}`}>{capLabel(v.capacity_kg)}</span>
            </button>
          ))}
        </div>
        <button className="btn-primary w-full !py-3.5" onClick={() => nav("/customer/book", { state: { vehicle: sel.id, weight: w > 0 ? Math.min(w, sel.capacity_kg) : undefined } })}>{t("home.bookThis")}<IcArrow size={18} /></button>
      </div>
    </section>
  );
}

function Home() {
  const { me } = useSession();
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const trips = usePoll(() => api<any[]>("customer", "/customer/bookings"), 6000);
  const ov = usePoll(() => api("customer", "/customer/overview"), 20000);
  const places = usePoll(() => api<any[]>("customer", "/locations"), 60000);
  const [busyId, setBusyId] = useState<number | null>(null);
  const all = trips.data || [];
  const active = all.filter((x) => !DONE.includes(x.status));
  const firstActive = active.find((a) => a.driver?.lat != null);
  const again = useMemo(() => {
    const seen = new Set<string>(); const out: any[] = [];
    for (const x of all) { if (x.status !== "completed") continue; const k = `${x.pickup_address}|${x.drop_address}`; if (seen.has(k)) continue; seen.add(k); out.push(x); if (out.length === 3) break; }
    return out;
  }, [all]);
  const rebook = async (b: any) => { setBusyId(b.id); try { const r = await api("customer", `/customer/bookings/${b.id}/rebook`); nav("/customer/book", { state: { rebook: r } }); } catch (e: any) { toast(e.message, "err"); } finally { setBusyId(null); } };
  const credit = ov.data?.credit?.status === "approved" ? money(ov.data.credit.available) : "—";
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div><p className="text-steel text-sm font-medium">{t(greeting(new Date().getHours()))}</p>
          <h1 className="text-[28px] leading-tight font-extrabold flex items-center gap-2">{me?.company_name || me?.name}{me?.verified && <span title={t("home.verified")} className="w-6 h-6 rounded-full bg-brand text-white inline-flex items-center justify-center"><IcCheck size={14} /></span>}</h1></div>
      </div>

      <section className="relative rounded-3xl bg-obsidian text-white p-5 overflow-hidden shadow-card">
        <div className="pointer-events-none absolute -top-24 -right-20 w-72 h-72 rounded-full opacity-30 blur-3xl" style={{ background: "radial-gradient(circle,#A8651A,transparent 70%)" }} />
        <div className="relative">
          <h2 className="text-xl font-extrabold">{t("home.heroTitle")}</h2>
          <p className="text-sm text-white/60 mt-1">{t("home.heroSub")}</p>
          <Link to="/customer/book" className="mt-4 flex gap-3 rounded-2xl bg-white/[.07] border border-white/10 p-3.5 hover:bg-white/[.1] transition">
            <span className="flex flex-col items-center pt-1.5" aria-hidden="true"><span className="w-2.5 h-2.5 rounded-full bg-brand" /><span className="w-px flex-1 my-1 bg-white/25" /><span className="w-2.5 h-2.5 rounded-[3px] bg-white" /></span>
            <span className="flex-1 min-w-0 divide-y divide-white/10">
              <span className="flex items-center justify-between py-3"><span className="font-semibold text-white/90">{t("home.from")}</span><IcPin size={18} className="text-white/40" /></span>
              <span className="flex items-center justify-between py-3"><span className="font-semibold text-white/90">{t("home.to")}</span><IcArrow size={18} className="text-white/40" /></span>
            </span>
          </Link>
          {!!places.data?.length && (
            <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar -mx-1 px-1">
              {places.data.slice(0, 6).map((l) => (
                <button key={l.id} onClick={() => nav("/customer/book", { state: { pickup: { address: l.address, lat: l.lat, lng: l.lng } } })} className="shrink-0 rounded-full bg-white/10 border border-white/10 px-3.5 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 hover:bg-white/20 transition"><IcPin size={14} />{l.label}</button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Link to="/customer/book" state={{ mode: "instant" }} className="rounded-xl bg-brand py-3 text-sm font-extrabold inline-flex items-center justify-center gap-2 hover:bg-brand-dark transition active:scale-[.98]"><IcBolt size={17} />{t("home.instant")}</Link>
            <Link to="/customer/book" state={{ mode: "scheduled" }} className="rounded-xl bg-white/10 border border-white/10 py-3 text-sm font-extrabold inline-flex items-center justify-center gap-2 hover:bg-white/15 transition active:scale-[.98]"><IcCalendar size={17} />{t("home.scheduled")}</Link>
          </div>
          <div className="grid grid-cols-3 mt-5 pt-4 border-t border-white/10 text-center">
            {[[t("home.statActive"), ov.data?.active_trips ?? "–"], [t("home.statCod"), ov.data ? `${ov.data.cod.remaining}/${ov.data.cod.limit}` : "–"], [t("home.statCredit"), credit]].map(([l, v], i) => (
              <div key={i} className={i ? "border-l border-white/10" : ""}><p className="text-lg font-extrabold">{v}</p><p className="text-[11px] text-white/50 font-semibold uppercase tracking-wide">{l}</p></div>
            ))}
          </div>
        </div>
      </section>

      <VehicleAdvisor />

      {firstActive && (
        <section className="card overflow-hidden">
          <div className="px-4 pt-3.5 pb-3 flex items-center justify-between"><p className="font-extrabold flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-brand animate-pulseDot" />{t("home.live")} · {firstActive.code}</p><StatusBadge s={firstActive.status} /></div>
          <MapView height={190} pickup={{ lat: firstActive.pickup_lat, lng: firstActive.pickup_lng }} drop={{ lat: firstActive.drop_lat, lng: firstActive.drop_lng }} driver={{ lat: firstActive.driver.lat, lng: firstActive.driver.lng }} driverStale={firstActive.driver.location_stale} />
        </section>
      )}

      <section>
        <div className="flex justify-between items-center mb-2.5"><h2 className="font-extrabold text-lg">{t("home.active")}</h2>{active.length > 0 && <Chip tone="red">{active.length}</Chip>}</div>
        {trips.loading ? <Loading /> : active.length ? <div className="space-y-3">{active.map((x) => <TripCard key={x.id} b={x} />)}</div> : <div className="card"><EmptyArt title={t("home.none")} hint={t("home.noneHint")} /></div>}
      </section>

      {again.length > 0 && (
        <section>
          <div className="mb-2.5"><h2 className="font-extrabold text-lg">{t("home.again")}</h2><p className="text-xs text-steel">{t("home.againSub")}</p></div>
          <div className="space-y-2.5">
            {again.map((x) => (
              <button key={x.id} onClick={() => rebook(x)} disabled={busyId === x.id} className="card w-full p-3.5 flex items-center gap-3 text-left hover:shadow-lg transition disabled:opacity-60">
                <span className="w-10 h-10 shrink-0 rounded-xl bg-offwhite text-brand flex items-center justify-center">{busyId === x.id ? <Spinner /> : <IcRepeat size={20} />}</span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold truncate">{place(x.pickup_address)} → {place(x.drop_address)}</span><span className="block text-xs text-steel">{shortName(x.vehicle_type?.name || "")} · {km(x.distance_km)}</span></span>
                <IcArrow size={18} className="text-steel" />
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-3 gap-2 pt-1">
        {[[IcShield, t("trust.otp")], [IcPin, t("trust.gps")], [IcReceipt, t("trust.gst")]].map(([Ic, l]: any, i) => (
          <div key={i} className="flex flex-col items-center text-center gap-1.5 px-1"><span className="w-9 h-9 rounded-full bg-white border border-line flex items-center justify-center text-obsidian"><Ic size={18} /></span><span className="text-[11px] font-semibold text-steel leading-tight">{l}</span></div>
        ))}
      </div>
    </div>
  );
}

function Trips() {
  const { t } = useI18n();
  const trips = usePoll(() => api<any[]>("customer", "/customer/bookings"), 8000);
  const [f, setF] = useState<"all" | "current" | "scheduled" | "completed" | "cancelled">("all");
  const list = (trips.data || []).filter((t) => f === "all" || (f === "current" && !["completed", "cancelled", "refunded", "refund_pending"].includes(t.status) && t.booking_mode !== "scheduled") || (f === "scheduled" && t.booking_mode === "scheduled" && !["completed", "cancelled", "refunded", "refund_pending"].includes(t.status)) || (f === "completed" && t.status === "completed") || (f === "cancelled" && ["cancelled", "refunded", "refund_pending"].includes(t.status)));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">{t("c.trips")}</h1>
      <div className="flex gap-2 overflow-x-auto no-scrollbar">{(["all", "current", "scheduled", "completed", "cancelled"] as const).map((k) => <button key={k} onClick={() => setF(k)} className={`chip !text-xs !px-3.5 !py-2 capitalize ${f === k ? "bg-obsidian text-white" : "bg-white border border-line"}`}>{t(`f.${k}` as Key)}</button>)}</div>
      {trips.loading ? <Loading /> : list.length ? <div className="space-y-3">{list.map((t) => <TripCard key={t.id} b={t} />)}</div> : <div className="card"><EmptyArt title={t("f.empty")} /></div>}
    </div>
  );
}

function Account({ onLogout }: { onLogout: () => void }) {
  const { t } = useI18n();
  const { me, refresh } = useSession();
  const toast = useToast();
  const [f, setF] = useState<any>({ name: me?.name || "", company_name: me?.company_name || "", gstin: me?.gstin || "", contact_person: me?.contact_person || "", business_phone: me?.business_phone || "", email: me?.email || "" });
  const [busy, setBusy] = useState(false);
  const locs = usePoll(() => api<any[]>("customer", "/locations"), 60000);
  const ov = usePoll(() => api("customer", "/customer/overview"), 30000);
  const stmt = usePoll(() => api("customer", "/customer/credit/statement"), 30000);
  const [newLoc, setNewLoc] = useState({ label: "", q: "", lat: 0, lng: 0 });
  const [res, setRes] = useState<any[]>([]);
  const [credit, setCredit] = useState(false);
  const [limit, setLimit] = useState("");
  const [help, setHelp] = useState(false);
  const [snd, setSnd] = useState(soundPrefs.get());
  const [cfg, setCfg] = useState<any>(null);
  useEffect(() => { api("customer", "/config").then(setCfg).catch(() => {}); }, []);
  const save = async () => { setBusy(true); try { await api("customer", "/me", { method: "PUT", body: Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "")) }); await refresh(); toast(t("ts.profileSaved"), "ok"); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); } };
  const searchLoc = async (q: string) => { setNewLoc((x) => ({ ...x, q })); if (q.length >= 3) { try { setRes((await api("customer", "/geo/search", { query: { q } })).results); } catch { /* */ } } else setRes([]); };
  const addLoc = async () => { try { await api("customer", "/locations", { body: { label: newLoc.label, address: newLoc.q, lat: newLoc.lat, lng: newLoc.lng } }); setNewLoc({ label: "", q: "", lat: 0, lng: 0 }); locs.reload(); } catch (e: any) { toast(e.message, "err"); } };
  const cs = ov.data?.credit;
  return (
    <div className="space-y-5 pb-6">
      <h1 className="text-2xl font-extrabold">{t("c.account")}</h1>
      <div className="card p-4 flex items-center justify-between"><span className="font-extrabold">{t("lang.title")}</span><LanguageButton /></div>
      {!me?.name && <Warn>Please complete your profile to start booking.</Warn>}
      <div className="card p-4 space-y-3">
        <p className="font-extrabold">Business profile {me?.verified ? <Chip tone="green">Verified</Chip> : <Chip tone="amber">Verification pending</Chip>}</p>
        <Field label="Your name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Company name"><input className="input" value={f.company_name} onChange={(e) => setF({ ...f, company_name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="GSTIN"><input className="input uppercase" maxLength={15} value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value })} /></Field><Field label="Contact person"><input className="input" value={f.contact_person} onChange={(e) => setF({ ...f, contact_person: e.target.value })} /></Field></div>
        <div className="grid grid-cols-2 gap-3"><Field label="Business phone"><input className="input" inputMode="numeric" maxLength={10} value={f.business_phone} onChange={(e) => setF({ ...f, business_phone: e.target.value.replace(/\D/g, "") })} /></Field><Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field></div>
        <button className="btn-primary w-full" disabled={busy || !f.name.trim()} onClick={save}>{busy ? <Spinner /> : "Save profile"}</button>
      </div>

      <div className="card p-4 space-y-3">
        <p className="font-extrabold">Monthly business credit</p>
        {cs?.status === "approved" ? <><div className="grid grid-cols-3 gap-2 text-center"><div><p className="text-[11px] text-steel uppercase font-bold">Limit</p><p className="font-extrabold">{money(cs.limit)}</p></div><div><p className="text-[11px] text-steel uppercase font-bold">Used</p><p className="font-extrabold text-brand">{money(cs.used)}</p></div><div><p className="text-[11px] text-steel uppercase font-bold">Available</p><p className="font-extrabold">{money(cs.available)}</p></div></div>
          <div className="h-2 rounded-full bg-line overflow-hidden"><div className="h-full bg-brand" style={{ width: `${Math.min((cs.used / cs.limit) * 100, 100)}%` }} /></div>
          <ul className="text-xs space-y-1 max-h-40 overflow-auto">{stmt.data?.transactions.map((t: any) => <li key={t.id} className="flex justify-between"><span className="text-steel">{fmtDate(t.at)} · {t.note || t.kind}</span><b className={t.amount < 0 ? "text-emerald-700" : ""}>{t.amount < 0 ? "−" : "+"}{money(Math.abs(t.amount))}</b></li>)}</ul></>
          : cs?.status === "requested" ? <Warn>Your credit request for {money(cs.requested_limit)} is under review.</Warn> : <><p className="text-sm text-steel">Credit is available only to admin-approved business accounts. It is an internal billing ledger, not a loan.</p><button className="btn-dark" onClick={() => setCredit(true)}>Request business credit</button></>}
        <p className="text-xs text-steel">COD: {ov.data?.cod.used ?? 0} of {ov.data?.cod.limit ?? 5} trips used.</p>
      </div>

      <div className="card p-4 space-y-3">
        <p className="font-extrabold">Saved locations</p>
        {locs.data?.map((l) => <div key={l.id} className="flex items-center justify-between text-sm gap-3"><div className="min-w-0"><b>{l.label}</b><p className="text-xs text-steel truncate">{l.address}</p></div><button className="text-danger text-xs font-bold" onClick={async () => { await api("customer", `/locations/${l.id}`, { method: "DELETE" }); locs.reload(); }}>Remove</button></div>)}
        <input className="input" placeholder="Label: Home, Factory, Warehouse" value={newLoc.label} onChange={(e) => setNewLoc({ ...newLoc, label: e.target.value })} />
        <input className="input" placeholder="Search address" value={newLoc.q} onChange={(e) => searchLoc(e.target.value)} />
        {res.length > 0 && <ul className="border border-line rounded-xl divide-y max-h-36 overflow-auto">{res.map((r, i) => <li key={i}><button className="text-left text-xs p-2 w-full hover:bg-offwhite" onClick={() => { setNewLoc({ ...newLoc, q: r.label, lat: r.lat, lng: r.lng }); setRes([]); }}>{r.label}</button></li>)}</ul>}
        <button className="btn-ghost" disabled={!newLoc.label || !newLoc.lat} onClick={addLoc}>Save location</button>
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between"><span className="font-semibold text-sm">Notification sounds</span><Switch on={snd} label="Sound" onChange={(v) => { setSnd(v); soundPrefs.set(v); }} /></div>
        <button className="btn-ghost w-full" onClick={() => setHelp(true)}>Help, complaints and history</button>
        <div className="text-sm"><p className="font-semibold">Support</p><a className="text-brand font-bold" href={`tel:${cfg?.support_phone || ""}`}>{cfg?.support_phone}</a></div>
        {cfg && <div className="text-xs text-steel"><p className="font-bold text-obsidian mb-1">Emergency numbers</p>{Object.entries(cfg.emergency_numbers).map(([k, v]) => <a key={k} href={`tel:${v}`} className="inline-block mr-3">{k}: <b>{v as string}</b></a>)}</div>}
        <button className="btn-ghost w-full !text-danger" onClick={onLogout}>{t("c.logout")}</button>
      </div>
      <Sheet open={credit} onClose={() => setCredit(false)} title="Request business credit">
        <div className="space-y-3"><p className="text-sm text-steel">Requires company name and GSTIN in your profile. Our team verifies your business before approval.</p>
          <Field label="Requested monthly limit (₹)"><input className="input" type="number" value={limit} onChange={(e) => setLimit(e.target.value)} /></Field>
          <button className="btn-primary w-full" disabled={!Number(limit)} onClick={async () => { try { await api("customer", "/customer/credit/request", { body: { requested_limit: Number(limit) } }); setCredit(false); ov.reload(); toast(t("ts.requestSent"), "ok"); } catch (e: any) { toast(e.message, "err"); } }}>Send request</button></div>
      </Sheet>
      {help && <ComplaintCenter role="customer" onClose={() => setHelp(false)} />}
    </div>
  );
}
