import { useState } from "react";
import { api } from "../lib/api";
import { fmtDate, money, usePoll } from "../lib/util";
import { useToast } from "../lib/session";
import { Chip, Field, Loading, Sheet, Switch, Tabs, Warn } from "../components/ui";
import { PageHead, Table } from "./kit";

const LABELS: Record<string, string> = {
  commission_pct: "Platform commission (%)", night_pct: "Night surcharge (%)", night_start_hour: "Night starts (hour, 0-23)", night_end_hour: "Night ends (hour, 0-23)",
  search_radius_km: "Driver search radius (km)", request_timeout_s: "Driver offer timeout (seconds)", cod_limit: "Base COD trips allowed", cod_bonus_after_online: "+1 COD after every N online trips (0 = off)",
  cod_commission_threshold: "COD commission-due block threshold (₹)", payment_expiry_min: "Unpaid booking expiry (minutes)", cancel_fee_enroute: "Cancel fee: driver en route (₹)", cancel_fee_reached: "Cancel fee: driver reached (₹)",
  service_area_enforced: "Enforce service areas (off = book from any location)", auto_assign_test_mode: "TEST MODE: auto-assign best driver", quotation_weight_kg: "Quotation above weight (kg)", quotation_distance_km: "Quotation above distance (km)",
  long_distance_note_km: "Long-distance note above (km)", chat_retention_days: "Chat retention (days)", support_phone: "Support phone", tracking_stale_seconds: "GPS stale after (seconds)",
};

export function Pricing() {
  const toast = useToast();
  const { data, reload } = usePoll(() => api("admin", "/admin/settings"), 60000);
  const [edit, setEdit] = useState<any>(null);
  const [vt, setVt] = useState<any>(null);
  const [area, setArea] = useState<any>(null);
  const [tab, setTab] = useState("settings");
  if (!data) return <Loading />;
  const st = edit ?? data.settings;
  const save = async () => {
    try { const body: any = {}; Object.keys(edit).forEach((k) => { if (k !== "emergency_numbers") body[k] = edit[k]; }); await api("admin", "/admin/settings", { method: "PUT", body }); toast("Settings saved", "ok"); setEdit(null); reload(); } catch (e: any) { toast(e.message, "err"); }
  };
  return (
    <div className="space-y-4">
      <PageHead title="Pricing and settings"><Tabs value={tab} onChange={setTab} items={[["settings", "Rules"], ["vehicles", "Vehicle pricing"], ["areas", "Service areas"]]} /></PageHead>
      {tab === "settings" && (
        <div className="card p-5 space-y-4">
          {st.auto_assign_test_mode && <Warn>TEST MODE is ON: the system auto-offers each paid booking to the best available driver. You can still assign or reassign manually. Turn it off for production.</Warn>}
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Object.keys(LABELS).map((k) => typeof st[k] === "boolean" ? (
              <div key={k} className="self-end pb-2"><Switch on={st[k]} onChange={(v) => setEdit({ ...st, [k]: v })} label={LABELS[k]} /></div>
            ) : (
              <Field key={k} label={LABELS[k]}><input className="input" type={typeof st[k] === "number" ? "number" : "text"} step="any" value={st[k]} onChange={(e) => setEdit({ ...st, [k]: typeof data.settings[k] === "number" ? Number(e.target.value) : e.target.value })} /></Field>
            ))}
          </div>
          {edit && <div className="flex gap-2"><button className="btn-primary" onClick={save}>Save settings</button><button className="btn-ghost" onClick={() => setEdit(null)}>Discard</button></div>}
        </div>
      )}
      {tab === "vehicles" && (
        <>
          <div className="flex justify-end"><button className="btn-primary btn-sm" onClick={() => setVt({ key: "", name: "", description: "", capacity_kg: 1000, max_length_cm: 0, base_fare: 300, per_km: 20, min_fare: 400, helper_charge: 200, waiting_per_min: 2, free_wait_min: 15, special_charge: 0, goods_categories: "", avg_speed_kmph: 35, sort: 0, active: true })}>+ Add vehicle type</button></div>
          <Table rows={data.vehicle_types} onRow={(r) => setVt(r)} cols={[["Vehicle", (r: any) => <b>{r.name}</b>], ["Capacity", (r: any) => `${r.capacity_kg} kg`], ["Base", (r: any) => money(r.base_fare)], ["Per km", (r: any) => money(r.per_km)], ["Minimum", (r: any) => money(r.min_fare)], ["Helper", (r: any) => money(r.helper_charge)], ["Active", (r: any) => (r.active ? <Chip tone="green">active</Chip> : <Chip>off</Chip>)]]} />
        </>
      )}
      {tab === "areas" && (
        <>
          <div className="flex justify-between items-center"><p className="text-sm text-steel">Service areas are informational unless "Enforce service areas" is on in Rules.</p><button className="btn-primary btn-sm" onClick={() => setArea({ city: "", lat: 13.0827, lng: 80.2707, radius_km: 50, active: true })}>+ Add area</button></div>
          <Table rows={data.service_areas} onRow={(r) => setArea(r)} cols={[["City", (r: any) => <b>{r.city}</b>], ["Centre", (r: any) => `${r.lat}, ${r.lng}`], ["Radius", (r: any) => `${r.radius_km} km`], ["Active", (r: any) => (r.active ? <Chip tone="green">active</Chip> : <Chip>off</Chip>)]]} />
        </>
      )}
      {vt && <VtForm v={vt} onClose={() => setVt(null)} onSaved={() => { setVt(null); reload(); }} />}
      {area && <AreaForm v={area} onClose={() => setArea(null)} onSaved={() => { setArea(null); reload(); }} />}
    </div>
  );
}

function VtForm({ v, onClose, onSaved }: { v: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState(v);
  const num = ["capacity_kg", "max_length_cm", "base_fare", "per_km", "min_fare", "helper_charge", "waiting_per_min", "free_wait_min", "special_charge", "avg_speed_kmph", "sort"];
  const set = (k: string, val: any) => setF({ ...f, [k]: num.includes(k) ? Number(val) : val });
  const save = async () => {
    try {
      const { id, ...body } = f;
      await api("admin", id ? `/admin/vehicle-types/${id}` : "/admin/vehicle-types", { method: id ? "PUT" : "POST", body });
      toast("Saved", "ok"); onSaved();
    } catch (e: any) { toast(e.message, "err"); }
  };
  return (
    <Sheet open onClose={onClose} title={f.id ? `Edit ${f.name}` : "New vehicle type"} wide>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Key (unique, lowercase)"><input className="input" value={f.key} disabled={!!f.id} onChange={(e) => set("key", e.target.value)} /></Field>
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="Description"><input className="input" value={f.description || ""} onChange={(e) => set("description", e.target.value)} /></Field></div>
        {num.map((k) => <Field key={k} label={k.replace(/_/g, " ")}><input className="input" type="number" step="any" value={f[k]} onChange={(e) => set(k, e.target.value)} /></Field>)}
        <div className="sm:col-span-2"><Field label="Goods categories (comma separated keys; empty = all)"><input className="input" value={f.goods_categories || ""} onChange={(e) => set("goods_categories", e.target.value)} /></Field></div>
        <Switch on={f.active} onChange={(x) => set("active", x)} label="Active" />
      </div>
      <button className="btn-primary mt-4" onClick={save}>Save vehicle type</button>
    </Sheet>
  );
}

function AreaForm({ v, onClose, onSaved }: { v: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState(v);
  const save = async () => { try { const { id, ...body } = f; await api("admin", id ? `/admin/service-areas/${id}` : "/admin/service-areas", { method: id ? "PUT" : "POST", body: { ...body, lat: Number(body.lat), lng: Number(body.lng), radius_km: Number(body.radius_km) } }); toast("Saved", "ok"); onSaved(); } catch (e: any) { toast(e.message, "err"); } };
  const del = async () => { try { await api("admin", `/admin/service-areas/${f.id}`, { method: "DELETE" }); toast("Deleted", "ok"); onSaved(); } catch (e: any) { toast(e.message, "err"); } };
  return (
    <Sheet open onClose={onClose} title={f.id ? "Edit service area" : "New service area"}>
      <div className="space-y-3">
        <Field label="City"><input className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-3"><Field label="Latitude"><input className="input" type="number" step="any" value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} /></Field><Field label="Longitude"><input className="input" type="number" step="any" value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} /></Field><Field label="Radius km"><input className="input" type="number" value={f.radius_km} onChange={(e) => setF({ ...f, radius_km: e.target.value })} /></Field></div>
        <Switch on={f.active} onChange={(x) => setF({ ...f, active: x })} label="Active" />
        <div className="flex gap-2"><button className="btn-primary" onClick={save}>Save</button>{f.id && <button className="btn-ghost !text-danger" onClick={del}>Delete</button>}</div>
      </div>
    </Sheet>
  );
}

export function Payments() {
  const toast = useToast();
  const [tab, setTab] = useState("payments");
  const pay = usePoll(() => api<any[]>("admin", "/admin/payments"), 15000);
  const ref = usePoll(() => api<any[]>("admin", "/admin/refunds"), 15000);
  const out = usePoll(() => api<any[]>("admin", "/admin/payouts"), 15000);
  const dues = usePoll(() => api<any[]>("admin", "/admin/cod-dues"), 15000);
  const led = usePoll(() => api<any[]>("admin", "/admin/wallet-ledger"), 30000);
  const [dlg, setDlg] = useState<{ kind: string; row: any } | null>(null);
  const [f, setF] = useState<any>({});
  const run = async (fn: () => Promise<any>, reload: () => void) => { try { await fn(); toast("Done", "ok"); setDlg(null); setF({}); reload(); } catch (e: any) { toast(e.message, "err"); } };
  const pending = (out.data || []).filter((p) => ["requested", "approved"].includes(p.status)).length;
  return (
    <div className="space-y-4">
      <PageHead title="Payments and payouts"><Tabs value={tab} onChange={setTab} items={[["payments", "Payments"], ["refunds", "Refunds", (ref.data || []).filter((r) => r.status !== "completed" && r.status !== "failed").length], ["payouts", "Driver payouts", pending], ["cod", "COD dues", dues.data?.length], ["ledger", "Wallet ledger"]]} /></PageHead>
      {tab === "payments" && <Table loading={pay.loading} rows={pay.data} empty="No payments yet" hint="A payment is recorded when a customer pays online, or when a driver collects cash on a completed COD trip. Create a booking as a customer and pay to see it here." cols={[["#", (r: any) => r.id], ["Booking", (r: any) => <b>{r.booking}</b>], ["Amount", (r: any) => money(r.amount)], ["Status", (r: any) => <Chip tone={r.status === "paid" ? "green" : r.status === "failed" ? "red" : "amber"}>{r.status}</Chip>], ["Mode", (r: any) => (r.mode === "dev_simulated" ? <Chip tone="amber">dev simulated</Chip> : r.mode)], ["Provider ref", (r: any) => <span className="text-xs">{r.payment_id || r.order_id || "—"}</span>], ["At", (r: any) => fmtDate(r.at)]]} />}
      {tab === "refunds" && (<><Warn>A refund is marked completed only after the payment provider confirms it. Enter the provider refund reference when you complete one manually.</Warn>
        <Table loading={ref.loading} rows={ref.data} empty="No refunds yet" hint="Refunds appear when a paid booking is cancelled or disputed." cols={[["#", (r: any) => r.id], ["Booking", (r: any) => <b>{r.booking}</b>], ["Amount", (r: any) => money(r.amount)], ["Status", (r: any) => <Chip tone={r.status === "completed" ? "green" : r.status === "failed" ? "red" : "amber"}>{r.status}</Chip>], ["Reason", (r: any) => <span className="text-xs">{r.reason}</span>], ["Reference", (r: any) => r.provider_refund_id || "—"],
          ["", (r: any) => !["completed", "failed"].includes(r.status) && <button className="btn-dark btn-sm" onClick={() => setDlg({ kind: "refund", row: r })}>Update</button>]]} /></>)}
      {tab === "payouts" && <Table loading={out.loading} rows={out.data} empty="No driver payouts yet" hint="A payout is created after a driver completes a paid trip. Complete a trip to see it here." cols={[["#", (r: any) => r.id], ["Driver", (r: any) => <b>{r.driver}</b>], ["Amount", (r: any) => money(r.amount)], ["To", (r: any) => <span className="text-xs">{r.method} · {r.destination}</span>], ["Status", (r: any) => <Chip tone={r.status === "paid" ? "green" : r.status === "rejected" ? "red" : "amber"}>{r.status}</Chip>], ["Reference", (r: any) => r.reference || "—"], ["Requested", (r: any) => fmtDate(r.at)],
        ["", (r: any) => ["requested", "approved"].includes(r.status) && <div className="flex gap-1.5">{r.status === "requested" && <button className="btn-ghost btn-sm" onClick={() => run(() => api("admin", `/admin/payouts/${r.id}`, { body: { action: "approve" } }), out.reload)}>Approve</button>}<button className="btn-dark btn-sm" onClick={() => setDlg({ kind: "paid", row: r })}>Mark paid</button><button className="btn-ghost btn-sm !text-danger" onClick={() => run(() => api("admin", `/admin/payouts/${r.id}`, { body: { action: "reject" } }), out.reload)}>Reject</button></div>]]} />}
      {tab === "cod" && <Table loading={dues.loading} rows={dues.data} empty="No commission dues" hint="Appears when a driver completes a cash trip and owes the platform its commission." cols={[["Driver", (r: any) => <b>{r.driver}</b>], ["Commission due", (r: any) => <b className="text-danger">{money(r.due)}</b>], ["Wallet", (r: any) => money(r.wallet)], ["COD", (r: any) => (r.blocked_for_cod ? <Chip tone="red">blocked</Chip> : <Chip tone="green">allowed</Chip>)], ["", (r: any) => <button className="btn-dark btn-sm" onClick={() => { setF({ amount: r.due, method: "cash" }); setDlg({ kind: "settle", row: r }); }}>Settle</button>]]} />}
      {tab === "ledger" && <Table loading={led.loading} rows={led.data} empty="No wallet entries yet" hint="Every driver earning, commission and payout is logged here once trips are completed." cols={[["Driver", (r: any) => r.driver], ["Bucket", (r: any) => <Chip>{r.bucket}</Chip>], ["Type", (r: any) => r.kind.replace(/_/g, " ")], ["Amount", (r: any) => <b className={r.amount < 0 ? "text-danger" : "text-emerald-700"}>{money(r.amount)}</b>], ["Note", (r: any) => <span className="text-xs">{r.note}</span>], ["At", (r: any) => fmtDate(r.at)]]} />}

      {dlg && (
        <Sheet open onClose={() => setDlg(null)} title={dlg.kind === "refund" ? `Refund #${dlg.row.id}` : dlg.kind === "paid" ? `Payout #${dlg.row.id}: mark paid` : `Settle commission · ${dlg.row.driver}`}>
          <div className="space-y-3">
            {dlg.kind === "refund" && <><Field label="Status"><select className="input" value={f.status || "processing"} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="processing">Processing</option><option value="completed">Completed (provider confirmed)</option><option value="failed">Failed</option></select></Field><Field label="Provider refund reference"><input className="input" value={f.reference || ""} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field><Field label="Note"><input className="input" value={f.note || ""} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
              <button className="btn-primary" onClick={() => run(() => api("admin", `/admin/refunds/${dlg.row.id}`, { body: { status: f.status || "processing", reference: f.reference || null, note: f.note || null } }), ref.reload)}>Save</button></>}
            {dlg.kind === "paid" && <><p className="text-sm">Pay <b>{money(dlg.row.amount)}</b> to {dlg.row.destination} outside the app, then enter the transaction reference.</p><Field label="UPI / bank transaction reference"><input className="input" value={f.reference || ""} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
              <button className="btn-primary" disabled={!f.reference} onClick={() => run(() => api("admin", `/admin/payouts/${dlg.row.id}`, { body: { action: "paid", reference: f.reference } }), out.reload)}>Confirm paid</button></>}
            {dlg.kind === "settle" && <><Field label="Amount (₹)"><input className="input" type="number" value={f.amount || ""} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field><Field label="Method"><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="cash">Cash received</option><option value="upi">UPI received</option><option value="wallet">Deduct from driver wallet</option></select></Field><Field label="Reference"><input className="input" value={f.reference || ""} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
              <button className="btn-primary" onClick={() => run(() => api("admin", `/admin/cod-dues/${dlg.row.driver_id}/settle`, { body: { amount: Number(f.amount), method: f.method, reference: f.reference || null } }), () => { dues.reload(); led.reload(); })}>Settle</button></>}
          </div>
        </Sheet>
      )}
    </div>
  );
}

export function Credit() {
  const toast = useToast();
  const list = usePoll(() => api<any[]>("admin", "/admin/credit"), 15000);
  const [sel, setSel] = useState<any>(null);
  const [stmt, setStmt] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const act = async (action: string, extra: any = {}) => { try { await api("admin", `/admin/credit/${sel.id}`, { body: { action, ...extra } }); toast("Updated", "ok"); setSel(null); setF({}); list.reload(); } catch (e: any) { toast(e.message, "err"); } };
  return (
    <div>
      <PageHead title="Business credit accounts" />
      <Warn tone="dark">Approve credit only after you have verified the company (GSTIN, business documents). Credit is a ledger: usage is added per booking and cleared when you record a payment.</Warn>
      <div className="h-3" />
      <Table loading={list.loading} rows={list.data} empty="No credit requests yet" onRow={(r) => { setSel(r); setF({ limit: r.limit || "" }); setStmt(null); }} cols={[["Company", (r: any) => <span><b>{r.company}</b><span className="block text-xs text-steel">{r.gstin || "no GSTIN"}</span></span>], ["Status", (r: any) => <Chip tone={r.status === "approved" ? "green" : r.status === "requested" ? "amber" : "red"}>{r.status}</Chip>], ["Limit", (r: any) => money(r.limit)], ["Used", (r: any) => money(r.used)], ["Available", (r: any) => money(r.available)], ["Note", (r: any) => <span className="text-xs">{r.note || "—"}</span>]]} />
      {sel && (
        <Sheet open onClose={() => setSel(null)} title={sel.company} wide>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center"><div className="rounded-xl bg-offwhite p-3"><p className="text-xs text-steel">Limit</p><b>{money(sel.limit)}</b></div><div className="rounded-xl bg-offwhite p-3"><p className="text-xs text-steel">Used</p><b>{money(sel.used)}</b></div><div className="rounded-xl bg-offwhite p-3"><p className="text-xs text-steel">Available</p><b>{money(sel.available)}</b></div></div>
            <Field label="Credit limit (₹)"><input className="input" type="number" value={f.limit ?? ""} onChange={(e) => setF({ ...f, limit: e.target.value })} /></Field>
            <div className="flex gap-2 flex-wrap">{sel.status !== "approved" ? <button className="btn-primary btn-sm" onClick={() => act("approve", { limit: Number(f.limit) })}>Approve with limit</button> : <button className="btn-dark btn-sm" onClick={() => act("set_limit", { limit: Number(f.limit) })}>Update limit</button>}<button className="btn-ghost btn-sm !text-danger" onClick={() => act("reject")}>Reject</button><button className="btn-ghost btn-sm !text-danger" onClick={() => act("suspend")}>Suspend</button></div>
            <div className="rounded-2xl border border-line p-4 space-y-2"><p className="font-extrabold">Record a payment received</p><div className="flex gap-2"><input className="input" type="number" placeholder="Amount ₹" value={f.pay || ""} onChange={(e) => setF({ ...f, pay: e.target.value })} /><input className="input" placeholder="Note / reference" value={f.pnote || ""} onChange={(e) => setF({ ...f, pnote: e.target.value })} /><button className="btn-dark btn-sm" disabled={!Number(f.pay)} onClick={() => act("payment", { amount: Number(f.pay), note: f.pnote || null })}>Record</button></div></div>
            <button className="btn-ghost btn-sm" onClick={async () => setStmt(await api("admin", `/admin/credit/${sel.id}/statement`))}>View statement</button>
            {stmt && <div className="max-h-64 overflow-auto rounded-xl border border-line">{stmt.transactions.map((t: any) => <p key={t.id} className="text-sm px-3 py-2 border-b border-line flex justify-between"><span>{t.kind.replace(/_/g, " ")} <span className="text-xs text-steel">{t.note} · {fmtDate(t.at)}</span></span><b className={t.amount < 0 ? "text-emerald-700" : ""}>{money(t.amount)}</b></p>)}{!stmt.transactions.length && <p className="p-3 text-sm text-steel">No transactions.</p>}</div>}
          </div>
        </Sheet>
      )}
    </div>
  );
}
