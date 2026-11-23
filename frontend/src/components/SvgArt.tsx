import { useId } from "react";

/** Flat, geometric truck illustration (no cartoon). `kind` changes proportions. */
function SmallVehicleSvg({ kind, className, dark }: { kind: string; className: string; dark: boolean }) {
  const ink = dark ? "#EDEDED" : "#3A3541";
  const Wh = ({ x, r }: { x: number; r: number }) => <g><circle cx={x} cy={78 - r} r={r} fill={dark ? "#1E1B26" : "#3A3541"} stroke={ink} strokeWidth="3" /><circle cx={x} cy={78 - r} r={r * 0.45} fill="none" stroke="#A8651A" strokeWidth="3" /></g>;
  return (
    <svg viewBox="0 0 200 90" className={className} role="img" aria-label={kind}>
      {kind === "auto" ? (
        <g>
          <Wh x={160} r={13} /><Wh x={52} r={13} /><Wh x={92} r={13} />
          <rect x="14" y="40" width="70" height="26" rx="4" fill="#A8651A" opacity=".85" /><rect x="22" y="30" width="26" height="12" rx="2" fill="#B98A56" />
          <rect x="84" y="44" width="84" height="22" rx="9" fill="#A8651A" />
          <rect x="88" y="14" width="62" height="5" rx="2" fill="#FFFFFF" /><path d="M92 19v26M146 19v26" stroke={ink} strokeWidth="3" />
          <path d="M150 20 166 46" stroke="#7B8DA0" strokeWidth="3" /><rect x="160" y="50" width="8" height="6" rx="2" fill="#FFD76A" />
        </g>
      ) : kind === "scooty" ? (
        <g>
          <Wh x={54} r={12} /><Wh x={150} r={12} />
          <rect x="70" y="56" width="62" height="7" rx="3" fill={ink} />
          <path d="M132 58 144 22h14" stroke="#A8651A" strokeWidth="8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="34" y="40" width="46" height="22" rx="10" fill="#A8651A" /><rect x="40" y="34" width="46" height="7" rx="3" fill={ink} opacity=".85" />
          <rect x="16" y="12" width="30" height="24" rx="3" fill="#FFFFFF" stroke="#A8651A" strokeWidth="3" />
          <rect x="158" y="40" width="8" height="8" rx="3" fill="#FFD76A" />
        </g>
      ) : (
        <g>
          <Wh x={44} r={15} /><Wh x={158} r={15} />
          <path d="M44 63 86 46h34l38 17" stroke={ink} strokeWidth="5" fill="none" strokeLinejoin="round" strokeLinecap="round" />
          <rect x="92" y="28" width="38" height="16" rx="7" fill="#A8651A" /><rect x="52" y="34" width="44" height="8" rx="3" fill={ink} opacity=".85" />
          <path d="M132 22 150 40M132 22h12" stroke={ink} strokeWidth="5" strokeLinecap="round" fill="none" />
          <rect x="12" y="14" width="34" height="26" rx="3" fill="#FFFFFF" stroke="#A8651A" strokeWidth="3" />
          <rect x="150" y="38" width="8" height="8" rx="3" fill="#FFD76A" />
        </g>
      )}
    </svg>
  );
}

export function TruckSvg({ kind = "medium_truck", className = "", moving = false, dark = false }: { kind?: string; className?: string; moving?: boolean; dark?: boolean }) {
  const id = useId().replace(/:/g, "");
  if (kind === "bike" || kind === "scooty" || kind === "auto") return <SmallVehicleSvg kind={kind} className={className} dark={dark} />;
  const cfg: Record<string, { box: number; axles: number; open?: boolean }> = {
    mini_truck: { box: 70, axles: 1, open: true }, pickup: { box: 90, axles: 1, open: true }, medium_truck: { box: 120, axles: 2 },
    heavy_truck: { box: 150, axles: 2 }, trailer: { box: 190, axles: 3 },
  };
  const c = cfg[kind] || cfg.medium_truck;
  const w = c.box + 78;
  const body = dark ? "#5A5465" : "#FFFFFF";
  const stroke = dark ? "#6E687A" : "#D9D9D4";
  const wheels = Array.from({ length: c.axles + 1 }).map((_, i) => (i === 0 ? c.box + 40 : c.box - 20 - (i - 1) * 28));
  return (
    <svg viewBox={`0 0 ${w + 8} 90`} className={className} role="img" aria-label="Truck">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4A4455" /><stop offset="1" stopColor="#3A3541" /></linearGradient>
      </defs>
      <ellipse cx={w / 2 + 4} cy="82" rx={w / 2} ry="4" fill="#3A3541" opacity=".12" />
      <rect x="4" y="58" width={w - 8} height="9" rx="3" fill={`url(#g${id})`} />
      {c.open ? (
        <g><rect x="6" y="40" width={c.box} height="18" rx="2" fill={body} stroke={stroke} /><rect x="6" y="36" width={c.box} height="4" fill="#3A3541" /></g>
      ) : (
        <g><rect x="6" y="14" width={c.box} height="44" rx="4" fill={body} stroke={stroke} /><rect x="6" y="40" width={c.box} height="5" fill="#A8651A" /></g>
      )}
      <path d={`M${c.box + 12} 26 h22 l16 16 v16 h-38z`} fill={dark ? "#4A4455" : "#3A3541"} />
      <path d={`M${c.box + 20} 31 h14 l11 11 h-25z`} fill="#8FA3B5" opacity=".85" />
      <rect x={w - 6} y="48" width="5" height="5" rx="1" fill="#FFE9A8" />
      {wheels.map((x, i) => (
        <g key={i} transform={`translate(${x} 68)`}>
          <circle r="11" fill="#3A3541" />
          <g className={moving ? "origin-center" : ""} style={moving ? { animation: "spin .5s linear infinite", transformBox: "fill-box", transformOrigin: "center" } : undefined}>
            <circle r="5" fill="#C8C8C4" /><path d="M0-4V4M-4 0H4" stroke="#7A7480" strokeWidth="1.5" />
          </g>
        </g>
      ))}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </svg>
  );
}

export function EmptyArt({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="text-center py-10 px-6">
      <div className="mx-auto w-56 relative">
        <TruckSvg kind="medium_truck" className="w-full opacity-90" />
        <div className="absolute -bottom-1 left-0 right-0 h-px overflow-hidden"><div className="h-px w-[200%] border-t-2 border-dashed border-steel/40 animate-road" /></div>
      </div>
      <p className="mt-6 font-bold text-lg">{title}</p>
      {hint && <p className="text-sm text-steel mt-1 max-w-xs mx-auto">{hint}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

/** Package slides into truck, check mark pops. Used after booking confirm / delivery success. */
export function PackageLoadArt({ done = false }: { done?: boolean }) {
  return (
    <div className="relative w-56 h-28 mx-auto overflow-hidden">
      <style>{`@keyframes pkg{0%{transform:translate(-70px,-26px);opacity:0}30%{opacity:1}70%{transform:translate(0,0)}100%{transform:translate(0,0);opacity:1}}@keyframes drive{0%{transform:translateX(0)}100%{transform:translateX(130px)}}@keyframes pop{0%{transform:scale(0)}70%{transform:scale(1.2)}100%{transform:scale(1)}}`}</style>
      <div style={done ? { animation: "drive 2.2s ease-in 1.4s forwards" } : undefined}>
        <TruckSvg kind="pickup" className="w-48 absolute left-8 top-6" moving={done} />
        <div className="absolute left-[3.1rem] top-[2.6rem] w-7 h-6 bg-brand rounded-sm border border-brand-dark" style={{ animation: "pkg 1.2s ease-out both" }} />
      </div>
      {done && <div className="absolute right-4 top-3 w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xl" style={{ animation: "pop .5s 1.2s both" }}>✓</div>}
    </div>
  );
}

export const Logo = ({ light = false, size = 22 }: { light?: boolean; size?: number }) => (
  <div className="flex items-center gap-2 select-none" aria-label="HaulGo">
    <svg width={size + 6} height={size + 6} viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill={light ? "#fff" : "#3A3541"} /><path d="M12 40V24h24v16M36 28h10l6 7v5H36" fill="none" stroke={light ? "#3A3541" : "#fff"} strokeWidth="3.5" strokeLinejoin="round" /><circle cx="22" cy="43" r="4.5" fill="#A8651A" /><circle cx="44" cy="43" r="4.5" fill="#A8651A" /></svg>
    <span className={`font-extrabold tracking-[.14em] ${light ? "text-white" : "text-obsidian"}`} style={{ fontSize: size * 0.8 }}>HAUL<span className="text-brand">GO</span></span>
  </div>
);
