import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { CATEGORIES, PAY_LABEL, getPosition, km, money } from "../lib/util";
import { useToast } from "../lib/session";
import { useI18n } from "../lib/i18n";
import MapView, { Pt } from "../components/MapView";
import { Chip, Field, Loading, Row, Spinner, Warn } from "../components/ui";
import { TruckSvg } from "../components/SvgArt";
import { VehicleViewer } from "../components/Truck3D";

type Place = { address: string; lat: number; lng: number } | null;
const emptyGoods = { category: "finished_products", description: "", quantity: 1, weight_kg: "" as any, length_cm: "" as any, width_cm: "" as any, height_cm: "" as any, packages: 1, handling: "", loading_notes: "", helper_needed: false, special_handling: false, receiver_name: "", receiver_phone: "" };

function PlaceInput({ label, value, onChange, saved, onUseMap, active, withGps }: { label: string; value: Place; onChange: (p: Place) => void; saved: any[]; onUseMap: () => void; active: boolean; withGps?: boolean }) {
  const L = useI18n();
  const toast = useToast();
  const [q, setQ] = useState(value?.address || "");
  const [res, setRes] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const t = useRef<any>();
  useEffect(() => { setQ(value?.address || ""); }, [value?.address]);
  const search = (s: string) => {
    setQ(s); clearTimeout(t.current);
    if (s.trim().length < 3) return setRes([]);
    t.current = setTimeout(async () => { try { const r = await api("customer", "/geo/search", { query: { q: s } }); setRes(r.results); if (r.error) toast(r.error); } catch { /* ignore */ } }, 500);
  };
  const gps = async () => {
    setBusy(true);
    try { const p = await getPosition(); const r = await api("customer", "/geo/reverse", { query: { lat: p.lat, lng: p.lng } }); onChange({ address: r.address, lat: p.lat, lng: p.lng }); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <div className={`rounded-2xl border p-3 ${active ? "border-obsidian shadow-glow" : "border-line"}`}>
      <div className="flex items-center justify-between"><span className="label !mb-0">{label}</span>
        <div className="flex gap-1.5">{withGps && <button className="chip bg-offwhite" onClick={gps} disabled={busy}>{busy ? "…" : `📍 ${L.t("bk.myLoc")}`}</button>}<button className={`chip ${active ? "bg-obsidian text-white" : "bg-offwhite"}`} onClick={onUseMap}>🗺 {L.t("bk.pickMap")}</button></div></div>
      <input className="input mt-2" placeholder={L.t("bk.search")} value={q} onChange={(e) => search(e.target.value)} />
      {res.length > 0 && <ul className="mt-2 rounded-xl border border-line divide-y divide-line max-h-44 overflow-auto">{res.map((r, i) => <li key={i}><button className="w-full text-left text-sm p-2.5 hover:bg-offwhite" onClick={() => { onChange({ address: r.label, lat: r.lat, lng: r.lng }); setRes([]); }}>{r.label}</button></li>)}</ul>}
      {saved.length > 0 && <div className="flex gap-1.5 mt-2 overflow-x-auto no-scrollbar">{saved.map((s) => <button key={s.id} className="chip bg-offwhite whitespace-nowrap" onClick={() => onChange({ address: s.address, lat: s.lat, lng: s.lng })}>★ {s.label}</button>)}</div>}
    </div>
  );
}

export default function Book() {
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const loc = useLocation() as any;
  const rebook = loc.state?.rebook;
  const [step, setStep] = useState(0);
  const [pickup, setPickup] = useState<Place>(rebook?.pickup || loc.state?.pickup || null);
  const [drop, setDrop] = useState<Place>(rebook?.drop || null);
  const [pickMode, setPickMode] = useState<"pickup" | "drop" | null>(null);
  const [saved, setSaved] = useState<any[]>([]);
  const [mode, setMode] = useState<"instant" | "scheduled">(loc.state?.mode === "scheduled" ? "scheduled" : "instant");
  const [when, setWhen] = useState("");
  const [goods, setGoods] = useState<any>(rebook ? { ...emptyGoods, ...rebook.goods } : { ...emptyGoods, weight_kg: loc.state?.weight ?? "" });
  const [photos, setPhotos] = useState<File[]>([]);
  const [help, setHelp] = useState<any>(rebook?.pickup_help || { landmark: "", gate: "", floor: "", entry: "" });
  const [helpPhoto, setHelpPhoto] = useState<File | null>(null);
  const [est, setEst] = useState<any>(null);
  const [estBusy, setEstBusy] = useState(false);
  const [vid, setVid] = useState<number | null>(rebook?.vehicle_type_id || loc.state?.vehicle || null);
  const [pay, setPay] = useState("online");
  const [busy, setBusy] = useState(false);
  const [first, setFirst] = useState(false);

  useEffect(() => { api("customer", "/locations").then(setSaved).catch(() => {}); }, []);
  useEffect(() => { // auto-detect pickup after permission (first visit)
    if (pickup || first) return; setFirst(true);
    getPosition(5000).then(async (p) => { const r = await api("customer", "/geo/reverse", { query: { lat: p.lat, lng: p.lng } }); setPickup((c) => c || { address: r.address, lat: p.lat, lng: p.lng }); }).catch(() => {});
  }, [pickup, first]);

  const onPick = async (p: Pt, which: "pickup" | "drop") => {
    let address = `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
    const set = which === "pickup" ? setPickup : setDrop;
    set({ address, ...p });
    try { const r = await api("customer", "/geo/reverse", { query: p }); address = r.address; set({ address, ...p }); } catch { /* keep coordinates */ }
  };
  const g = goods;
  const set = (k: string, v: any) => setGoods((x: any) => ({ ...x, [k]: v }));
  const goodsBody = () => ({ ...g, weight_kg: Number(g.weight_kg), length_cm: g.length_cm ? Number(g.length_cm) : null, width_cm: g.width_cm ? Number(g.width_cm) : null, height_cm: g.height_cm ? Number(g.height_cm) : null, quantity: Number(g.quantity) || 1, packages: Number(g.packages) || 1, handling: g.handling || null, loading_notes: g.loading_notes || null });
  const schedISO = () => (mode === "scheduled" && when ? new Date(when).toISOString().slice(0, 19) : null);

  const okLoc = pickup && drop && (mode === "instant" || (when && new Date(when).getTime() > Date.now() + 30 * 60000));
  const okGoods = g.description.trim().length >= 3 && Number(g.weight_kg) > 0 && g.receiver_name.trim() && /^[6-9]\d{9}$/.test(g.receiver_phone);

  const runEstimate = async () => {
    setEstBusy(true); setEst(null);
    try {
      const r = await api("customer", "/customer/estimate", { body: { pickup_lat: pickup!.lat, pickup_lng: pickup!.lng, drop_lat: drop!.lat, drop_lng: drop!.lng, goods: goodsBody(), scheduled_at: schedISO() } });
      setEst(r);
      setVid((v) => (v && r.vehicles.find((x: any) => x.id === v && x.suitable) ? v : r.suggested_vehicle_type_id));
      if (r.pricing_mode === "fixed" && pay === "cod" && r.cod.remaining <= 0) setPay("online");
    } catch (e: any) { toast(e.message, "err"); setStep(1); } finally { setEstBusy(false); }
  };
  const go = (n: number) => { setStep(n); window.scrollTo({ top: 0, behavior: "smooth" }); if (n === 2) runEstimate(); };
  const veh = est?.vehicles.find((v: any) => v.id === vid);
  const quote = est?.pricing_mode === "quotation";

  const submit = async () => {
    setBusy(true);
    try {
      const b = await api("customer", "/customer/bookings", { body: { pickup_lat: pickup!.lat, pickup_lng: pickup!.lng, drop_lat: drop!.lat, drop_lng: drop!.lng, pickup_address: pickup!.address, drop_address: drop!.address, goods: goodsBody(), vehicle_type_id: vid, payment_method: pay, booking_mode: mode, scheduled_at: schedISO(), pickup_landmark: help.landmark || null, pickup_gate: help.gate || null, pickup_floor: help.floor || null, pickup_entry: help.entry || null } });
      const up = async (f: File, kind: string) => { const form = new FormData(); form.append("file", f); form.append("kind", kind); await api("customer", `/customer/bookings/${b.id}/photos`, { form }); };
      try { for (const f of photos.slice(0, 4)) await up(f, "goods"); if (helpPhoto) await up(helpPhoto, "pickup_location"); } catch { toast(t("ts.bookPhotoFail"), "err"); }
      nav(`/customer/trips/${b.id}`, { replace: true });
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };

  const steps = [t("step.locations"), t("step.goods"), t("step.vehicle"), t("step.confirm")];
  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-center gap-2" aria-label="Progress">
        {steps.map((s, i) => (<div key={s} className="flex-1"><div className={`h-1.5 rounded-full ${i <= step ? "bg-brand" : "bg-line"}`} /><p className={`text-[11px] mt-1 font-semibold ${i === step ? "text-obsidian" : "text-steel"}`}>{s}</p></div>))}
      </div>

      {step === 0 && (
        <>
          <div className="grid grid-cols-2 gap-2 p-1 bg-white border border-line rounded-2xl">
            {(["instant", "scheduled"] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={`py-2.5 rounded-xl text-sm font-bold ${mode === m ? "bg-obsidian text-white" : "text-steel"}`}>{m === "instant" ? `⚡ ${t("bk.instant")}` : `🗓 ${t("bk.later")}`}</button>)}
          </div>
          {mode === "scheduled" && <Field label={t("bk.pickupTime")} hint="At least 30 minutes from now. Admin assigns a driver before your trip."><input type="datetime-local" className="input" value={when} min={new Date(Date.now() + 31 * 60000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={(e) => setWhen(e.target.value)} /></Field>}
          <PlaceInput label={t("home.from")} value={pickup} onChange={setPickup} saved={saved} onUseMap={() => setPickMode(pickMode === "pickup" ? null : "pickup")} active={pickMode === "pickup"} withGps />
          <PlaceInput label={t("home.to")} value={drop} onChange={setDrop} saved={saved} onUseMap={() => setPickMode(pickMode === "drop" ? null : "drop")} active={pickMode === "drop"} />
          {pickMode && <Warn tone="dark">Tap the map to set the {pickMode} point, or drag its pin.</Warn>}
          <MapView height={300} pickup={pickup} drop={drop} pickMode={pickMode} onPick={onPick} />
          <button className="btn-primary w-full !py-3.5" disabled={!okLoc} onClick={() => go(1)}>{t("bk.continueGoods")}</button>
        </>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <div className="card p-4 space-y-4">
            <Field label={t("bk.category")}><div className="flex flex-wrap gap-2">{CATEGORIES.map(([k, l]) => <button key={k} onClick={() => set("category", k)} className={`chip !text-xs !px-3 !py-2 ${g.category === k ? "bg-obsidian text-white" : "bg-offwhite"}`}>{l}</button>)}</div></Field>
            <Field label={t("bk.desc")}><input className="input" maxLength={400} placeholder="e.g. Steel brackets, 40 boxes" value={g.description} onChange={(e) => set("description", e.target.value)} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label={t("bk.quantity")}><input className="input" type="number" min={1} value={g.quantity} onChange={(e) => set("quantity", e.target.value)} /></Field>
              <Field label={t("bk.packages")}><input className="input" type="number" min={1} value={g.packages} onChange={(e) => set("packages", e.target.value)} /></Field>
              <Field label={t("bk.weight")}><input className="input" type="number" min={1} value={g.weight_kg} onChange={(e) => set("weight_kg", e.target.value)} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {([["length_cm", "Length (cm)"], ["width_cm", "Width (cm)"], ["height_cm", "Height (cm)"]] as const).map(([k, l]) => <Field key={k} label={l}><input className="input" type="number" min={0} value={g[k]} onChange={(e) => set(k, e.target.value)} /></Field>)}
            </div>
            <Field label="Special handling (optional)"><input className="input" maxLength={400} placeholder="Fragile, keep upright, cover from rain…" value={g.handling} onChange={(e) => set("handling", e.target.value)} /></Field>
            <Field label="Loading / unloading requirements (optional)"><input className="input" maxLength={400} placeholder="Forklift at pickup, no lift at drop…" value={g.loading_notes} onChange={(e) => set("loading_notes", e.target.value)} /></Field>
            <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" className="w-5 h-5 accent-brand" checked={g.helper_needed} onChange={(e) => set("helper_needed", e.target.checked)} /> I need a loading helper (extra charge)</label>
            <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" className="w-5 h-5 accent-brand" checked={g.special_handling} onChange={(e) => set("special_handling", e.target.checked)} /> Special / over-dimension handling needed (needs admin quotation)</label>
          </div>
          <div className="card p-4 space-y-3">
            <p className="font-extrabold">Receiver</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("bk.receiverName")}><input className="input" value={g.receiver_name} onChange={(e) => set("receiver_name", e.target.value)} /></Field>
              <Field label={t("bk.receiverPhone")}><input className="input" inputMode="numeric" maxLength={10} value={g.receiver_phone} onChange={(e) => set("receiver_phone", e.target.value.replace(/\D/g, ""))} /></Field>
            </div>
            <label className="btn-ghost btn-sm w-fit cursor-pointer">📷 Add goods photos ({photos.length}/4)<input type="file" accept="image/*" multiple hidden onChange={(e) => setPhotos([...photos, ...Array.from(e.target.files || [])].slice(0, 4))} /></label>
          </div>
          <div className="flex gap-2"><button className="btn-ghost flex-1" onClick={() => go(0)}>{t("bk.back")}</button><button className="btn-primary flex-[2]" disabled={!okGoods} onClick={() => go(2)}>{t("bk.seeVehicles")}</button></div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {estBusy && <Loading label="Calculating road distance and fares…" />}
          {est && (
            <>
              <div className="card-dark p-2 relative overflow-hidden">
                <VehicleViewer kind={veh?.key || "medium_truck"} className="h-44" />
                <div className="absolute left-4 top-3"><p className="text-xs text-white/50">Selected</p><p className="font-extrabold">{veh?.name}</p></div>
                <div className="absolute right-4 top-3 text-right"><p className="text-xs text-white/50">Road distance</p><p className="font-extrabold">{km(est.distance_km)}</p></div>
              </div>
              {est.estimate_note && <Warn>{est.estimate_note}</Warn>}
              {quote && <Warn tone="dark"><b>Admin quotation required.</b> {est.quotation_reason}. Pick a vehicle and submit your request; our team will send you a price to accept.</Warn>}
              <MapView height={180} pickup={pickup} drop={drop} route={est.route} />
              <div className="space-y-3">
                {est.vehicles.map((v: any) => (
                  <button key={v.id} disabled={!v.suitable} onClick={() => setVid(v.id)} className={`w-full text-left card p-4 flex gap-4 items-center transition ${vid === v.id ? "!border-brand shadow-glow" : ""} ${!v.suitable ? "opacity-50" : ""}`}>
                    <TruckSvg kind={v.key} className="w-24 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap"><p className="font-extrabold">{v.name}</p>{est.suggested_vehicle_type_id === v.id && <Chip tone="red">Suggested</Chip>}</div>
                      <p className="text-xs text-steel">Up to {v.capacity_kg.toLocaleString("en-IN")} kg · ₹{v.per_km}/km · ~{v.eta_hours} h drive</p>
                      <p className="text-xs text-steel truncate">{v.suitable ? v.description : v.reason}</p>
                    </div>
                    <div className="text-right"><p className="text-lg font-extrabold">{v.fare ? money(v.fare) : "Quote"}</p>{v.fare && <p className="text-[11px] text-steel">estimated</p>}</div>
                  </button>
                ))}
              </div>
              <div className="flex gap-2"><button className="btn-ghost flex-1" onClick={() => go(1)}>{t("bk.back")}</button><button className="btn-primary flex-[2]" disabled={!veh} onClick={() => go(3)}>{t("bk.continue")}</button></div>
            </>
          )}
        </div>
      )}

      {step === 3 && est && veh && (
        <div className="space-y-4">
          <div className="card p-4">
            <p className="font-extrabold mb-2">Trip summary</p>
            <Row k="Pickup" v={<span className="text-xs max-w-[60%] inline-block">{pickup!.address}</span>} /><Row k="Drop" v={<span className="text-xs max-w-[60%] inline-block">{drop!.address}</span>} />
            <Row k="Vehicle" v={veh.name} /><Row k="Distance" v={km(est.distance_km)} /><Row k="Goods" v={`${g.description} · ${g.weight_kg} kg`} />
            <Row k="When" v={mode === "instant" ? "Instant" : new Date(when).toLocaleString("en-IN")} />
          </div>
          <div className="card p-4 space-y-3">
            <p className="font-extrabold">Pickup instructions <span className="text-steel font-medium text-xs">(helps the driver find you)</span></p>
            <input className="input" placeholder="Landmark: Blue gate, opposite the temple" maxLength={300} value={help.landmark} onChange={(e) => setHelp({ ...help, landmark: e.target.value })} />
            <div className="grid grid-cols-2 gap-3"><input className="input" placeholder="Gate / building" maxLength={120} value={help.gate} onChange={(e) => setHelp({ ...help, gate: e.target.value })} /><input className="input" placeholder="Floor / warehouse no." maxLength={120} value={help.floor} onChange={(e) => setHelp({ ...help, floor: e.target.value })} /></div>
            <input className="input" placeholder="Entry instructions: Use service entrance near loading area" maxLength={300} value={help.entry} onChange={(e) => setHelp({ ...help, entry: e.target.value })} />
            <label className="btn-ghost btn-sm w-fit cursor-pointer">📷 {helpPhoto ? "Photo added" : "Add pickup location photo"}<input type="file" accept="image/*" hidden onChange={(e) => setHelpPhoto(e.target.files?.[0] || null)} /></label>
          </div>
          {!quote && veh.fare_breakup && (
            <div className="card p-4"><p className="font-extrabold mb-2">Fare estimate</p>
              <Row k="Base fare" v={money(veh.fare_breakup.base)} /><Row k={`Distance (${km(est.distance_km)} × ₹${veh.per_km})`} v={money(veh.fare_breakup.distance_charge)} />
              {veh.fare_breakup.min_applied && <Row k="Minimum fare applied" v="✓" />}{veh.fare_breakup.night > 0 && <Row k="Night charge" v={money(veh.fare_breakup.night)} />}{veh.fare_breakup.helper > 0 && <Row k="Loading helper" v={money(veh.fare_breakup.helper)} />}
              <div className="border-t border-line mt-2 pt-2 flex justify-between text-lg font-extrabold"><span>Total</span><span className="text-brand">{money(veh.fare)}</span></div>
              <p className="text-[11px] text-steel mt-1">Calculated on our server. Waiting charges may apply after free waiting time.</p>
            </div>
          )}
          {!quote && (
            <div className="card p-4 space-y-2"><p className="font-extrabold">Payment</p>
              {[["online", true, ""], ["cod", est.cod.remaining > 0, `${est.cod.remaining} of ${est.cod.limit} COD trips left`], ["credit", est.credit?.status === "approved" && est.credit.available >= (veh.fare || 0), est.credit?.status === "approved" ? `Available ${money(est.credit.available)}` : "Not approved for your account"]].map(([k, ok, note]: any) => (
                <label key={k} className={`flex items-center gap-3 rounded-xl border p-3 ${pay === k ? "border-obsidian bg-offwhite" : "border-line"} ${!ok ? "opacity-50" : "cursor-pointer"}`}>
                  <input type="radio" name="pay" className="accent-brand w-4 h-4" disabled={!ok} checked={pay === k} onChange={() => setPay(k)} /><span className="flex-1 text-sm font-semibold">{PAY_LABEL[k]}</span><span className="text-[11px] text-steel">{note}</span>
                </label>
              ))}
            </div>
          )}
          <div className="flex gap-2"><button className="btn-ghost flex-1" onClick={() => go(2)}>{t("bk.back")}</button>
            <button className="btn-primary flex-[2] !py-3.5" disabled={busy} onClick={submit}>{busy ? <Spinner /> : quote ? "Request quotation" : pay === "online" ? `Confirm and pay ${money(veh.fare)}` : `Confirm booking · ${money(veh.fare)}`}</button></div>
        </div>
      )}
    </div>
  );
}
