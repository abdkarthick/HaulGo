import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../lib/session";
import { useI18n } from "../lib/i18n";
import { Field, Spinner } from "../components/ui";

// A driver can own several vehicles; exactly one is active. Requests for any owned vehicle type reach the driver.
export default function Vehicles({ onChanged }: { onChanged: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [list, setList] = useState<any[] | null>(null);
  const [vts, setVts] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<any>({ vehicle_type_id: "", reg_no: "", capacity_kg: "" });

  const load = () => api("driver", "/driver/vehicles").then((r) => setList(Array.isArray(r) ? r : [])).catch(() => setList([]));
  useEffect(() => { load(); api("driver", "/vehicle-types").then(setVts).catch(() => {}); }, []);

  const run = async (fn: () => Promise<any>, ok?: string) => {
    setBusy(true);
    try { await fn(); await load(); onChanged(); if (ok) toast(ok, "ok"); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  const add = () => run(async () => {
    await api("driver", "/driver/vehicles", { method: "POST", body: { vehicle_type_id: Number(f.vehicle_type_id), reg_no: f.reg_no.trim(), capacity_kg: Number(f.capacity_kg) } });
    setF({ vehicle_type_id: "", reg_no: "", capacity_kg: "" });
    setAdding(false);
  }, t("veh.added"));
  const canAdd = f.vehicle_type_id && f.reg_no.trim().length >= 6 && Number(f.capacity_kg) > 0;

  return (
    <div className="card p-4 space-y-3">
      <div>
        <p className="font-extrabold">{t("veh.title")}</p>
        <p className="text-xs text-steel mt-0.5">{t("veh.hint")}</p>
      </div>
      {list === null ? <Spinner /> : list.map((v) => (
        <div key={v.id} className={`rounded-xl border p-3 ${v.is_active ? "border-brand bg-brand/5" : "border-line bg-white"}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-sm truncate">{v.vehicle_type?.name}</p>
              <p className="text-xs text-steel">{v.reg_no} · {Math.round(v.capacity_kg)} kg</p>
            </div>
            {v.is_active
              ? <span className="text-[11px] font-bold text-white bg-brand rounded-full px-2.5 py-1 whitespace-nowrap">{t("veh.active")}</span>
              : <div className="flex gap-1.5 shrink-0">
                  <button className="chip bg-obsidian text-white" disabled={busy} onClick={() => run(() => api("driver", `/driver/vehicles/${v.id}/activate`, { method: "POST", body: {} }))}>{t("veh.use")}</button>
                  <button className="chip bg-offwhite" disabled={busy} onClick={() => run(() => api("driver", `/driver/vehicles/${v.id}`, { method: "DELETE" }))}>{t("veh.remove")}</button>
                </div>}
          </div>
        </div>
      ))}
      {adding ? (
        <div className="rounded-xl border border-line p-3 space-y-3">
          <Field label={t("veh.type")}>
            <div className="flex flex-wrap gap-1.5">{vts.map((v) => (
              <button key={v.id} type="button" onClick={() => setF({ ...f, vehicle_type_id: v.id, capacity_kg: f.capacity_kg || v.capacity_kg })}
                className={`chip ${Number(f.vehicle_type_id) === v.id ? "bg-obsidian text-white" : "bg-offwhite"}`}>{v.name}</button>))}</div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("veh.reg")}><input className="input uppercase" value={f.reg_no} onChange={(e) => setF({ ...f, reg_no: e.target.value })} placeholder="TN09AB1234" /></Field>
            <Field label={t("veh.cap")}><input className="input" type="number" value={f.capacity_kg} onChange={(e) => setF({ ...f, capacity_kg: e.target.value })} /></Field>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" disabled={busy || !canAdd} onClick={add}>{busy ? <Spinner /> : t("veh.save")}</button>
            <button className="btn-dark" onClick={() => setAdding(false)}>{t("veh.cancel")}</button>
          </div>
        </div>
      ) : <button className="btn-dark w-full" onClick={() => setAdding(true)}>+ {t("veh.add")}</button>}
    </div>
  );
}
