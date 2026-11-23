import { useState } from "react";
import { api, fileUrl, openAuthed } from "../lib/api";
import { ago, fmtDate, money, usePoll } from "../lib/util";
import { useToast } from "../lib/session";
import { Chip, Loading, Row, Sheet, StatusBadge, Tabs, Warn } from "../components/ui";
import { PageHead, Table } from "./kit";

export function Drivers() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const list = usePoll(() => api<any[]>("admin", "/admin/drivers", { query: { status, q } }), 8000, [status, q]);
  return (
    <div>
      <PageHead title="Driver partners"><input className="input !w-56" placeholder="Search name / phone / vehicle" value={q} onChange={(e) => setQ(e.target.value)} />
        <Tabs value={status} onChange={setStatus} items={[["", "All"], ["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"], ["blocked", "Blocked"]]} /></PageHead>
      <Table loading={list.loading} rows={list.data} onRow={(r) => setOpen(r.id)} cols={[
        ["Driver", (r) => <span><b>{r.name}</b> {r.is_demo && <Chip tone="amber">demo</Chip>}<span className="block text-xs text-steel">{r.phone}</span></span>],
        ["Vehicle", (r) => <span>{r.vehicle_type?.name}<span className="block text-xs text-steel">{r.reg_no} · {r.capacity_kg} kg</span></span>],
        ["Status", (r) => <Chip tone={r.status === "approved" ? "green" : r.status === "pending" ? "amber" : "red"}>{r.status}</Chip>], ["Online", (r) => (r.online ? <Chip tone="green">{r.busy ? "on trip" : "online"}</Chip> : <span className="text-steel text-xs">offline</span>)],
        ["Docs", (r) => <span className="text-xs">{r.documents.filter((d: any) => d.status === "verified").length}/{r.documents.length} verified</span>], ["Trips", (r) => r.trips], ["Wallet", (r) => money(r.wallet_balance)], ["Comm. due", (r) => (r.commission_due ? <b className="text-danger">{money(r.commission_due)}</b> : "—")], ["Rating", (r) => (r.rating ? `★ ${r.rating}` : "—")],
      ]} />
      {open && <DriverDrawer id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </div>
  );
}

function DriverDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { data: d, reload } = usePoll(() => api("admin", `/admin/drivers/${id}`), 8000, [id]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (a: string) => { setBusy(true); try { await api("admin", `/admin/drivers/${id}/${a}`, { body: { reason: reason || null } }); toast(`Driver ${({ approve: "approved", reject: "rejected", block: "blocked", unblock: "unblocked" } as Record<string, string>)[a] || "updated"}`, "ok"); await reload(); onChanged(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); } };
  const review = async (docId: number, status: string) => { try { await api("admin", `/admin/documents/${docId}/review`, { body: { status, note: status === "rejected" ? reason || "Unclear / invalid" : null } }); reload(); onChanged(); } catch (e: any) { toast(e.message, "err"); } };
  if (!d) return <Sheet open onClose={onClose} title="Driver" wide><Loading /></Sheet>;
  return (
    <Sheet open onClose={onClose} title={d.name} wide>
      <div className="space-y-4">
        <div className="flex gap-2 flex-wrap"><Chip tone={d.status === "approved" ? "green" : d.status === "pending" ? "amber" : "red"}>{d.status}</Chip>{d.online && <Chip tone="green">online</Chip>}{d.lat != null && <Chip>GPS {ago(d.location_updated_at)}</Chip>}</div>
        <div className="grid md:grid-cols-2 gap-4"><div className="rounded-2xl border border-line p-4"><Row k="Phone" v={d.phone} /><Row k="Vehicle" v={`${d.vehicle_type?.name} · ${d.reg_no}`} /><Row k="Capacity" v={`${d.capacity_kg} kg`} /><Row k="Licence" v={d.license_no} /><Row k="RC" v={d.rc_no || "—"} /><Row k="Insurance" v={d.insurance_no || "—"} /><Row k="Permit" v={d.permit_no || "—"} /><Row k="City" v={d.service_city || "—"} /></div>
          <div className="rounded-2xl border border-line p-4"><Row k="Wallet" v={money(d.wallet_balance)} /><Row k="Commission due" v={money(d.commission_due)} /><Row k="UPI" v={d.payout_upi || "—"} /><Row k="Bank" v={d.payout_bank_acc ? `${d.payout_bank_name} ****${d.payout_bank_acc.slice(-4)} ${d.payout_ifsc}` : "—"} /><Row k="Rating" v={d.rating ? `★ ${d.rating} (${d.rating_count})` : "—"} /></div></div>
        <div className="rounded-2xl border border-line p-4 space-y-3"><p className="font-extrabold">KYC documents</p>
          {!d.documents.length && <Warn>No documents uploaded. A driver cannot be approved without licence and RC.</Warn>}
          {d.documents.map((x: any) => (
            <div key={x.id} className="flex items-center justify-between gap-3 flex-wrap border-t border-line pt-3 first:border-0 first:pt-0">
              <div className="flex items-center gap-3">{x.mime === "application/pdf" ? <a className="btn-ghost btn-sm" href={fileUrl("admin", x.id)} target="_blank" rel="noreferrer">📄 Open PDF</a> : <a href={fileUrl("admin", x.id)} target="_blank" rel="noreferrer"><img src={fileUrl("admin", x.id)} alt={x.type} className="w-16 h-16 rounded-lg object-cover border border-line" /></a>}<div><p className="font-bold text-sm capitalize">{x.type.replace("_", " ")}</p><Chip tone={x.status === "verified" ? "green" : x.status === "rejected" ? "red" : "amber"}>{x.status}</Chip></div></div>
              <div className="flex gap-2"><button className="btn-dark btn-sm" onClick={() => review(x.id, "verified")}>Verify</button><button className="btn-ghost btn-sm !text-danger" onClick={() => review(x.id, "rejected")}>Reject</button></div>
            </div>))}
        </div>
        <div className="flex gap-2 flex-wrap items-center"><input className="input !w-72" placeholder="Reason (for reject / block)" value={reason} onChange={(e) => setReason(e.target.value)} />
          {d.status !== "approved" && d.status !== "blocked" && <button className="btn-primary btn-sm" disabled={busy} onClick={() => act("approve")}>Approve</button>}
          {d.status === "pending" && <button className="btn-ghost btn-sm !text-danger" disabled={busy} onClick={() => act("reject")}>Reject</button>}
          {d.status === "approved" && <button className="btn-ghost btn-sm !text-danger" disabled={busy} onClick={() => act("block")}>Block</button>}
          {d.status === "blocked" && <button className="btn-dark btn-sm" disabled={busy} onClick={() => act("unblock")}>Unblock</button>}</div>
        <div className="rounded-2xl border border-line p-4"><p className="font-extrabold mb-2">Recent trips</p>{d.trips.map((t: any) => <p key={t.id} className="text-sm py-1 border-t border-line first:border-0"><b>{t.code}</b> <StatusBadge s={t.status} /> <span className="text-xs text-steel">{money(t.fare)} · {fmtDate(t.created_at)}</span></p>)}{!d.trips.length && <p className="text-sm text-steel">No trips.</p>}</div>
      </div>
    </Sheet>
  );
}

export function Customers() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const list = usePoll(() => api<any[]>("admin", "/admin/customers", { query: { q } }), 10000, [q]);
  const act = async (id: number, a: string) => { try { await api("admin", `/admin/customers/${id}/${a}`, { method: "POST" }); toast("Updated", "ok"); list.reload(); } catch (e: any) { toast(e.message, "err"); } };
  return (
    <div>
      <PageHead title="Companies and customers"><input className="input !w-64" placeholder="Search name / company / phone" value={q} onChange={(e) => setQ(e.target.value)} /></PageHead>
      <Table loading={list.loading} rows={list.data} cols={[
        ["Customer", (r) => <span><b>{r.company || r.name}</b> {r.is_demo && <Chip tone="amber">demo</Chip>}<span className="block text-xs text-steel">{r.name} · {r.phone}</span></span>], ["GSTIN", (r) => r.gstin || "—"], ["Verified", (r) => (r.verified ? <Chip tone="green">verified</Chip> : <Chip tone="amber">pending</Chip>)],
        ["Bookings", (r) => r.bookings], ["COD used", (r) => r.cod_used], ["Credit", (r) => (r.credit ? `${r.credit.status} · ${money(r.credit.used)}/${money(r.credit.limit)}` : "—")], ["Status", (r) => <Chip tone={r.status === "active" ? "green" : "red"}>{r.status}</Chip>],
        ["Actions", (r) => <div className="flex gap-1.5 flex-wrap">{!r.verified ? <button className="btn-dark btn-sm" onClick={() => act(r.id, "verify")}>Verify</button> : <button className="btn-ghost btn-sm" onClick={() => act(r.id, "unverify")}>Unverify</button>}{r.status === "active" ? <button className="btn-ghost btn-sm !text-danger" onClick={() => act(r.id, "suspend")}>Suspend</button> : <button className="btn-ghost btn-sm" onClick={() => act(r.id, "activate")}>Activate</button>}<button className="btn-ghost btn-sm" onClick={() => act(r.id, "reset-cod")}>Reset COD</button></div>],
      ]} />
    </div>
  );
}
