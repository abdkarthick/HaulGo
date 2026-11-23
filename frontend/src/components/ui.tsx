import { ReactNode, useEffect } from "react";
import { STATUS, TONES } from "../lib/util";
import { useI18n } from "../lib/i18n";

export const Spinner = ({ className = "" }: { className?: string }) => (
  <svg className={`animate-spin h-5 w-5 ${className}`} viewBox="0 0 24 24" fill="none" aria-label="Loading"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity=".2" /><path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
);
export const Loading = ({ label = "Loading…" }: { label?: string }) => (<div className="flex items-center justify-center gap-3 py-16 text-steel text-sm"><Spinner /> {label}</div>);

export const StatusBadge = ({ s }: { s: string }) => {
  const { tx } = useI18n();
  const x = STATUS[s] || { label: s, tone: "grey" };
  return <span className={`chip ${TONES[x.tone]}`}>{tx(`st.${s}`, x.label)}</span>;
};
export const Chip = ({ tone = "grey", children }: { tone?: string; children: ReactNode }) => <span className={`chip ${TONES[tone] || TONES.grey}`}>{children}</span>;

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (<label className="block"><span className="label">{label}</span>{children}{hint && <span className="block text-xs text-steel mt-1">{hint}</span>}</label>);
}

export function Sheet({ open, onClose, title, children, wide = false, footer }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1500] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-obsidian/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`relative bg-white w-full ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"} max-h-[92vh] flex flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl animate-rise safe-b`}>
        <div className="shrink-0 flex items-center justify-between px-5 pt-5 pb-3 border-b border-line/70 bg-white">
          <h3 className="text-lg font-extrabold">{title}</h3>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-offwhite font-bold" aria-label="Close">✕</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="shrink-0 px-5 py-3 border-t border-line/70 bg-white">{footer}</div>}
      </div>
    </div>
  );
}

export const Stat = ({ label, value, sub, accent = false }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) => (
  <div className="card p-4">
    <p className="text-[11px] uppercase tracking-wide font-semibold text-steel">{label}</p>
    <p className={`text-2xl font-extrabold mt-1 ${accent ? "text-brand" : ""}`}>{value}</p>
    {sub && <p className="text-xs text-steel mt-0.5">{sub}</p>}
  </div>
);

export const Row = ({ k, v }: { k: ReactNode; v: ReactNode }) => (<div className="flex justify-between gap-4 py-1.5 text-sm"><span className="text-steel">{k}</span><span className="font-semibold text-right">{v}</span></div>);

export const Warn = ({ children, tone = "amber" }: { children: ReactNode; tone?: "amber" | "red" | "dark" }) => (
  <div className={`rounded-xl px-3.5 py-3 text-xs font-medium leading-relaxed ${tone === "red" ? "bg-danger/10 text-danger" : tone === "dark" ? "bg-obsidian text-white" : "bg-amber-50 text-amber-900 border border-amber-200"}`}>{children}</div>
);

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative w-14 h-8 rounded-full transition ${on ? "bg-brand" : "bg-neutral-300"} disabled:opacity-50`}>
      <span className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-all ${on ? "left-7" : "left-1"}`} />
    </button>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string, number?][] }) {
  return (
    <div className="flex gap-1 overflow-x-auto no-scrollbar bg-white border border-line rounded-xl p-1" role="tablist">
      {items.map(([k, label, n]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={`px-3.5 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition ${value === k ? "bg-obsidian text-white" : "text-steel hover:text-obsidian"}`}>
          {label}{n ? <span className={`ml-1.5 text-[11px] rounded-full px-1.5 py-0.5 ${value === k ? "bg-brand" : "bg-brand/10 text-brand"} ${value === k ? "text-white" : ""}`}>{n}</span> : null}
        </button>
      ))}
    </div>
  );
}

export const Photo = ({ src, onClick }: { src: string; onClick?: () => void }) => (
  <img src={src} onClick={onClick} loading="lazy" alt="Uploaded" className="w-20 h-20 rounded-xl object-cover border border-line cursor-pointer bg-offwhite" />
);
