import { api } from "../lib/api";
import { ago, fmtDate, money, STATUS, usePoll } from "../lib/util";
import { Chip, Loading, StatusBadge } from "../components/ui";
import MapView from "../components/MapView";
import { AreaChart, Donut, EmptyState, HBars, PageHead, Spark, StatStrip, Table } from "./kit";
import { useNavigate } from "react-router-dom";
import { useSession, useToast } from "../lib/session";
import { useState } from "react";
import { IcAlert, IcCheck } from "../components/Icons";

const STATUS_COLOR: Record<string, string> = {
  completed: "#3A3541", delivered: "#2E9E5B", in_transit: "#A8651A", delivery_pending: "#A8651A", pickup_verified: "#2E9E5B", driver_reached: "#2E9E5B", driver_accepted: "#2E9E5B",
  driver_assigned: "#3B82F6", pending_assignment: "#3B82F6", awaiting_payment: "#F59E0B", quotation_requested: "#F59E0B", quotation_sent: "#F59E0B", cancelled: "#9CA3AF", refund_pending: "#F59E0B", refunded: "#6B7280",
};

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

function Kpi({ label, value, sub, spark, dark = false, color = "#A8651A" }: { label: string; value: React.ReactNode; sub?: React.ReactNode; spark?: number[]; dark?: boolean; color?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl p-5 border ${dark ? "text-white border-line-dark bg-gradient-to-br from-obsidian via-graphite to-[#4A3624]" : "bg-white border-line/70 shadow-card"}`}>
      {dark && <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full opacity-30 blur-2xl" style={{ background: "radial-gradient(circle,#A8651A,transparent 70%)" }} />}
      <p className={`relative text-[11px] uppercase tracking-wide font-semibold ${dark ? "text-white/60" : "text-steel"}`}>{label}</p>
      <p className="relative text-3xl font-extrabold mt-1.5 leading-none">{value}</p>
      {sub && <p className={`relative text-xs mt-1.5 ${dark ? "text-white/60" : "text-steel"}`}>{sub}</p>}
      {spark && <div className="relative mt-3"><Spark values={spark} color={dark ? "#E0A458" : color} /></div>}
    </div>
  );
}

function SampleBar({ d }: { d: any }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (method: "POST" | "DELETE") => {
    if (method === "DELETE" && !window.confirm("Remove all sample bookings, payments, payouts and complaints?")) return;
    setBusy(true);
    try { const r: any = await api("admin", "/admin/sample-data", { method }); toast(r.message || "Sample data removed", "ok"); setTimeout(() => window.location.reload(), 600); } catch (e: any) { toast(e.message, "err"); setBusy(false); }
  };
  if (d.has_sample) return (
    <div className="card px-4 py-3 flex items-center justify-between gap-3 flex-wrap border-amber-300 bg-amber-50/60"><p className="text-sm"><b>Sample data is on.</b> Numbers, payments and charts below are for testing only.</p><button className="btn-ghost btn-sm" disabled={busy} onClick={() => run("DELETE")}>Remove sample data</button></div>
  );
  if (d.total_bookings > 0) return null;
  return (
    <div className="card p-5 flex items-center justify-between gap-4 flex-wrap bg-gradient-to-r from-white to-red-50"><div><p className="font-extrabold">No activity yet, so most pages are empty</p><p className="text-sm text-steel mt-0.5">Load sample bookings, payments, driver payouts, complaints and business credit to preview every admin page. You can remove it anytime.</p></div><button className="btn-primary" disabled={busy} onClick={() => run("POST")}>{busy ? "Loading…" : "Load sample data"}</button></div>
  );
}

export function Overview({ data: d }: { data: any }) {
  const nav = useNavigate();
  const { me } = useSession();
  if (!d) return <Loading />;
  const rev = d.series.map((x: any) => x.revenue), com = d.series.map((x: any) => x.commission), bk = d.series.map((x: any) => x.bookings);
  const attention: [string, number, string, boolean?][] = ([
    ["Active SOS alerts", d.active_sos, "/admin/safety", true], ["Bookings awaiting a driver", d.awaiting_assignment, "/admin/bookings"], ["Quotation requests", d.quotation_requests, "/admin/bookings"],
    ["Drivers cannot find pickup", d.pickup_help, "/admin/communication"], ["Open complaints", d.open_complaints, "/admin/safety"], ["Refunds in progress", d.pending_refunds, "/admin/payments"],
    ["Driver approvals pending", d.pending_driver_approvals, "/admin/drivers"], ["Credit requests pending", d.pending_credit_requests, "/admin/credit"],
  ] as [string, number, string, boolean?][]).filter((x) => x[1] > 0);
  const tiles: [string, React.ReactNode, string][] = [
    ["Completed", d.completed, "/admin/bookings"], ["Cancelled", d.cancelled, "/admin/bookings"], ["Online drivers", d.online_drivers, "/admin/drivers"], ["Registered companies", d.companies, "/admin/customers"],
    ["Paid to drivers", money(d.paid_out), "/admin/payments"], ["Pending payouts", money(d.pending_payouts), "/admin/payments"], ["COD commission due", money(d.outstanding_cod_commission), "/admin/payments"], ["Credit outstanding", money(d.credit_outstanding), "/admin/credit"],
  ];
  const statusItems = Object.entries(d.by_status).map(([s, n]) => ({ label: STATUS[s]?.label || s, value: n as number, color: STATUS_COLOR[s] || "#7A7480" })).sort((a, b) => b.value - a.value);
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div><p className="text-sm text-steel font-semibold">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p><h1 className="text-3xl font-extrabold">{greeting()}, {(me?.name || "Admin").split(" ")[0]}</h1></div>
        <Chip tone="green"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulseDot" /> Live · refreshes every few seconds</Chip>
      </div>

      <SampleBar d={d} />

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi dark label="Gross trip value" value={money(d.gmv)} sub="completed trips" spark={rev} />
        <Kpi label="Platform commission" value={money(d.platform_commission)} sub={`${money(d.today_revenue)} trip value today`} spark={com} />
        <Kpi label="Bookings today" value={d.today_bookings} sub={`${d.total_bookings} in total`} spark={bk} color="#3A3541" />
        <Kpi label="Active trips" value={d.active_trips} sub={`${d.online_drivers} driver(s) online · ${d.awaiting_assignment} waiting`} />
      </div>

      <section>
        <p className="font-extrabold mb-3">Needs your attention</p>
        {attention.length ? (
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {attention.map(([l, n, to, hot]) => (
              <button key={l} onClick={() => nav(to)} className={`card p-4 text-left flex items-center gap-3 hover:shadow-lg transition ${hot ? "border-brand bg-red-50" : "border-amber-300 bg-amber-50/50"}`}>
                <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${hot ? "bg-danger text-white" : "bg-amber-100 text-amber-700"}`}><IcAlert size={20} /></span>
                <span><b className="text-2xl block leading-none">{n}</b><span className="text-sm font-semibold">{l}</span></span>
              </button>
            ))}
          </div>
        ) : (
          <div className="card p-4 flex items-center gap-3 border-emerald-200 bg-emerald-50/60"><span className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center"><IcCheck size={20} /></span><div><p className="font-bold">All clear</p><p className="text-sm text-steel">No SOS alerts, pending approvals, refunds or complaints right now.</p></div></div>
        )}
      </section>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2"><AreaChart data={d.series} k="revenue" label="Trip value · last 14 days" fmt={money} /></div>
        <Donut label="Bookings by status" items={statusItems} />
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <AreaChart data={d.series} k="bookings" label="Bookings · last 14 days" color="#3A3541" height={190} />
        <AreaChart data={d.series} k="commission" label="Commission · last 14 days" color="#2E9E5B" fmt={money} height={190} />
        <HBars label="Most booked vehicles" items={d.vehicle_mix.map((v: any) => ({ label: v.name, value: v.count }))} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3"><p className="font-extrabold">Recent bookings</p><button className="text-sm font-bold text-brand" onClick={() => nav("/admin/bookings")}>View all →</button></div>
          <Table rows={d.recent_bookings} onRow={() => nav("/admin/bookings")} empty="No bookings yet" hint="Bookings made by customers appear here in real time." cols={[
            ["Booking", (r: any) => <span><b>{r.code}</b><span className="block text-xs text-steel">{fmtDate(r.created_at)}</span></span>], ["Customer", (r: any) => r.customer || "—"],
            ["Route", (r: any) => <span className="text-xs block max-w-[220px] truncate">{r.pickup} → {r.drop}</span>], ["Status", (r: any) => <StatusBadge s={r.status} />], ["Fare", (r: any) => (r.fare ? money(r.fare) : "Quote")]]} />
        </section>
        <section>
          <p className="font-extrabold mb-3">Top drivers</p>
          <div className="card divide-y divide-line/70">
            {d.top_drivers.map((x: any, i: number) => (
              <div key={x.id} className="flex items-center gap-3 p-3.5"><span className="w-8 h-8 rounded-full bg-obsidian text-white text-sm font-extrabold flex items-center justify-center">{i + 1}</span><div className="flex-1 min-w-0"><p className="font-bold truncate">{x.name}</p><p className="text-xs text-steel">{x.reg_no || "—"}</p></div><div className="text-right"><p className="font-extrabold">{x.trips} trip{x.trips > 1 ? "s" : ""}</p><p className="text-xs text-steel">{money(x.earned)}</p></div></div>
            ))}
            {!d.top_drivers.length && <EmptyState title="No completed trips yet" hint="Drivers are ranked here by completed trips." />}
          </div>
        </section>
      </div>

      <section>
        <p className="font-extrabold mb-3">Operations at a glance</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {tiles.map(([l, v, to]) => <button key={l} onClick={() => nav(to)} className="card px-4 py-3 text-left hover:shadow-lg transition"><p className="text-[11px] uppercase tracking-wide font-semibold text-steel">{l}</p><p className="text-xl font-extrabold mt-0.5">{v}</p></button>)}
        </div>
      </section>
    </div>
  );
}

export function LiveMap() {
  const live = usePoll(() => api("admin", "/admin/live"), 5000);
  const d = live.data;
  const first = d?.trips.find((t: any) => t.driver_lat != null);
  const idle = d ? d.online_drivers.filter((x: any) => !x.busy) : [];
  return (
    <div className="space-y-4">
      <PageHead title="Live trips"><Chip tone="green">Auto-refresh 5s · real GPS only</Chip></PageHead>
      {!d ? <Loading /> : (
        <>
          <StatStrip items={[["Active trips", d.trips.length, d.trips.length > 0], ["Drivers online", d.online_drivers.length], ["Idle drivers", idle.length], ["Drivers on a trip", d.online_drivers.length - idle.length], ["GPS lost", d.trips.filter((t: any) => t.driver_lat == null || t.stale).length, d.trips.some((t: any) => t.stale)]]} />
          <div className="grid xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2 rounded-2xl overflow-hidden"><MapView height={420} center={first ? { lat: first.driver_lat, lng: first.driver_lng } : undefined}
              extras={[...idle.map((x: any) => ({ lat: x.lat, lng: x.lng, color: "#2E9E5B" })), ...d.trips.flatMap((t: any) => [{ lat: t.pickup_lat, lng: t.pickup_lng, color: "#7A7480" }, { lat: t.drop_lat, lng: t.drop_lng, color: "#A8651A" }])]}
              driver={first ? { lat: first.driver_lat, lng: first.driver_lng } : null} driverStale={first?.stale} /></div>
            <div className="card p-4 max-h-[420px] overflow-y-auto">
              <p className="font-extrabold mb-2">Online drivers</p>
              {d.online_drivers.map((x: any) => (
                <div key={x.id} className="flex items-center gap-3 py-2.5 border-t border-line/70 first:border-0"><span className={`w-2.5 h-2.5 rounded-full ${x.busy ? "bg-brand" : "bg-emerald-500"}`} /><div className="flex-1 min-w-0"><p className="font-bold text-sm truncate">{x.name}</p><p className="text-xs text-steel">{x.reg_no || "—"}</p></div><Chip tone={x.busy ? "red" : "green"}>{x.busy ? "on trip" : "idle"}</Chip></div>
              ))}
              {!d.online_drivers.length && <EmptyState title="No drivers online" hint="Drivers show here once they go online with location turned on." />}
            </div>
          </div>
          <p className="text-xs text-steel">Green dots: idle online drivers · grey: pickups · red: drops · truck: first active trip driver. Open the trip table below for each driver's last update.</p>
          <Table rows={d.trips} empty="No active trips right now" cols={[["Booking", (t: any) => <b>{t.code}</b>], ["Status", (t: any) => <StatusBadge s={t.status} />], ["Driver", (t: any) => `${t.driver || "—"} ${t.reg_no ? "· " + t.reg_no : ""}`], ["Route", (t: any) => <span className="text-xs">{t.pickup} → {t.drop}</span>], ["GPS", (t: any) => t.driver_lat == null ? <Chip tone="amber">no fix</Chip> : t.stale ? <Chip tone="red">stale · {ago(t.driver_updated_at)}</Chip> : <Chip tone="green">live · {ago(t.driver_updated_at)}</Chip>]]} />
        </>
      )}
    </div>
  );
}
