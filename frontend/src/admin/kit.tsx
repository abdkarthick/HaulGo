import { ReactNode, useId, useState } from "react";
import { Loading } from "../components/ui";
import { IcInbox } from "../components/Icons";

const HINTS: Record<string, string> = {
  "No bookings match": "Try another status or date range. New bookings appear here the moment a customer books.",
  "No active trips right now": "Trips show here with live GPS once a driver accepts a booking.",
  "No commission dues": "Dues appear when a driver completes a cash-on-delivery trip and owes the platform commission.",
  "No credit requests yet": "Companies can ask for monthly business credit from their account. Requests land here for approval.",
  "No complaints": "Customer and driver complaints show up here with a full history for you to respond to.",
  "No external notifications logged": "SMS and email attempts are logged here, including ones that could not be sent.",
  "No call sessions": "Masked-call attempts between customers and drivers are listed here.",
  "No pickup help requests": "When a driver cannot find the pickup point, the request shows up here so you can step in.",
  "Nothing to show": "There is nothing in this view yet. Entries appear here automatically as activity happens.",
};

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-4">
      <span className="w-14 h-14 rounded-2xl bg-offwhite text-steel flex items-center justify-center"><IcInbox size={26} /></span>
      <p className="font-extrabold mt-3">{title}</p>
      <p className="text-sm text-steel mt-1 max-w-sm">{hint || HINTS[title] || HINTS["Nothing to show"]}</p>
    </div>
  );
}

export function Table<T>({ cols, rows, onRow, empty = "Nothing to show", hint, loading }: { cols: [string, (r: T) => ReactNode, string?][]; rows?: T[] | null; onRow?: (r: T) => void; empty?: string; hint?: string; loading?: boolean }) {
  if (loading && !rows) return <Loading />;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead><tr>{cols.map(([h, , cls]) => <th key={h} className={`th ${cls || ""}`}>{h}</th>)}</tr></thead>
        <tbody>
          {rows?.map((r, i) => (
            <tr key={i} onClick={() => onRow?.(r)} className={onRow ? "cursor-pointer hover:bg-offwhite" : ""}>{cols.map(([h, f, cls]) => <td key={h} className={`td ${cls || ""}`}>{f(r)}</td>)}</tr>
          ))}
          {!rows?.length && <tr><td colSpan={cols.length} className="td !p-0"><EmptyState title={empty} hint={hint} /></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function BarChart({ data, k, label, color = "#A8651A", fmt = (n: number) => String(Math.round(n)) }: { data: any[]; k: string; label: string; color?: string; fmt?: (n: number) => string }) {
  const max = Math.max(...data.map((d) => d[k]), 1);
  return (
    <div className="card p-4">
      <p className="font-extrabold text-sm">{label}</p>
      <div className="flex items-end gap-1.5 h-36 mt-4" role="img" aria-label={label}>
        {data.map((d) => (
          <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full group relative">
            <div className="absolute -top-1 hidden group-hover:block bg-obsidian text-white text-[10px] rounded px-1.5 py-0.5 z-10 whitespace-nowrap">{fmt(d[k])}</div>
            <div className="w-full rounded-t" style={{ height: `${(d[k] / max) * 100}%`, minHeight: 2, background: color }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1">{data.map((d, i) => <span key={d.date} className="flex-1 text-center text-[9px] text-steel">{i % 2 === 0 ? d.date.split(" ")[0] : ""}</span>)}</div>
    </div>
  );
}

export const PageHead = ({ title, children }: { title: string; children?: ReactNode }) => (<div className="flex items-center justify-between gap-3 flex-wrap mb-4"><h1 className="text-2xl font-extrabold">{title}</h1><div className="flex gap-2 flex-wrap">{children}</div></div>);

/* ---------- premium charts (plain SVG, no chart library) ---------- */
const smooth = (pts: [number, number][]) => {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
};

export function Spark({ values, color = "#A8651A", height = 36 }: { values: number[]; color?: string; height?: number }) {
  const id = useId().replace(/:/g, "");
  const W = 120, max = Math.max(...values, 1);
  const pts: [number, number][] = values.map((v, i) => [(i / Math.max(values.length - 1, 1)) * W, height - 3 - (v / max) * (height - 8)]);
  const line = smooth(pts);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".35" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {line && <><path d={`${line} L${W},${height} L0,${height} Z`} fill={`url(#${id})`} /><path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" /></>}
    </svg>
  );
}

export function AreaChart({ data, k, label, color = "#A8651A", fmt = (n: number) => String(Math.round(n)), height = 230 }: { data: any[]; k: string; label: string; color?: string; fmt?: (n: number) => string; height?: number }) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = height, L = 8, R = 8, T = 16, B = 26;
  const vals = data.map((d) => Number(d[k]) || 0);
  const max = Math.max(...vals, 1) * 1.15;
  const x = (i: number) => L + (i / Math.max(data.length - 1, 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const pts: [number, number][] = vals.map((v, i) => [x(i), y(v)]);
  const line = smooth(pts);
  const total = vals.reduce((a, b) => a + b, 0);
  const half = Math.floor(vals.length / 2);
  const prev = vals.slice(0, half).reduce((a, b) => a + b, 0), cur = vals.slice(half).reduce((a, b) => a + b, 0);
  const delta = prev > 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? 100 : 0;
  const hv = hover ?? vals.length - 1;
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[11px] uppercase tracking-wide font-semibold text-steel">{label}</p><p className="text-2xl font-extrabold mt-1">{fmt(total)}</p></div>
        <span className={`chip ${delta >= 0 ? "bg-emerald-100 text-emerald-800" : "bg-danger/10 text-danger"}`}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}% vs previous {half} days</span>
      </div>
      <div className="relative mt-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
          <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".28" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
          {[0, 1, 2, 3].map((g) => <line key={g} x1={L} x2={W - R} y1={T + (g / 3) * (H - T - B)} y2={T + (g / 3) * (H - T - B)} stroke="#E8E2D8" strokeDasharray="3 5" />)}
          {line && <><path d={`${line} L${x(vals.length - 1)},${H - B} L${x(0)},${H - B} Z`} fill={`url(#${id})`} /><path d={line} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" /></>}
          {pts.map(([px, py], i) => (i === hv ? <g key={i}><line x1={px} x2={px} y1={T} y2={H - B} stroke={color} strokeOpacity=".25" /><circle cx={px} cy={py} r="6" fill="#fff" stroke={color} strokeWidth="3" /></g> : null))}
          {data.map((d, i) => (i % 2 === 0 || i === data.length - 1) ? <text key={d.date} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="#7A7480">{d.date}</text> : null)}
          {pts.map(([px], i) => <rect key={i} x={px - (W / data.length) / 2} y={0} width={W / data.length} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />)}
        </svg>
        <div className="absolute top-0 right-0 bg-obsidian text-white text-xs rounded-lg px-2.5 py-1.5 pointer-events-none"><span className="text-white/60">{data[hv]?.date}</span> <b>{fmt(vals[hv] || 0)}</b></div>
      </div>
    </div>
  );
}

export function Donut({ items, label }: { items: { label: string; value: number; color: string }[]; label: string }) {
  const total = items.reduce((a, b) => a + b.value, 0);
  const R = 52, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="card p-5 h-full">
      <p className="text-[11px] uppercase tracking-wide font-semibold text-steel">{label}</p>
      {!total ? <EmptyState title="No bookings yet" hint="The status split appears here after the first booking." /> : (
        <div className="flex items-center gap-5 mt-3 flex-wrap">
          <svg viewBox="0 0 140 140" className="w-36 h-36 shrink-0" role="img" aria-label={label}>
            <circle cx="70" cy="70" r={R} fill="none" stroke="#FAF7F2" strokeWidth="18" />
            {items.map((it) => { const len = (it.value / total) * C; const el = <circle key={it.label} cx="70" cy="70" r={R} fill="none" stroke={it.color} strokeWidth="18" strokeDasharray={`${Math.max(len - 2, 0)} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />; acc += len; return el; })}
            <text x="70" y="68" textAnchor="middle" fontSize="26" fontWeight="800" fill="#3A3541">{total}</text>
            <text x="70" y="86" textAnchor="middle" fontSize="10" fill="#7A7480">bookings</text>
          </svg>
          <ul className="flex-1 min-w-[140px] space-y-1.5 text-sm">{items.map((it) => <li key={it.label} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: it.color }} /><span className="flex-1 truncate">{it.label}</span><b>{it.value}</b></li>)}</ul>
        </div>
      )}
    </div>
  );
}

export function HBars({ items, label, color = "#A8651A" }: { items: { label: string; value: number }[]; label: string; color?: string }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="card p-5 h-full">
      <p className="text-[11px] uppercase tracking-wide font-semibold text-steel">{label}</p>
      {!items.length ? <EmptyState title="No data yet" hint="Fills in as bookings are made." /> : (
        <ul className="mt-4 space-y-3.5">{items.map((i) => (
          <li key={i.label}><div className="flex justify-between text-sm mb-1"><span className="font-semibold truncate pr-2">{i.label}</span><b>{i.value}</b></div><div className="h-2 rounded-full bg-offwhite"><div className="h-2 rounded-full" style={{ width: `${(i.value / max) * 100}%`, background: color }} /></div></li>
        ))}</ul>
      )}
    </div>
  );
}

export const StatStrip = ({ items }: { items: [string, ReactNode, boolean?][] }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
    {items.map(([l, v, accent]) => <div key={l} className="card px-4 py-3"><p className="text-[11px] uppercase tracking-wide font-semibold text-steel">{l}</p><p className={`text-xl font-extrabold mt-0.5 ${accent ? "text-brand" : ""}`}>{v}</p></div>)}
  </div>
);
