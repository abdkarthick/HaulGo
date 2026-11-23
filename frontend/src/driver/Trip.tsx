import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, fileUrl } from "../lib/api";
import { fmtDate, getPosition, km, money, usePoll } from "../lib/util";
import { useToast } from "../lib/session";
import MapView from "../components/MapView";
import { Chip, Loading, Photo, Row, Sheet, Spinner, StatusBadge, Warn } from "../components/ui";
import { PackageScene } from "../components/Truck3D";
import { ChatPanel, ComplaintCenter, ContactPanel, SosButton } from "../components/Shared";

import { useI18n, Key } from "../lib/i18n";

const nav = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
const FLOW: [string, Key][] = [["driver_accepted", "fl.toPickup"], ["driver_reached", "fl.atPickup"], ["pickup_verified", "fl.loaded"], ["in_transit", "fl.transit"], ["delivery_pending", "fl.atDrop"], ["delivered", "fl.delivered"], ["completed", "fl.done"]];

function OtpBox({ label, onSubmit, busy }: { label: string; onSubmit: (otp: string) => void; busy: boolean }) {
  const [v, setV] = useState("");
  return (
    <div className="space-y-3">
      <input className="input text-center text-4xl font-extrabold tracking-[.4em] !py-4" inputMode="numeric" maxLength={4} value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ""))} placeholder="••••" aria-label={label} />
      <button className="btn-primary w-full !py-4 text-base" disabled={busy || v.length !== 4} onClick={() => onSubmit(v)}>{busy ? <Spinner /> : label}</button>
    </div>
  );
}

export default function Trip({ chatUnread, reload }: { chatUnread: Record<string, number>; reload: () => void }) {
  const { id } = useParams();
  const go = useNavigate();
  const { t } = useI18n();
  const toast = useToast();
  const { data: b, loading, reload: rl } = usePoll(() => api("driver", `/driver/trips/${id}`), 4000, [id]);
  const [busy, setBusy] = useState(false);
  const [chat, setChat] = useState(false);
  const [complaint, setComplaint] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState("");
  const [help, setHelp] = useState(false);
  if (loading && !b) return <Loading />;
  if (!b) return <p className="text-center text-steel py-10">{t("tp.notFound")}</p>;
  const act = async (fn: () => Promise<any>, ok?: string) => { setBusy(true); try { await fn(); if (ok) toast(ok, "ok"); await rl(); reload(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); } };
  const post = (p: string, body?: any, ok?: string) => act(() => api("driver", `/driver/trips/${b.id}/${p}`, { method: "POST", body }), ok);
  const upload = (p: string, f?: File) => { if (!f) return; const form = new FormData(); form.append("file", f); act(() => api("driver", `/driver/trips/${b.id}/${p}`, { form }), "Photo uploaded"); };
  const idx = FLOW.findIndex(([s]) => s === b.status);
  const toPickup = ["driver_accepted", "driver_reached"].includes(b.status);
  const target = toPickup ? { lat: b.pickup_lat, lng: b.pickup_lng } : { lat: b.drop_lat, lng: b.drop_lng };
  const cannotFind = async () => { setBusy(true); let q: any = {}; try { const p = await getPosition(5000); q = { lat: p.lat, lng: p.lng }; } catch { /* send without location */ } try { await api("driver", `/pickup/${b.id}/cannot-find`, { method: "POST", query: q }); toast(t("tp.alerted"), "ok"); setHelp(false); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); } };
  const active = !["completed", "cancelled", "refunded", "refund_pending"].includes(b.status);
  const ph = b.pickup_help;
  const photoIds: number[] = b.goods_photo_ids || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><div><p className="text-xs text-steel font-semibold">{t("tr.trip")}</p><h1 className="text-2xl font-extrabold">{b.code}</h1></div><StatusBadge s={b.status} /></div>
      {idx >= 0 && <div className="flex gap-1">{FLOW.map(([s, l], i) => <div key={s} className="flex-1"><div className={`h-1.5 rounded-full ${i <= idx ? "bg-brand" : "bg-line"}`} /><p className={`text-[10px] mt-1 text-center font-semibold ${i === idx ? "text-brand" : "text-steel"}`}>{t(l)}</p></div>)}</div>}

      {["driver_accepted", "driver_reached", "pickup_verified", "in_transit", "delivery_pending"].includes(b.status) && (
        <>
          <MapView height={220} pickup={{ lat: b.pickup_lat, lng: b.pickup_lng }} drop={{ lat: b.drop_lat, lng: b.drop_lng }} route={b.route} />
          <a className="btn-dark w-full !py-4 text-base" href={nav(target.lat, target.lng)} target="_blank" rel="noreferrer">🧭 {toPickup ? t("tr.navPickup") : t("tr.navDrop")}</a>
        </>
      )}

      {/* ---- primary action card */}
      {b.status === "driver_accepted" && <div className="card p-4 space-y-3"><p className="font-extrabold">{t("tr.headToPickup")}</p><button className="btn-primary w-full !py-4 text-base" disabled={busy} onClick={() => post("reached", undefined, "Customer notified")}>{busy ? <Spinner /> : t("tr.reached")}</button></div>}
      {b.status === "driver_reached" && (
        <div className="card p-4 space-y-4"><div><p className="font-extrabold">{t("tr.verifyPickup")}</p><p className="text-sm text-steel">{t("tr.askOtp")}</p></div>
          <OtpBox label={t("tr.verifyLoad")} busy={busy} onSubmit={(otp) => post("verify-pickup", { otp }, t("tp.pickupVerified"))} />
          <label className="btn-ghost w-full cursor-pointer">📷 {t("tr.pickupPhoto")}<input type="file" hidden accept="image/*" capture="environment" onChange={(e) => upload("pickup-photo", e.target.files?.[0])} /></label>
        </div>
      )}
      {b.status === "pickup_verified" && <div className="card p-4 space-y-3"><p className="font-extrabold">{t("tp.goodsLoaded")}</p><label className="btn-ghost w-full cursor-pointer">📷 {t("tp.addPickupPhoto")}<input type="file" hidden accept="image/*" capture="environment" onChange={(e) => upload("pickup-photo", e.target.files?.[0])} /></label><button className="btn-primary w-full !py-4 text-base" disabled={busy} onClick={() => post("start", undefined, t("tp.tripStarted"))}>{t("tp.startTrip")}</button></div>}
      {b.status === "in_transit" && <div className="card p-4 space-y-3"><p className="font-extrabold">{t("tp.deliveringTo", { name: b.receiver_name })}</p><button className="btn-primary w-full !py-4 text-base" disabled={busy} onClick={() => post("arrived-drop", undefined, t("tp.receiverNotified"))}>{t("tr.arrivedDrop")}</button></div>}
      {b.status === "delivery_pending" && (
        <div className="card p-4 space-y-4">
          <div><p className="font-extrabold">{t("tr.completeDelivery")}</p><p className="text-sm text-steel">{t("tp.deliverySteps", { name: b.receiver_name })}</p></div>
          {!b.delivery_otp_verified ? <OtpBox label={t("tr.verifyDeliveryOtp")} busy={busy} onSubmit={(otp) => post("verify-delivery", { otp }, t("tp.otpOk"))} /> : <Chip tone="green">✓ {t("tr.otpVerified")}</Chip>}
          <label className="btn-ghost w-full cursor-pointer">📷 {t("tr.proofPhoto")}<input type="file" hidden accept="image/*" capture="environment" onChange={(e) => upload("delivery-proof", e.target.files?.[0])} /></label>
          <div className="flex gap-2">{(b.photos || []).length > 0 && (b.photos as number[]).map((p) => <Photo key={p} src={fileUrl("driver", p)} />)}</div>
          <button className="btn-primary w-full !py-4 text-base" disabled={busy || !b.delivery_otp_verified} onClick={() => post("deliver", undefined, t("tp.markedDelivered"))}>{t("tr.markDelivered")}</button>
        </div>
      )}
      {b.status === "delivered" && (
        <div className="card p-5 space-y-3 text-center"><PackageScene done /><p className="font-extrabold text-lg">{t("tr.delivered")}</p>
          {b.collect_cash > 0 ? <Warn tone="dark">{t("tp.collectCash", { amount: money(b.collect_cash), fee: money(b.fare.commission) })}</Warn> : <p className="text-sm text-steel">{t("tp.shareCredited", { amount: money(b.fare.driver_share) })}</p>}
          <button className="btn-primary w-full !py-4 text-base" disabled={busy} onClick={() => post("complete", undefined, t("tp.tripCompleted"))}>{b.collect_cash > 0 ? t("tp.collectedComplete") : t("tr.completeTrip")}</button></div>
      )}
      {b.status === "completed" && <div className="card p-5 text-center space-y-2"><PackageScene done /><p className="text-xl font-extrabold">{t("tr.completed")}</p><p className="text-2xl font-extrabold text-brand">{money(b.fare.driver_share)}</p><p className="text-xs text-steel">{b.payment_method === "cod" ? t("tp.cashDone") : t("tp.credited")}</p><Link to="/driver" className="btn-dark w-full">{t("tp.backHome")}</Link></div>}
      {["cancelled", "refund_pending", "refunded"].includes(b.status) && <Warn tone="red">{t("tp.cancelledMsg")} {b.cancel_reason}</Warn>}

      {/* ---- pickup help + contact */}
      {toPickup && (
        <div className="card p-4 space-y-3">
          <p className="font-extrabold">{t("tp.pickupDetails")}</p>
          {(ph.landmark || ph.gate || ph.floor || ph.entry) ? <div className="rounded-xl bg-offwhite p-3 text-sm space-y-0.5">{[ph.landmark, ph.gate, ph.floor, ph.entry].filter(Boolean).map((x: string, i: number) => <p key={i}>📍 {x}</p>)}</div> : <p className="text-sm text-steel">{t("tp.noLandmark")}</p>}
          {b.pickup_photo_ids?.length > 0 && <div className="flex gap-2">{b.pickup_photo_ids.map((p: number) => <Photo key={p} src={fileUrl("driver", p)} />)}</div>}
          <button className="btn w-full !py-4 bg-brand/10 text-brand border border-brand/30" onClick={() => setHelp(true)}>❓ {t("tr.cantFind")}</button>
        </div>
      )}
      {active && b.status !== "driver_assigned" && <ContactPanel role="driver" booking={b} onChat={() => setChat(true)} unread={chatUnread[b.id] || 0} />}

      <div className="card p-4">
        <p className="font-extrabold mb-2">{t("tr.loadRoute")}</p>
        <Row k={t("tp.customer")} v={b.customer_name} /><Row k={t("tp.receiver")} v={b.receiver_name} /><Row k={t("tp.pickup")} v={<span className="text-xs inline-block max-w-[62%]">{b.pickup_address}</span>} /><Row k={t("tp.drop")} v={<span className="text-xs inline-block max-w-[62%]">{b.drop_address}</span>} />
        <Row k={t("tp.distance")} v={km(b.distance_km)} /><Row k={t("tp.goods")} v={`${b.goods.description} · ${b.goods.weight_kg} kg · ${b.goods.packages} pkgs`} />
        {b.goods.handling && <Row k={t("tp.handling")} v={b.goods.handling} />}{b.goods.loading_notes && <Row k={t("tp.loading")} v={b.goods.loading_notes} />}{b.goods.helper_needed && <Row k={t("tp.helper")} v={t("tp.helperVal")} />}
        <Row k={t("tp.yourEarning")} v={<b className="text-brand">{money(b.fare.driver_share)}</b>} /><Row k={t("tp.payment")} v={b.payment_method === "cod" ? t("tp.codCollect", { amount: money(b.collect_cash) }) : b.payment_method === "credit" ? t("tp.credit") : t("tp.paidOnline")} />
        {photoIds.length > 0 && <div className="flex gap-2 mt-3">{photoIds.map((p) => <Photo key={p} src={fileUrl("driver", p)} />)}</div>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button className="btn-ghost" onClick={() => setComplaint(true)}>{t("tr.helpComplaint")}</button>
        <a className="btn-ghost" href="tel:+918148769354">📞 {t("tr.contactAdmin")}</a>
      </div>
      {["driver_accepted", "driver_reached"].includes(b.status) && <button className="btn-ghost w-full !text-danger" onClick={() => setCancel(true)}>{t("tr.cancel")}</button>}
      {active && <SosButton role="driver" bookingId={b.id} />}
      {chat && <ChatPanel role="driver" bookingId={b.id} onClose={() => setChat(false)} />}
      {complaint && <ComplaintCenter role="driver" bookingId={b.id} onClose={() => setComplaint(false)} />}
      <Sheet open={help} onClose={() => setHelp(false)} title={t("tp.cantFindTitle")}><div className="space-y-3"><p className="text-sm text-steel">{t("tp.cantFindBody")}</p><button className="btn-primary w-full !py-4" disabled={busy} onClick={cannotFind}>{busy ? <Spinner /> : t("tp.alertNow")}</button><a className="btn-ghost w-full" href={nav(b.pickup_lat, b.pickup_lng)} target="_blank" rel="noreferrer">🧭 {t("tp.openNav")}</a></div></Sheet>
      <Sheet open={cancel} onClose={() => setCancel(false)} title={t("tp.cancelTitle")}><div className="space-y-3"><Warn>{t("tp.cancelWarn")}</Warn><input className="input" placeholder={t("tp.reason")} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /><button className="btn-primary w-full" disabled={busy || reason.trim().length < 3} onClick={() => act(async () => { await api("driver", `/driver/trips/${b.id}/cancel`, { body: { reason } }); go("/driver"); }, t("tp.tripCancelled"))}>{t("tp.confirmCancel")}</button></div></Sheet>
    </div>
  );
}
