import { useState } from "react";
import { api, fileUrl } from "../lib/api";
import { fmtDate, km, money, usePoll, PAY_LABEL } from "../lib/util";
import { useToast } from "../lib/session";
import { Chip, Field, Loading, Photo, Row, Sheet, Spinner, StatusBadge, Warn } from "../components/ui";
import MapView from "../components/MapView";
import { PageHead, Table } from "./kit";

const STATUSES = ["quotation_requested", "quotation_sent", "awaiting_payment", "pending_assignment", "driver_assigned", "driver_accepted", "driver_reached", "pickup_verified", "in_transit", "delivery_pending", "delivered", "completed", "cancelled", "refund_pending", "refunded"];

export function Bookings() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const list = usePoll(() => api<any[]>("admin", "/admin/bookings", { query: { status, q, date_from: from, date_to: to } }), 8000, [status, q, from, to]);
  return (
    <div>
      <PageHead title="Bookings">
        <input className="input !w-48" placeholder="Search code / company" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input !w-52" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select>
        <input type="date" className="input !w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /><input type="date" className="input !w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
      </PageHead>
      <Table loading={list.loading} rows={list.data} onRow={(r) => setOpen(r.id)} empty="No bookings match" cols={[
        ["Code", (r) => <b>{r.code}</b>], ["Status", (r) => <StatusBadge s={r.status} />], ["Customer", (r) => r.customer], ["Route", (r) => <span className="text-xs">{r.pickup?.slice(0, 32)} → {r.drop?.slice(0, 32)}</span>],
        ["Vehicle", (r) => r.vehicle], ["Driver", (r) => r.driver || "—"], ["Fare", (r) => (r.fare ? money(r.fare) : "Quote")], ["Pay", (r) => <span className="text-xs">{r.payment_method?.toUpperCase()} · {r.payment_status.replace("_", " ")}</span>], ["Created", (r) => <span className="text-xs">{fmtDate(r.created_at)}</span>],
      ]} />
      {open && <BookingDrawer id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </div>
  );
}

function BookingDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { data: b, reload } = usePoll(() => api("admin", `/admin/bookings/${id}`), 5000, [id]);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState({ amount: "", notes: "" });
  const [reason, setReason] = useState("");
  const [chat, setChat] = useState<any>(null);
  const act = async (fn: () => Promise<any>, ok: string) => { setBusy(true); try { await fn(); toast(ok, "ok"); await reload(); onChanged(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); } };
  if (!b) return <Sheet open onClose={onClose} title="Booking" wide><Loading /></Sheet>;
  const canAssign = ["pending_assignment", "driver_assigned"].includes(b.status);
  const canCancel = !["completed", "cancelled", "refunded", "refund_pending", "delivered"].includes(b.status);
  return (
    <Sheet open onClose={onClose} title={`${b.code}`} wide>
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap"><StatusBadge s={b.status} /><Chip>{b.booking_mode}</Chip><Chip>{b.pricing_mode}</Chip>{b.pickup_help.help_requested_at && <Chip tone="amber">Driver cannot find pickup</Chip>}{b.distance_source !== "osrm" && <Chip tone="amber">distance estimated</Chip>}</div>
        <MapView height={200} pickup={{ lat: b.pickup_lat, lng: b.pickup_lng }} drop={{ lat: b.drop_lat, lng: b.drop_lng }} route={b.route} driver={b.driver?.lat != null ? { lat: b.driver.lat, lng: b.driver.lng } : null} driverStale={b.driver?.location_stale} />
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-line p-4"><p className="font-extrabold mb-1">Customer and trip</p>
            <Row k="Customer" v={`${b.customer.company || b.customer.name}`} /><Row k="Phone" v={b.customer.phone} /><Row k="Receiver" v={`${b.receiver_name} · ${b.receiver_phone}`} /><Row k="Pickup" v={<span className="text-xs inline-block max-w-[65%]">{b.pickup_address}</span>} /><Row k="Drop" v={<span className="text-xs inline-block max-w-[65%]">{b.drop_address}</span>} /><Row k="Distance" v={km(b.distance_km)} /><Row k="Vehicle" v={b.vehicle_type?.name} />{b.scheduled_at && <Row k="Scheduled" v={fmtDate(b.scheduled_at)} />}
            {(b.pickup_help.landmark || b.pickup_help.entry) && <p className="text-xs bg-offwhite rounded-lg p-2 mt-2">📍 {[b.pickup_help.landmark, b.pickup_help.gate, b.pickup_help.floor, b.pickup_help.entry].filter(Boolean).join(" · ")}</p>}</div>
          <div className="rounded-2xl border border-line p-4"><p className="font-extrabold mb-1">Goods</p>
            <Row k="Category" v={b.goods.category.replace(/_/g, " ")} /><Row k="Description" v={b.goods.description} /><Row k="Weight / qty" v={`${b.goods.weight_kg} kg · ${b.goods.quantity} · ${b.goods.packages} pkgs`} /><Row k="Dimensions" v={[b.goods.length_cm, b.goods.width_cm, b.goods.height_cm].filter(Boolean).join(" × ") || "—"} />{b.goods.handling && <Row k="Handling" v={b.goods.handling} />}{b.goods.loading_notes && <Row k="Loading" v={b.goods.loading_notes} />}<Row k="Helper" v={b.goods.helper_needed ? "Yes" : "No"} />
            {b.photos.length > 0 && <div className="flex gap-2 mt-2 flex-wrap">{b.photos.map((p: any) => <div key={p.id} className="text-center"><Photo src={fileUrl("admin", p.id)} /><span className="text-[10px] text-steel">{p.kind.replace("_", " ")}</span></div>)}</div>}</div>
          <div className="rounded-2xl border border-line p-4"><p className="font-extrabold mb-1">Money</p>
            <Row k="Fare total" v={<b>{b.fare.total ? money(b.fare.total) : "Awaiting quotation"}</b>} /><Row k="Commission" v={money(b.commission)} /><Row k="Driver share" v={money(b.driver_share)} /><Row k="Payment" v={PAY_LABEL[b.payment_method]} /><Row k="Status" v={b.payment_status.replace("_", " ")} />{b.fare.cancel_fee > 0 && <Row k="Cancel fee" v={money(b.fare.cancel_fee)} />}
            {b.payments.map((p: any) => <p key={p.id} className="text-xs text-steel">Payment #{p.id}: {money(p.amount)} · {p.status} · {p.mode}{p.provider_payment_id ? ` · ${p.provider_payment_id}` : ""}</p>)}{b.refunds.map((r: any) => <p key={r.id} className="text-xs text-steel">Refund #{r.id}: {money(r.amount)} · {r.status}</p>)}</div>
          <div className="rounded-2xl border border-line p-4"><p className="font-extrabold mb-1">Driver</p>{b.driver ? <><Row k="Name" v={b.driver.name} /><Row k="Phone" v={b.driver.phone} /><Row k="Vehicle" v={`${b.driver.vehicle} · ${b.driver.reg_no}`} /></> : <p className="text-sm text-steel">Not assigned.</p>}
            <p className="text-xs font-bold mt-2 text-steel uppercase">Assignment history</p>{b.assignments.map((a: any, i: number) => <p key={i} className="text-xs">Driver #{a.driver_id} · {a.status} · {a.by} · {fmtDate(a.at)}</p>)}</div>
        </div>

        {b.status === "quotation_requested" || b.status === "quotation_sent" ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-3"><p className="font-extrabold">Quotation {b.quotation && <Chip tone="amber">last sent {money(b.quotation.amount)} · {b.quotation.status}</Chip>}</p>
            <div className="grid sm:grid-cols-3 gap-3"><Field label="Amount (₹)"><input className="input" type="number" value={quote.amount} onChange={(e) => setQuote({ ...quote, amount: e.target.value })} /></Field><div className="sm:col-span-2"><Field label="Notes to customer"><input className="input" value={quote.notes} onChange={(e) => setQuote({ ...quote, notes: e.target.value })} /></Field></div></div>
            <button className="btn-primary" disabled={busy || !Number(quote.amount)} onClick={() => act(() => api("admin", `/admin/bookings/${id}/quotation`, { body: { amount: Number(quote.amount), notes: quote.notes || null } }), "Quotation sent")}>Send quotation</button></div>
        ) : null}

        {canAssign && (
          <div className="rounded-2xl border border-line p-4 space-y-3"><p className="font-extrabold">Driver recommendations <span className="text-xs font-medium text-steel">(system suggests, admin decides)</span></p>
            {!b.recommendations.length && <Warn>No suitable online driver found (vehicle type, capacity, availability, radius). Drivers who are offline, busy, over COD-dues limit or without a location are excluded.</Warn>}
            {b.recommendations.map((r: any, i: number) => (
              <div key={r.driver_id} className="flex items-center justify-between gap-3 rounded-xl bg-offwhite p-3">
                <div><p className="font-bold text-sm">{i === 0 && <Chip tone="red">Best match</Chip>} {r.name} · {r.reg_no}</p><p className="text-xs text-steel">{r.vehicle} · {r.capacity_kg} kg · {r.distance_km != null ? `${r.distance_km} km from pickup` : "location unknown"} · ★ {r.rating || "new"} {r.online ? "· online" : "· offline"}</p></div>
                <button className="btn-dark btn-sm" disabled={busy} onClick={() => act(() => api("admin", `/admin/bookings/${id}/assign`, { body: { driver_id: r.driver_id } }), "Offer sent to driver")}>{b.status === "driver_assigned" ? "Reassign" : "Assign"}</button>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-2xl border border-line p-4"><p className="font-extrabold mb-2">Status history</p><ol className="space-y-1.5">{b.history.map((h: any, i: number) => <li key={i} className="text-sm"><b>{h.to.replace(/_/g, " ")}</b> <span className="text-xs text-steel">{fmtDate(h.at)}{h.note ? ` · ${h.note}` : ""}</span></li>)}</ol></div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-ghost btn-sm" onClick={async () => { try { setChat(await api("admin", `/admin/chat/${id}`)); } catch (e: any) { toast(e.message, "err"); } }}>💬 View chat (audited)</button>
          {canCancel && <><input className="input !w-64" placeholder="Cancellation reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} /><button className="btn-ghost btn-sm !text-danger" disabled={busy || !reason.trim()} onClick={() => act(() => api("admin", `/admin/bookings/${id}/cancel`, { body: { reason } }), "Booking cancelled")}>Cancel booking</button></>}
        </div>
        {chat && <div className="rounded-2xl bg-obsidian text-white p-4 max-h-72 overflow-auto space-y-1.5 text-sm"><p className="font-bold">Chat investigation · access logged</p>{chat.messages.map((m: any) => <p key={m.id}><span className="text-white/50 text-xs">{fmtDate(m.at)} · {m.from}:</span> {m.kind === "location" ? `📍 ${m.lat},${m.lng}` : m.body}</p>)}{!chat.messages.length && <p className="text-white/50">No messages.</p>}</div>}
      </div>
    </Sheet>
  );
}
