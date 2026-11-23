import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { SessionProvider, useSession, useToast } from "../lib/session";
import { api, fileUrl, tokens } from "../lib/api";
import { ago, fmtDate, km, money, soundPrefs, usePoll, useCountdown } from "../lib/util";
import { Chip, Field, Loading, Photo, Row, Sheet, Spinner, Stat, StatusBadge, Switch, Warn } from "../components/ui";
import { EmptyArt, Logo } from "../components/SvgArt";
import { ComplaintCenter, NotificationCenter, useLiveAlerts } from "../components/Shared";
import { useI18n } from "../lib/i18n";
import { LanguageButton } from "../components/Language";
import Assistant from "../components/Assistant";
import { IcBell, IcBox, IcHome, IcUser, IcWallet } from "../components/Icons";
import Trip from "./Trip";
import Register from "./Register";
import Vehicles from "./Vehicles";

export function useDriverGps(active: boolean, fast: boolean) {
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    if (!navigator.geolocation) { setErr("GPS is not supported on this device"); return; }
    let last = 0;
    const id = navigator.geolocation.watchPosition(
      (p) => { setErr(null); const t = Date.now(); if (t - last < (fast ? 5000 : 20000)) return; last = t; api("driver", "/driver/location", { body: { lat: p.coords.latitude, lng: p.coords.longitude } }).catch(() => {}); },
      (e) => setErr(e.code === 1 ? "Location permission is blocked. Customers cannot track you and you may miss nearby trips. Enable location for HaulGo." : "Waiting for GPS signal…"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active, fast]);
  return err;
}

export default function DriverApp() {
  return <SessionProvider role="driver"><Guard /></SessionProvider>;
}
function Guard() {
  const { me, loading } = useSession();
  if (!tokens.get("driver")) return <Navigate to="/" replace />;
  if (loading) return <div className="min-h-screen bg-obsidian"><Loading /></div>;
  if (!me) return <Navigate to="/" replace />;
  return <Shell />;
}

function Shell() {
  const { t } = useI18n();
  const { logout } = useSession();
  const nav = useNavigate();
  const dash = usePoll(() => api("driver", "/driver/dashboard").catch(async (e) => { if (e.status === 404) return { driver: await api("driver", "/driver/me"), offers: [], active_trip: null, assigned_trips: [] }; throw e; }), 4000);
  const [bell, setBell] = useState(false);
  const { unread, chatUnread } = useLiveAlerts("driver", true);
  const d = dash.data?.driver;
  const status = d?.status || "none";
  const gps = useDriverGps(status === "approved" && (!!d?.online || !!dash.data?.active_trip), !!dash.data?.active_trip);
  const tab = "flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-bold";
  if (dash.loading && !dash.data) return <div className="min-h-screen bg-obsidian"><Loading /></div>;
  const gate = status === "none" || status === "rejected" || status === "pending" || status === "blocked";
  return (
    <div className="min-h-screen max-w-2xl mx-auto bg-offwhite">
      <header className="sticky top-0 z-[1000] bg-obsidian text-white px-4 py-3 flex items-center justify-between">
        <Link to="/driver"><Logo light /></Link>
        <div className="flex items-center gap-2"><Chip tone="red">{t("d.badge")}</Chip><LanguageButton light />
          <button onClick={() => setBell(true)} className="relative w-10 h-10 rounded-full bg-white/10 flex items-center justify-center" aria-label="Notifications"><IcBell size={19} />{unread > 0 && <span className="absolute -top-1 -right-1 bg-brand text-white text-[10px] min-w-4 h-4 rounded-full px-1 flex items-center justify-center">{unread}</span>}</button></div>
      </header>
      <main className="px-4 py-4 pb-28">
        {gate ? <Register driver={d} status={status} onSaved={dash.reload} onLogout={() => { logout(); nav("/", { replace: true }); }} /> : (
          <Routes>
            <Route index element={<Home dash={dash.data} reload={dash.reload} gps={gps} />} />
            <Route path="trip/:id" element={<Trip chatUnread={chatUnread.bookings} reload={dash.reload} />} />
            <Route path="trips" element={<History />} />
            <Route path="earnings" element={<Earnings driver={d} />} />
            <Route path="profile" element={<Profile driver={d} onSaved={dash.reload} onLogout={() => { logout(); nav("/", { replace: true }); }} />} />
            <Route path="*" element={<Navigate to="/driver" replace />} />
          </Routes>
        )}
      </main>
      {!gate && (
        <nav className="fixed bottom-0 left-0 right-0 z-[1100] bg-white border-t border-line safe-b"><div className="max-w-2xl mx-auto flex">
          {[["/driver", t("nav.home"), IcHome, true], ["/driver/trips", t("nav.trips"), IcBox, false], ["/driver/earnings", t("dn.earnings"), IcWallet, false], ["/driver/profile", t("dn.profile"), IcUser, false]].map(([to, l, Ic, end]: any) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `relative ${tab} !pt-3 ${isActive ? "text-brand" : "text-steel"}`}>{({ isActive }: any) => (<>{isActive && <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-brand" />}<Ic size={22} />{l}</>)}</NavLink>))}
        </div></nav>
      )}
      {bell && <NotificationCenter role="driver" onClose={() => setBell(false)} />}
      <Assistant role="driver" />
    </div>
  );
}

function Offer({ o, reload }: { o: any; reload: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const nav = useNavigate();
  const left = useCountdown(o.offer_expires_at);
  const [busy, setBusy] = useState(false);
  const total = 30;
  const act = async (a: "accept" | "reject") => { setBusy(true); try { await api("driver", `/driver/offers/${o.id}/${a}`, { method: "POST" }); await reload(); if (a === "accept") nav(`/driver/trip/${o.id}`); } catch (e: any) { toast(e.message, "err"); reload(); } finally { setBusy(false); } };
  return (
    <div className="card-dark p-4 border-2 border-brand animate-rise space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div><Chip tone="red">{t("d.newRequest")}</Chip><p className="text-3xl font-extrabold mt-2">{money(o.fare.driver_share)}</p><p className="text-xs text-white/60">{t("d.earning")}{o.collect_cash ? ` · collect ${money(o.collect_cash)} cash` : " · paid online/credit"}</p></div>
        <div className="relative w-16 h-16 shrink-0"><svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90"><circle cx="18" cy="18" r="16" fill="none" stroke="#5A5465" strokeWidth="3" /><circle cx="18" cy="18" r="16" fill="none" stroke="#A8651A" strokeWidth="3" strokeDasharray={`${(Math.min(left, total) / total) * 100} 100`} pathLength="100" /></svg><span className="absolute inset-0 flex items-center justify-center font-extrabold text-lg">{left}</span></div>
      </div>
      <div className="text-sm space-y-1"><p>🟢 {o.pickup_address}</p><p>🔴 {o.drop_address}</p><p className="text-white/60 text-xs">{km(o.distance_km)} · {o.goods.description} · {o.goods.weight_kg} kg{o.goods.helper_needed ? " · helper needed" : ""}{o.scheduled_at ? ` · scheduled ${fmtDate(o.scheduled_at)}` : ""}</p></div>
      <div className="grid grid-cols-2 gap-3"><button className="btn bg-white/10 text-white !py-4" disabled={busy} onClick={() => act("reject")}>{t("d.reject")}</button><button className="btn-primary !py-4 text-base" disabled={busy || left === 0} onClick={() => act("accept")}>{busy ? <Spinner /> : t("d.accept")}</button></div>
    </div>
  );
}

function Home({ dash, reload, gps }: { dash: any; reload: () => void; gps: string | null }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const d = dash.driver;
  const toggle = async (v: boolean) => {
    setBusy(true);
    try {
      if (v && navigator.geolocation) await new Promise<void>((res) => navigator.geolocation.getCurrentPosition(async (p) => { await api("driver", "/driver/location", { body: { lat: p.coords.latitude, lng: p.coords.longitude } }).catch(() => {}); res(); }, () => res(), { timeout: 6000 }));
      await api("driver", "/driver/online", { body: { online: v } }); await reload(); toast(v ? "You are online. Trip requests will appear here." : "You are offline", "ok");
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  const blocked = dash.commission_due >= dash.cod_block_threshold;
  return (
    <div className="space-y-4">
      <div className={`rounded-3xl p-5 flex items-center justify-between ${d.online ? "bg-obsidian text-white" : "bg-white border border-line"}`}>
        <div><p className="text-xs font-bold uppercase tracking-wide opacity-60">{t("d.status")}</p><p className="text-2xl font-extrabold flex items-center gap-2"><span className={`w-3 h-3 rounded-full ${d.online ? "bg-emerald-400 animate-pulseDot" : "bg-steel"}`} />{d.online ? t("d.online") : t("d.offline")}</p><p className="text-xs opacity-60 mt-1">{d.vehicle_type?.name} · {d.reg_no}</p></div>
        <Switch on={d.online} onChange={toggle} disabled={busy || !!dash.active_trip} label={t("d.goOnline")} />
      </div>
      {gps && <Warn tone="red">{gps}</Warn>}
      {blocked && <Warn tone="red">Commission due {money(dash.commission_due)} has crossed {money(dash.cod_block_threshold)}. You will not get COD trips until it is settled. See Earnings.</Warn>}
      <div className="grid grid-cols-2 gap-3"><Stat label={t("d.today")} value={money(dash.today_earnings + dash.cod_today)} sub={`${money(dash.cod_today)} cash collected`} accent /><Stat label={t("d.wallet")} value={money(dash.wallet_balance)} sub={dash.commission_due ? `${money(dash.commission_due)} commission due` : "No dues"} /></div>
      {dash.offers.map((o: any) => <Offer key={o.id} o={o} reload={reload} />)}
      {dash.active_trip && (
        <Link to={`/driver/trip/${dash.active_trip.id}`} className="card p-4 block border-brand"><div className="flex justify-between"><div><p className="text-xs font-bold text-brand uppercase">{t("d.activeTrip")}</p><p className="font-extrabold text-lg">{dash.active_trip.code}</p></div><StatusBadge s={dash.active_trip.status} /></div><p className="text-sm mt-2 truncate">{dash.active_trip.pickup_address} → {dash.active_trip.drop_address}</p><p className="btn-primary mt-3">Open trip</p></Link>
      )}
      {!dash.offers.length && !dash.active_trip && (
        <div className="card">{d.online ? <EmptyArt title={t("d.waiting")} hint={t("d.waitingHint")} /> : <EmptyArt title={t("d.offlineTitle")} hint={t("d.offlineHint")} />}</div>
      )}
      <p className="text-center text-xs text-steel">{dash.trips_completed} trips completed · rating ★ {d.rating || "New"}</p>
    </div>
  );
}

function History() {
  const L = useI18n();
  const t = usePoll(() => api<any[]>("driver", "/driver/trips"), 10000);
  return (
    <div className="space-y-3"><h1 className="text-2xl font-extrabold">{L.t("d.history")}</h1>
      {t.loading ? <Loading /> : t.data?.length ? t.data.map((b) => (
        <Link key={b.id} to={`/driver/trip/${b.id}`} className="card p-4 block"><div className="flex justify-between"><div><p className="font-extrabold">{b.code}</p><p className="text-xs text-steel">{fmtDate(b.created_at)}</p></div><StatusBadge s={b.status} /></div><p className="text-sm mt-1 truncate">{b.pickup_address} → {b.drop_address}</p><p className="text-sm mt-1 font-bold">{money(b.fare.driver_share)} <span className="text-steel font-medium text-xs">· {b.payment_method.toUpperCase()}</span></p></Link>
      )) : <div className="card"><EmptyArt title={L.t("d.noTrips")} /></div>}
    </div>
  );
}

function WeekChart({ weekly, label }: { weekly: { date: string; earnings: number }[]; label: string }) {
  const [sel, setSel] = useState<number | null>(null);
  const vals = weekly.map((d) => d.earnings);
  const max = Math.max(...vals, 1);
  const total = vals.reduce((a, b) => a + b, 0);
  const avg = total / Math.max(vals.length, 1);
  const bestI = vals.indexOf(Math.max(...vals));
  const active = sel ?? weekly.length - 1;
  const any = Math.max(...vals, 0) > 0;
  return (
    <div className="relative overflow-hidden rounded-3xl border border-line/70 bg-white shadow-card p-5">
      <div className="absolute -top-14 -right-14 w-44 h-44 rounded-full bg-brand/10 blur-2xl" />
      <div className="relative flex items-start justify-between gap-3">
        <div><p className="text-[11px] uppercase tracking-wide font-semibold text-steel">{label}</p><p className="text-3xl font-extrabold leading-none mt-1.5">{money(total)}</p></div>
        <div className="text-right"><p className="text-[11px] uppercase tracking-wide font-semibold text-steel">{weekly[active]?.date}</p><p className="text-lg font-extrabold text-brand leading-none mt-1.5">{money(vals[active] || 0)}</p></div>
      </div>
      <div className="relative mt-5 flex items-end gap-2.5 h-36">
        {[0.25, 0.5, 0.75, 1].map((g) => <div key={g} className="absolute left-0 right-0 border-t border-dashed border-line/80" style={{ bottom: `${g * 100}%` }} />)}
        {weekly.map((d, i) => {
          const h = Math.max((d.earnings / max) * 100, d.earnings > 0 ? 6 : 2);
          const on = i === active;
          return (
            <button key={d.date} type="button" onClick={() => setSel(i)} onMouseEnter={() => setSel(i)} onMouseLeave={() => setSel(null)} aria-label={`${d.date} ${money(d.earnings)}`} className="relative flex-1 h-full flex items-end focus:outline-none">
              <div className={`w-full rounded-t-xl transition-all duration-300 ${on ? "bg-gradient-to-t from-brand to-[#E0A458] shadow-[0_8px_18px_-6px_rgba(168,101,26,.7)]" : d.earnings > 0 ? "bg-gradient-to-t from-obsidian/85 to-graphite/60" : "bg-line"}`} style={{ height: `${h}%` }} />
            </button>
          );
        })}
      </div>
      <div className="relative mt-2 flex gap-2.5">{weekly.map((d, i) => <span key={d.date} className={`flex-1 text-center text-[10px] font-semibold ${i === active ? "text-brand" : "text-steel"}`}>{d.date.split(" ")[0]}</span>)}</div>
      <div className="relative grid grid-cols-3 gap-2 mt-4">
        {[["Daily average", money(avg)], ["Best day", any ? `${weekly[bestI].date.split(" ")[0]} · ${money(vals[bestI])}` : "—"], ["Today", money(vals[vals.length - 1] || 0)]].map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-offwhite px-3 py-2.5"><p className="text-[10px] uppercase tracking-wide font-semibold text-steel">{k}</p><p className="text-sm font-extrabold mt-0.5 truncate">{v}</p></div>
        ))}
      </div>
    </div>
  );
}

function Earnings({ driver }: { driver: any }) {
  const { t } = useI18n();
  const toast = useToast();
  const e = usePoll(() => api("driver", "/driver/earnings"), 10000);
  const [w, setW] = useState(false);
  const [amt, setAmt] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const x = e.data;
  if (!x) return <Loading />;
  const max = Math.max(...x.weekly.map((d: any) => d.earnings), 1);
  const withdraw = async () => { setBusy(true); try { await api("driver", "/driver/withdraw", { body: { amount: Number(amt) } }); toast(t("ts.withdraw"), "ok"); setW(false); setAmt(""); e.reload(); } catch (er: any) { toast(er.message, "err"); } finally { setBusy(false); } };
  const today = x.weekly[x.weekly.length - 1]?.earnings || 0;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">{t("d.earnTitle")}</h1>
      <div className="relative overflow-hidden rounded-3xl p-6 text-white bg-gradient-to-br from-obsidian via-graphite to-[#5A4130] shadow-card">
        <div className="absolute -top-20 -right-16 w-60 h-60 rounded-full opacity-40 blur-3xl" style={{ background: "radial-gradient(circle,#A8651A,transparent 70%)" }} />
        <div className="relative flex items-center justify-between"><p className="text-[11px] text-white/60 uppercase tracking-widest font-bold">{t("d.walletBalance")}</p><span className="chip bg-white/10 text-white border border-white/15"><IcWallet size={14} /> Wallet</span></div>
        <p className="relative text-5xl font-extrabold mt-3 tracking-tight">{money(x.wallet_balance)}</p>
        <p className="relative text-xs text-white/50 mt-1">Ready to withdraw · minimum ₹100</p>
        <button className="relative btn-primary mt-5 w-full !py-3.5" onClick={() => setW(true)} disabled={x.wallet_balance < 100}>{t("d.withdraw")}</button>
      </div>
      <div className="grid grid-cols-2 gap-3"><Stat label={t("d.tripsDone")} value={x.trips_completed} /><Stat label={t("d.onlineEarn")} value={money(x.online_earnings)} /><Stat label={t("d.codCollected")} value={money(x.cod_collected)} sub="Cash you received" /><Stat label={t("d.commissionDue")} value={money(x.commission_due)} accent={x.commission_due > 0} sub={x.cod_blocked ? "COD trips blocked" : `Block at ${money(x.cod_block_threshold)}`} /></div>
      {x.cod_blocked && <Warn tone="red">COD trips are paused until your commission due is settled. Contact HaulGo support to settle via UPI or cash.</Warn>}
      <WeekChart weekly={x.weekly} label={t("d.weekNet")} />
      <div className="card p-4"><p className="font-extrabold">{t("d.dailyTarget")} <span className="text-xs text-steel font-medium">(optional)</span></p>
        {x.daily_target > 0 && <><div className="h-3 rounded-full bg-line mt-3 overflow-hidden"><div className="h-full bg-brand transition-all" style={{ width: `${Math.min((today / x.daily_target) * 100, 100)}%` }} /></div><p className="text-xs text-steel mt-1">{money(today)} of {money(x.daily_target)} today</p></>}
        <div className="flex gap-2 mt-3"><input className="input" type="number" placeholder="Set target ₹" value={target} onChange={(ev) => setTarget(ev.target.value)} /><button className="btn-dark" disabled={!target} onClick={async () => { try { await api("driver", "/driver/profile", { method: "PUT", body: { name: driver.name, vehicle_type_id: driver.vehicle_type_id, reg_no: driver.reg_no, capacity_kg: driver.capacity_kg, license_no: driver.license_no, rc_no: driver.rc_no, insurance_no: driver.insurance_no, permit_no: driver.permit_no, service_city: driver.service_city, payout_upi: driver.payout_upi, payout_bank_name: driver.payout_bank_name, payout_bank_acc: driver.payout_bank_acc, payout_ifsc: driver.payout_ifsc, daily_target: Number(target) } }); setTarget(""); e.reload(); toast(t("ts.targetSaved"), "ok"); } catch (er: any) { toast(er.message, "err"); } }}>Set</button></div></div>
      <div className="card p-4"><p className="font-extrabold mb-2">Payouts</p>{x.payouts.length ? x.payouts.map((p: any) => <div key={p.id} className="flex justify-between text-sm py-1.5 border-t border-line first:border-0"><span>{money(p.amount)} <span className="text-xs text-steel">· {fmtDate(p.at)}</span></span><Chip tone={p.status === "paid" ? "green" : p.status === "rejected" ? "grey" : "amber"}>{p.status}{p.reference ? ` · ${p.reference}` : ""}</Chip></div>) : <p className="text-sm text-steel">No withdrawals yet.</p>}</div>
      <div className="card p-4"><p className="font-extrabold mb-2">Ledger</p><ul className="text-sm divide-y divide-line">{x.ledger.filter((l: any) => l.bucket !== "cod_cash").slice(0, 30).map((l: any) => <li key={l.id} className="flex justify-between py-2 gap-3"><span><b className="capitalize">{l.kind.replace(/_/g, " ")}</b><span className="block text-xs text-steel">{l.note} · {fmtDate(l.at)}</span></span><b className={l.amount < 0 ? "text-danger" : "text-emerald-700"}>{l.amount < 0 ? "−" : "+"}{money(Math.abs(l.amount))}{l.bucket === "due" ? " (due)" : ""}</b></li>)}</ul></div>
      <Sheet open={w} onClose={() => setW(false)} title="Withdraw"><div className="space-y-3"><p className="text-sm text-steel">Available {money(x.wallet_balance)}. Minimum ₹100. Admin reviews and pays to your saved UPI/bank.</p><Field label="Amount (₹)"><input className="input" type="number" value={amt} onChange={(ev) => setAmt(ev.target.value)} /></Field><button className="btn-primary w-full" disabled={busy || !Number(amt)} onClick={withdraw}>{busy ? <Spinner /> : "Request withdrawal"}</button></div></Sheet>
    </div>
  );
}

function Profile({ driver, onSaved, onLogout }: { driver: any; onSaved: () => void; onLogout: () => void }) {
  const { t } = useI18n();
  const [snd, setSnd] = useState(soundPrefs.get());
  const [help, setHelp] = useState(false);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">{t("d.profileTitle")}</h1>
      <div className="card p-4"><p className="font-extrabold">{driver.name}</p><p className="text-sm text-steel">{driver.phone} · {driver.vehicle_type?.name} · {driver.reg_no}</p><p className="text-sm mt-1">Rating ★ {driver.rating || "New"} ({driver.rating_count})</p></div>
      <Vehicles onChanged={onSaved} />
      <Register driver={driver} status="approved" onSaved={onSaved} embedded onLogout={onLogout} />
      <div className="card p-4 space-y-3"><div className="flex items-center justify-between"><span className="font-semibold text-sm">{t("d.alertSounds")}</span><Switch on={snd} label="Sound" onChange={(v) => { setSnd(v); soundPrefs.set(v); }} /></div><button className="btn-ghost w-full" onClick={() => setHelp(true)}>Help and complaints</button><button className="btn-ghost w-full !text-danger" onClick={onLogout}>Log out</button></div>
      {help && <ComplaintCenter role="driver" onClose={() => setHelp(false)} />}
    </div>
  );
}
