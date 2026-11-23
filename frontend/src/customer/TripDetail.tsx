import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, fileUrl, openAuthed } from "../lib/api";
import { fmtDate, getPosition, km, money, PAY_LABEL, usePoll, useCountdown, ago } from "../lib/util";
import { useToast } from "../lib/session";
import MapView from "../components/MapView";
import { Chip, Loading, Photo, Row, Sheet, Spinner, StatusBadge, Warn } from "../components/ui";
import { PackageScene } from "../components/Truck3D";
import { FindingLoader } from "../components/Truck3D";
import { useI18n, Key } from "../lib/i18n";
import { ChatPanel, ComplaintCenter, ContactPanel, SosButton } from "../components/Shared";

const STEPS: [string, Key][] = [["driver_assigned", "ts.assigned"], ["driver_accepted", "ts.onway"], ["driver_reached", "fl.atPickup"], ["pickup_verified", "ts.pickedUp"], ["in_transit", "fl.transit"], ["delivery_pending", "fl.atDrop"], ["delivered", "fl.delivered"]];
const LIVE = ["driver_assigned", "driver_accepted", "driver_reached", "pickup_verified", "in_transit", "delivery_pending"];

function loadRazorpay(): Promise<boolean> {
  return new Promise((res) => {
    if ((window as any).Razorpay) return res(true);
    const s = document.createElement("script"); s.src = "https://checkout.razorpay.com/v1/checkout.js"; s.onload = () => res(true); s.onerror = () => res(false); document.body.appendChild(s);
  });
}

export default function TripDetail({ chatUnread }: { chatUnread: Record<string, number> }) {
  const { t } = useI18n();
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data: b, loading, reload } = usePoll(() => api("customer", `/customer/bookings/${id}`), 4000, [id]);
  const [chat, setChat] = useState(false);
  const [complaint, setComplaint] = useState(false);
  const [cancel, setCancel] = useState<any>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [rate, setRate] = useState({ rating: 0, comment: "", tip: 0 });
  const [fix, setFix] = useState<{ lat: number; lng: number } | null>(null);
  const [landmark, setLandmark] = useState("");
  const [cfg, setCfg] = useState<any>(null);
  useEffect(() => { api("customer", "/config").then(setCfg).catch(() => {}); }, []);
  const left = useCountdown(b?.expires_at);

  if (loading && !b) return <Loading />;
  if (!b) return <p className="text-center py-10 text-steel">Booking not found.</p>;
  const live = LIVE.includes(b.status);
  const idx = STEPS.findIndex(([s]) => s === b.status);
  const act = async (fn: () => Promise<any>, ok?: string) => { setBusy(true); try { await fn(); if (ok) toast(ok, "ok"); await reload(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); } };

  const pay = () => act(async () => {
    const o = await api("customer", `/customer/bookings/${b.id}/pay/order`, { method: "POST" });
    if (o.mode === "dev_simulated") { toast(t("ts.devSim")); await api("customer", `/customer/bookings/${b.id}/pay/dev-confirm`, { method: "POST" }); return; }
    if (!(await loadRazorpay())) throw new Error("Could not load Razorpay checkout. Check your internet.");
    await new Promise<void>((resolve, reject) => {
      const rz = new (window as any).Razorpay({ key: o.key_id, amount: o.amount, currency: o.currency, name: "HaulGo", description: o.description, order_id: o.order_id,
        theme: { color: "#A8651A" },
        handler: async (r: any) => { try { await api("customer", `/customer/bookings/${b.id}/pay/verify`, { body: r }); resolve(); } catch (e) { reject(e); } },
        modal: { ondismiss: () => reject(new Error("Payment cancelled. Your booking is held until the payment window ends.")) } });
      rz.open();
    });
  }, "Payment verified");

  const openCancel = async () => { try { setCancel(await api("customer", `/customer/bookings/${b.id}/cancel-preview`)); } catch (e: any) { toast(e.message, "err"); } };
  const doCancel = () => act(async () => { await api("customer", `/customer/bookings/${b.id}/cancel`, { body: { reason } }); setCancel(null); }, "Booking cancelled");
  const reply = (body: any) => act(async () => { await api("customer", `/pickup/${b.id}/reply`, { body }); setFix(null); setLandmark(""); }, "Sent to driver");
  const useMyLoc = async () => { try { const p = await getPosition(); setFix({ lat: p.lat, lng: p.lng }); } catch (e: any) { toast(e.message, "err"); } };
  const shareLink = async () => { const url = `${window.location.origin}${b.track_url}`; try { await navigator.clipboard.writeText(url); toast(t("ts.linkCopied"), "ok"); } catch { toast(url); } };
  const waitedMin = (Date.now() - new Date(b.created_at).getTime()) / 60000;

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between"><div><p className="text-xs text-steel font-semibold">{t("c.booking")}</p><h1 className="text-2xl font-extrabold">{b.code}</h1></div><StatusBadge s={b.status} /></div>

      {b.status === "awaiting_payment" && (
        <div className="card p-5 text-center space-y-3 border-brand/30">
          <PackageScene />
          <p className="font-extrabold text-lg">Complete payment to confirm</p>
          <p className="text-sm text-steel">Your booking is held for <b className="text-obsidian">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</b>. Unpaid bookings expire automatically.</p>
          {cfg?.payment_mode === "dev_simulated" && <Warn>DEV SIMULATION: Razorpay keys are not set. This button simulates a payment; no money moves.</Warn>}
          {cfg?.payment_mode === "razorpay_test" && <Warn>Razorpay TEST mode. Use test cards/UPI only.</Warn>}
          <button className="btn-primary w-full !py-3.5" disabled={busy || left === 0} onClick={pay}>{busy ? <Spinner /> : `Pay ${money(b.fare.total)}`}</button>
        </div>
      )}

      {b.status === "quotation_requested" && <div className="card p-5"><p className="font-extrabold">Quotation requested</p><p className="text-sm text-steel mt-1">Our team is reviewing your load and will send a price. You will be notified here.</p></div>}
      {b.status === "quotation_sent" && b.quotation && (
        <div className="card p-5 space-y-3 border-brand/30">
          <p className="font-extrabold">Your quotation</p><p className="text-3xl font-extrabold text-brand">{money(b.quotation.amount)}</p>{b.quotation.notes && <p className="text-sm text-steel">{b.quotation.notes}</p>}
          <div className="grid grid-cols-1 gap-2">
            {[["online", "Accept and pay online"], ["credit", "Accept · monthly credit"], ["cod", "Accept · cash on delivery"]].map(([m, l]) => <button key={m} className={m === "online" ? "btn-primary" : "btn-ghost"} disabled={busy} onClick={() => act(() => api("customer", `/customer/bookings/${b.id}/quotation`, { body: { accept: true, payment_method: m } }), "Quotation accepted")}>{l}</button>)}
            <button className="btn-ghost text-danger" disabled={busy} onClick={() => act(() => api("customer", `/customer/bookings/${b.id}/quotation`, { body: { accept: false } }), "Quotation rejected")}>Reject quotation</button>
          </div>
        </div>
      )}

      {b.status === "pending_assignment" && (
        <div className="card-dark p-5 text-center overflow-hidden">
          <FindingLoader className="h-44 -mt-2" />
          <p className="font-extrabold text-lg mt-1">{b.booking_mode === "scheduled" ? "Scheduled · driver will be assigned" : "Finding your driver"}</p>
          <p className="text-sm text-white/60 mt-1 max-w-xs mx-auto">{b.booking_mode === "scheduled" ? `Pickup ${fmtDate(b.scheduled_at)}. Our team assigns a verified driver before your trip.` : "We are matching a suitable verified driver. A driver is shown only after one is actually assigned and accepts."}</p>
          {b.booking_mode === "instant" && waitedMin > 10 && <div className="mt-4 text-left"><Warn>No driver has accepted yet. You can keep waiting, or cancel for a full refund (if paid). Heavy-vehicle drivers may be fewer in your area.</Warn></div>}
        </div>
      )}
      {b.status === "driver_assigned" && <div className="card p-4"><p className="font-extrabold">Driver assigned</p><p className="text-sm text-steel">Waiting for the driver to accept. If they do not respond, we will assign another.</p></div>}

      {live && b.status !== "driver_assigned" && b.driver && (
        <>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-obsidian text-white font-extrabold flex items-center justify-center">{(b.driver.name || "D")[0]}</div>
              <div className="flex-1"><p className="font-extrabold">{b.driver.name}</p><p className="text-xs text-steel">{b.driver.vehicle} · <b className="text-obsidian">{b.driver.reg_no}</b> · ★ {b.driver.rating || "New"}</p></div>
            </div>
            <div className="mt-3 flex gap-1 overflow-x-auto no-scrollbar">{STEPS.slice(1).map(([s, l], i) => <div key={s} className={`flex-1 min-w-[64px] text-center`}><div className={`h-1.5 rounded-full ${i + 1 <= idx ? "bg-brand" : "bg-line"}`} /><p className={`text-[10px] mt-1 font-semibold ${i + 1 === idx ? "text-brand" : "text-steel"}`}>{t(l)}</p></div>)}</div>
          </div>
          {b.status === "driver_reached" || b.status === "driver_accepted" ? (
            <div className="card-dark p-5 text-center"><p className="text-xs text-white/60 uppercase tracking-widest font-bold">{t("c.pickupOtp")}</p><p className="text-5xl font-extrabold tracking-[.3em] mt-1 pl-[.3em]">{b.pickup_otp}</p><p className="text-xs text-white/50 mt-2">{t("c.pickupOtpHint")}</p></div>
          ) : null}
          {b.status === "delivery_pending" && <div className="card-dark p-5 text-center"><p className="text-xs text-white/60 uppercase tracking-widest font-bold">{t("c.deliveryOtp")} · {b.receiver_name}</p><p className="text-5xl font-extrabold tracking-[.3em] mt-1 pl-[.3em]">{b.delivery_otp}</p><p className="text-xs text-white/50 mt-2">{t("c.deliveryOtpHint")}</p></div>}
          <div>
            <MapView height={280} pickup={{ lat: b.pickup_lat, lng: b.pickup_lng }} drop={{ lat: b.drop_lat, lng: b.drop_lng }} route={b.route} driver={b.driver.lat != null ? { lat: b.driver.lat, lng: b.driver.lng } : null} driverStale={b.driver.location_stale} />
            <p className={`text-xs mt-2 ${b.driver.location_stale ? "text-danger font-semibold" : "text-steel"}`}>{b.driver.lat == null ? "Waiting for the driver's first GPS update…" : b.driver.location_stale ? `Live location unavailable · last updated ${ago(b.driver.location_updated_at)}` : `Live · updated ${ago(b.driver.location_updated_at)}`}</p>
          </div>
          {b.pickup_help.help_requested_at && ["driver_accepted", "driver_reached"].includes(b.status) && (
            <div className="card p-4 border-brand space-y-3 bg-brand/5">
              <p className="font-extrabold text-danger">Driver cannot find the pickup location</p>
              <p className="text-sm">Share your exact pin or a landmark.</p>
              <MapView height={200} pickup={fix || { lat: b.pickup_lat, lng: b.pickup_lng }} pickMode="pickup" onPick={(p) => setFix(p)} />
              <div className="flex gap-2"><button className="btn-ghost btn-sm" onClick={useMyLoc}>📍 Use my location</button>{fix && <button className="btn-primary btn-sm" disabled={busy} onClick={() => reply(fix)}>Send this pin</button>}</div>
              <div className="flex gap-2"><input className="input" placeholder="Landmark, e.g. Blue gate near temple" value={landmark} onChange={(e) => setLandmark(e.target.value)} /><button className="btn-dark" disabled={!landmark.trim() || busy} onClick={() => reply({ landmark })}>Send</button></div>
            </div>
          )}
          <ContactPanel role="customer" booking={b} onChat={() => setChat(true)} unread={chatUnread[b.id] || 0} />
          <div className="card p-4"><p className="font-extrabold mb-2">Share tracking with receiver</p><div className="flex gap-2"><button className="btn-ghost btn-sm" onClick={shareLink}>🔗 Copy link</button></div></div>
        </>
      )}

      {(b.status === "delivered" || b.status === "completed") && (
        <div className="card p-5 text-center space-y-3">
          <PackageScene done />
          <p className="text-xl font-extrabold">Delivered successfully</p><p className="text-sm text-steel">{fmtDate(b.delivered_at)}</p>
          {b.delivery_proof?.length > 0 && <div className="flex gap-2 justify-center">{b.delivery_proof.map((p: number) => <Photo key={p} src={fileUrl("customer", p)} />)}</div>}
          {!b.rated ? (
            <div className="text-left space-y-3 border-t border-line pt-4">
              <p className="font-extrabold">Rate {b.driver?.name}</p>
              <div className="flex gap-1" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button key={n} role="radio" aria-checked={rate.rating === n} aria-label={`${n} stars`} onClick={() => setRate({ ...rate, rating: n })} className={`text-3xl ${n <= rate.rating ? "text-brand" : "text-line"}`}>★</button>)}</div>
              <input className="input" placeholder="Comment (optional)" maxLength={400} value={rate.comment} onChange={(e) => setRate({ ...rate, comment: e.target.value })} />
              <div className="flex items-center gap-2 flex-wrap"><span className="text-xs text-steel">Tip (paid directly to driver):</span>{[0, 20, 50, 100].map((t) => <button key={t} onClick={() => setRate({ ...rate, tip: t })} className={`chip !px-3 !py-1.5 ${rate.tip === t ? "bg-obsidian text-white" : "bg-offwhite"}`}>{t ? `₹${t}` : "No tip"}</button>)}</div>
              <button className="btn-primary w-full" disabled={!rate.rating || busy} onClick={() => act(() => api("customer", `/customer/bookings/${b.id}/rate`, { body: { ...rate, comment: rate.comment || null } }), "Thanks for your feedback")}>Submit rating</button>
            </div>
          ) : <Chip tone="green">You rated this trip</Chip>}
          <div className="grid grid-cols-2 gap-2"><button className="btn-ghost" onClick={() => openAuthed("customer", `/customer/bookings/${b.id}/invoice`).catch((e) => toast(e.message, "err"))}>🧾 Invoice PDF</button>
            <button className="btn-dark" onClick={async () => { const r = await api("customer", `/customer/bookings/${b.id}/rebook`); nav("/customer/book", { state: { rebook: r } }); }}>↻ Book again</button></div>
        </div>
      )}

      {(b.status === "cancelled" || b.status === "refund_pending" || b.status === "refunded") && (
        <div className="card p-5 space-y-2"><p className="font-extrabold">Booking cancelled</p><p className="text-sm text-steel">{b.cancel_reason}</p>{b.fare.cancel_fee > 0 && <Row k="Cancellation fee" v={money(b.fare.cancel_fee)} />}
          {b.refund && <div className="rounded-xl bg-offwhite p-3 text-sm"><Row k="Refund amount" v={money(b.refund.amount)} /><Row k="Refund status" v={<Chip tone={b.refund.status === "completed" ? "green" : b.refund.status === "failed" ? "red" : "amber"}>{b.refund.status}</Chip>} /><p className="text-[11px] text-steel mt-1">{b.refund.status === "completed" ? "Confirmed by the payment provider." : "We mark a refund completed only after the payment provider confirms it."}</p></div>}
          <button className="btn-dark w-full mt-2" onClick={async () => { const r = await api("customer", `/customer/bookings/${b.id}/rebook`); nav("/customer/book", { state: { rebook: r } }); }}>↻ Book this trip again</button></div>
      )}

      <div className="card p-4">
        <p className="font-extrabold mb-2">Trip details</p>
        <Row k="Pickup" v={<span className="text-xs inline-block max-w-[62%]">{b.pickup_address}</span>} /><Row k="Drop" v={<span className="text-xs inline-block max-w-[62%]">{b.drop_address}</span>} />
        <Row k="Distance" v={km(b.distance_km)} /><Row k="Vehicle" v={b.vehicle_type?.name} /><Row k="Goods" v={`${b.goods.description} · ${b.goods.weight_kg} kg`} /><Row k="Receiver" v={b.receiver_name} />
        {(b.pickup_help.landmark || b.pickup_help.gate || b.pickup_help.entry) && <div className="mt-2 rounded-xl bg-offwhite p-3 text-xs space-y-0.5"><p className="font-bold">Pickup instructions</p>{[b.pickup_help.landmark, b.pickup_help.gate, b.pickup_help.floor, b.pickup_help.entry].filter(Boolean).map((x: string, i: number) => <p key={i}>{x}</p>)}</div>}
        {b.photos?.length > 0 && <div className="flex gap-2 mt-3 overflow-x-auto">{b.photos.map((p: number) => <Photo key={p} src={fileUrl("customer", p)} />)}</div>}
      </div>
      <div className="card p-4">
        <p className="font-extrabold mb-2">Fare and payment</p>
        {b.fare.total > 0 ? <>
          <Row k="Base fare" v={money(b.fare.base)} /><Row k="Distance charge" v={money(b.fare.distance)} />{b.fare.night > 0 && <Row k="Night charge" v={money(b.fare.night)} />}{b.fare.helper > 0 && <Row k="Loading helper" v={money(b.fare.helper)} />}{b.fare.special > 0 && <Row k="Special handling" v={money(b.fare.special)} />}
          <div className="border-t border-line mt-1 pt-1"><Row k={<b className="text-obsidian">Total</b>} v={<b className="text-brand text-base">{money(b.fare.total)}</b>} /></div></> : <p className="text-sm text-steel">Price will be set by quotation.</p>}
        <Row k="Method" v={PAY_LABEL[b.payment_method] || b.payment_method} /><Row k="Status" v={<Chip tone={b.payment_status === "paid" || b.payment_status === "credit_billed" ? "green" : "amber"}>{b.payment_status.replace("_", " ")}</Chip>} />
        {b.payment_method === "cod" && <p className="text-[11px] text-steel mt-1">Pay the driver in cash on delivery.</p>}
      </div>
      <div className="card p-4"><p className="font-extrabold mb-2">Timeline</p><ol className="space-y-2">{b.history.map((h: any, i: number) => <li key={i} className="flex gap-3 text-sm"><span className="w-2 h-2 rounded-full bg-brand mt-1.5 shrink-0" /><span><b>{h.to.replace(/_/g, " ")}</b> <span className="text-steel text-xs">{fmtDate(h.at)}{h.note ? ` · ${h.note}` : ""}</span></span></li>)}</ol></div>

      <div className="flex gap-2">
        <button className="btn-ghost flex-1" onClick={() => setComplaint(true)}>Help / complaint</button>
        {["quotation_requested", "quotation_sent", "awaiting_payment", "pending_assignment", "driver_assigned", "driver_accepted", "driver_reached"].includes(b.status) && <button className="btn-ghost flex-1 !text-danger" onClick={openCancel}>Cancel booking</button>}
      </div>
      {live && <SosButton role="customer" bookingId={b.id} />}
      {chat && <ChatPanel role="customer" bookingId={b.id} onClose={() => setChat(false)} />}
      {complaint && <ComplaintCenter role="customer" bookingId={b.id} onClose={() => setComplaint(false)} />}
      <Sheet open={!!cancel} onClose={() => setCancel(null)} title="Cancel this booking?">
        {cancel && (cancel.can_cancel ? (
          <div className="space-y-3">
            {cancel.fee > 0 ? <Warn tone="red">A cancellation fee of <b>{money(cancel.fee)}</b> applies because the driver is already on the way.{cancel.refund_estimate > 0 && <> Estimated refund: <b>{money(cancel.refund_estimate)}</b>.</>}</Warn> : <Warn>No cancellation fee at this stage.{cancel.refund_estimate > 0 && <> Full refund of {money(cancel.refund_estimate)} will be requested.</>}</Warn>}
            <input className="input" placeholder="Reason for cancelling" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
            <button className="btn-primary w-full" disabled={busy || reason.trim().length < 3} onClick={doCancel}>{busy ? <Spinner /> : "Confirm cancellation"}</button>
          </div>
        ) : <Warn>This booking can no longer be cancelled online. Please contact support.</Warn>)}
      </Sheet>
      <Link to="/customer/trips" className="block text-center text-sm text-steel font-semibold">← All trips</Link>
    </div>
  );
}
