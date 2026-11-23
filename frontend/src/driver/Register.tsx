import { useEffect, useState } from "react";
import { api, fileUrl } from "../lib/api";
import { useToast } from "../lib/session";
import { Chip, Field, Photo, Spinner, Warn } from "../components/ui";
import { useI18n, Key } from "../lib/i18n";
import Vehicles from "./Vehicles";

const DOCS: [string, boolean][] = [["licence", true], ["rc", true], ["insurance", false], ["permit", false], ["vehicle_photo", false], ["profile_photo", false]];

export default function Register({ driver, status, onSaved, embedded = false, onLogout }: { driver: any; status: string; onSaved: () => void; embedded?: boolean; onLogout: () => void }) {
  const toast = useToast();
  const { t, tx } = useI18n();
  const [vts, setVts] = useState<any[]>([]);
  const [f, setF] = useState<any>({ name: driver?.name || "", vehicle_type_id: driver?.vehicle_type_id || "", reg_no: driver?.reg_no || "", capacity_kg: driver?.capacity_kg || "", license_no: driver?.license_no || "", rc_no: driver?.rc_no || "", insurance_no: driver?.insurance_no || "", permit_no: driver?.permit_no || "", service_city: driver?.service_city || "", payout_upi: driver?.payout_upi || "", payout_bank_name: driver?.payout_bank_name || "", payout_bank_acc: driver?.payout_bank_acc || "", payout_ifsc: driver?.payout_ifsc || "" });
  const [busy, setBusy] = useState(false);
  const [up, setUp] = useState<string | null>(null);
  useEffect(() => { api("driver", "/vehicle-types").then(setVts).catch(() => {}); }, []);
  const s = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      const body: any = { ...f, vehicle_type_id: Number(f.vehicle_type_id), capacity_kg: Number(f.capacity_kg) };
      Object.keys(body).forEach((k) => body[k] === "" && delete body[k]);
      await api("driver", "/driver/profile", { method: "PUT", body });
      toast(t("reg.saved"), "ok"); onSaved();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  const upload = async (type: string, file?: File) => {
    if (!file) return; setUp(type);
    try { const form = new FormData(); form.append("doc_type", type); form.append("file", file); await api("driver", "/driver/documents", { form }); toast(t("reg.uploaded"), "ok"); onSaved(); } catch (e: any) { toast(e.message, "err"); } finally { setUp(null); }
  };
  const docs: any[] = driver?.documents || [];
  const hasProfile = !!driver?.reg_no;
  return (
    <div className="space-y-4">
      {!embedded && (
        <div>
          <h1 className="text-2xl font-extrabold">{status === "pending" ? t("reg.verifying") : status === "rejected" ? t("reg.needsChanges") : status === "blocked" ? t("reg.blocked") : t("reg.register")}</h1>
          {status === "none" && <p className="text-sm text-steel mt-1">{t("reg.addVehicleDocs")}</p>}
          {status === "pending" && <Warn>{t("reg.pendingWarn")}</Warn>}
          {status === "rejected" && <Warn tone="red">{t("reg.rejectedWarn", { reason: driver?.reject_reason || t("reg.defaultReason") })}</Warn>}
          {status === "blocked" && <Warn tone="red">{t("reg.blockedWarn")}</Warn>}
        </div>
      )}
      {status !== "blocked" && (
        <>
          <div className="card p-4 space-y-3">
            <p className="font-extrabold">{t("reg.vehLic")}</p>
            <Field label={t("reg.fullName")}><input className="input" value={f.name} onChange={(e) => s("name", e.target.value)} /></Field>
            <Field label={t("reg.vehType")}><div className="grid grid-cols-1 gap-2">{vts.map((v) => <button key={v.id} type="button" onClick={() => { s("vehicle_type_id", v.id); if (!f.capacity_kg) s("capacity_kg", v.capacity_kg); }} className={`text-left rounded-xl border p-3 ${Number(f.vehicle_type_id) === v.id ? "border-obsidian bg-offwhite" : "border-line"}`}><b className="text-sm">{v.name}</b><span className="block text-xs text-steel">{t("reg.upTo", { n: v.capacity_kg })}</span></button>)}</div></Field>
            <div className="grid grid-cols-2 gap-3"><Field label={t("veh.reg")}><input className="input uppercase" value={f.reg_no} onChange={(e) => s("reg_no", e.target.value)} placeholder="TN09AB1234" /></Field><Field label={t("veh.cap")}><input className="input" type="number" value={f.capacity_kg} onChange={(e) => s("capacity_kg", e.target.value)} /></Field></div>
            <div className="grid grid-cols-2 gap-3"><Field label={t("reg.licNo")}><input className="input" value={f.license_no} onChange={(e) => s("license_no", e.target.value)} /></Field><Field label={t("reg.rcNo")}><input className="input" value={f.rc_no} onChange={(e) => s("rc_no", e.target.value)} /></Field></div>
            <div className="grid grid-cols-2 gap-3"><Field label={t("reg.insurance")}><input className="input" value={f.insurance_no} onChange={(e) => s("insurance_no", e.target.value)} /></Field><Field label={t("reg.permitNo")}><input className="input" value={f.permit_no} onChange={(e) => s("permit_no", e.target.value)} /></Field></div>
            <Field label={t("reg.city")}><input className="input" value={f.service_city} onChange={(e) => s("service_city", e.target.value)} placeholder="Chennai" /></Field>
          </div>
          <div className="card p-4 space-y-3"><p className="font-extrabold">{t("reg.payout")}</p><Field label={t("reg.upi")}><input className="input" value={f.payout_upi} onChange={(e) => s("payout_upi", e.target.value)} placeholder="name@upi" /></Field>
            <p className="text-xs text-steel text-center">{t("reg.orBank")}</p>
            <div className="grid grid-cols-2 gap-3"><Field label={t("reg.bankName")}><input className="input" value={f.payout_bank_name} onChange={(e) => s("payout_bank_name", e.target.value)} /></Field><Field label={t("reg.ifsc")}><input className="input uppercase" value={f.payout_ifsc} onChange={(e) => s("payout_ifsc", e.target.value)} /></Field></div>
            <Field label={t("reg.acc")}><input className="input" inputMode="numeric" value={f.payout_bank_acc} onChange={(e) => s("payout_bank_acc", e.target.value.replace(/\D/g, ""))} /></Field></div>
          <button className="btn-primary w-full" disabled={busy || !f.name || !f.vehicle_type_id || !f.reg_no || !f.capacity_kg || !f.license_no} onClick={save}>{busy ? <Spinner /> : hasProfile ? t("reg.saveChanges") : t("reg.saveContinue")}</button>
          {hasProfile && !embedded && <Vehicles onChanged={onSaved} />}
          {hasProfile && (
            <div className="card p-4 space-y-3"><p className="font-extrabold">{t("reg.kyc")}</p><p className="text-xs text-steel">{t("reg.kycHint")}</p>
              {DOCS.map(([k, req]) => {
                const mine = docs.filter((d) => d.type === k);
                const latest = mine[mine.length - 1];
                return (
                  <div key={k} className="flex items-center justify-between gap-3 border-t border-line pt-3 first:border-0 first:pt-0">
                    <div><p className="text-sm font-bold">{t(`doc.${k}` as Key)} {req && <span className="text-danger">*</span>}</p>{latest ? <Chip tone={latest.status === "verified" ? "green" : latest.status === "rejected" ? "red" : "amber"}>{tx(`doc.${latest.status}`, latest.status)}{latest.note ? ` · ${latest.note}` : ""}</Chip> : <span className="text-xs text-steel">{t("reg.notUploaded")}</span>}</div>
                    <label className="btn-ghost btn-sm cursor-pointer">{up === k ? <Spinner /> : latest ? t("reg.replace") : t("reg.upload")}<input type="file" hidden accept="image/*,application/pdf" onChange={(e) => upload(k, e.target.files?.[0])} /></label>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      {!embedded && <button className="btn-ghost w-full" onClick={onLogout}>{t("reg.logout")}</button>}
    </div>
  );
}
