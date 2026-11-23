import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { truckSprite } from "./Truck3D";

export type Pt = { lat: number; lng: number };

const pin = (color: string, label: string) =>
  L.divIcon({ className: "hg-marker", iconSize: [34, 42], iconAnchor: [17, 40],
    html: `<div style="width:34px;height:34px;border-radius:50% 50% 50% 4px;transform:rotate(-45deg);background:${color};border:3px solid #fff;box-shadow:0 4px 12px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);color:#fff;font:800 13px Manrope,sans-serif">${label}</span></div>` });
const dot = (color: string) => L.divIcon({ className: "hg-marker", iconSize: [14, 14], iconAnchor: [7, 7], html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>` });
const truckIcon = (deg: number, stale: boolean) =>
  L.divIcon({ className: "hg-marker", iconSize: [44, 44], iconAnchor: [22, 22],
    html: `<div style="width:44px;height:44px;border-radius:50%;background:${stale ? "#7A7480" : "#3A3541"};border:3px solid #fff;box-shadow:0 4px 14px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;transform:rotate(${deg}deg);transition:transform .6s"><svg width="26" height="26" viewBox="0 0 64 64"><path d="M10 38V22h24v16M34 27h11l7 8v3H34z" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><circle cx="21" cy="41" r="5" fill="#A8651A"/><circle cx="44" cy="41" r="5" fill="#A8651A"/></svg></div>` });

/** Top-down render of the real 3D truck model (see truckSprite) rotated to the heading. Falls back to the round badge. */
const spriteIcon = (url: string, deg: number, stale: boolean) =>
  L.divIcon({ className: "hg-marker", iconSize: [34, 78], iconAnchor: [17, 39],
    html: `<div style="width:34px;height:78px;transform:rotate(${deg}deg);transition:transform .8s;filter:drop-shadow(0 6px 6px rgba(0,0,0,.45))${stale ? " grayscale(1) opacity(.75)" : ""}"><img src="${url}" alt="" style="width:100%;height:100%;object-fit:contain"/></div>` });

function bearing(a: [number, number], b: [number, number]) {
  const toR = (x: number) => (x * Math.PI) / 180;
  const y = Math.sin(toR(b[1] - a[1])) * Math.cos(toR(b[0]));
  const x = Math.cos(toR(a[0])) * Math.sin(toR(b[0])) - Math.sin(toR(a[0])) * Math.cos(toR(b[0])) * Math.cos(toR(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Truck marker that glides between real GPS fixes (no fake movement: it only interpolates between received positions). */
function TruckMarker({ at, stale }: { at: Pt; stale?: boolean }) {
  const [pos, setPos] = useState<[number, number]>([at.lat, at.lng]);
  const cur = useRef<[number, number]>([at.lat, at.lng]);
  const [deg, setDeg] = useState(90);
  useEffect(() => {
    const from = cur.current, to: [number, number] = [at.lat, at.lng];
    if (Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]) < 1e-7) return;
    setDeg(bearing(from, to)); // sprite faces north (up); bearing is clockwise from north
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min((t - t0) / 1800, 1);
      const p: [number, number] = [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k];
      cur.current = p; setPos(p);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [at.lat, at.lng]);
  const [sprite, setSprite] = useState<string | null>(null);
  useEffect(() => { let on = true; truckSprite().then((u) => on && setSprite(u)); return () => { on = false; }; }, []);
  const icon = useMemo(() => (sprite ? spriteIcon(sprite, deg, !!stale) : truckIcon(0, !!stale)), [deg, stale, sprite]);
  return <Marker position={pos} icon={icon} zIndexOffset={1000} />;
}

function Fit({ pts, key2 }: { pts: Pt[]; key2: string }) {
  const map = useMap();
  useEffect(() => {
    if (!pts.length) return;
    if (pts.length === 1) { map.setView([pts[0].lat, pts[0].lng], Math.max(map.getZoom(), 14)); return; }
    map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key2]);
  return null;
}
function Clicks({ onPick }: { onPick: (p: Pt) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}
function Resize() { const m = useMap(); useEffect(() => { setTimeout(() => m.invalidateSize(), 250); }, [m]); return null; }

export default function MapView({ height = 260, pickup, drop, driver, driverStale, route, pickMode, onPick, extras = [], className = "", center }: {
  height?: number | string; pickup?: Pt | null; drop?: Pt | null; driver?: Pt | null; driverStale?: boolean; route?: [number, number][]; pickMode?: "pickup" | "drop" | null;
  onPick?: (p: Pt, which: "pickup" | "drop") => void; extras?: (Pt & { color?: string; label?: string })[]; className?: string; center?: Pt;
}) {
  const pts = [pickup, drop].filter(Boolean) as Pt[];
  const key2 = pts.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join("|");
  const c = center || pickup || drop || { lat: 13.0827, lng: 80.2707 };
  const pi = useMemo(() => pin("#2E9E5B", "P"), []), di = useMemo(() => pin("#A8651A", "D"), []);
  return (
    <div className={`overflow-hidden rounded-2xl border border-line ${className}`} style={{ height }}>
      <MapContainer center={[c.lat, c.lng]} zoom={13} style={{ height: "100%", width: "100%" }} scrollWheelZoom attributionControl>
        <Resize />
        <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Fit pts={pts} key2={key2} />
        {pickMode && onPick && <Clicks onPick={(p) => onPick(p, pickMode)} />}
        {route && route.length > 1 && <Polyline positions={route} pathOptions={{ color: "#A8651A", weight: 5, opacity: 0.85 }} />}
        {pickup && <Marker position={[pickup.lat, pickup.lng]} icon={pi} draggable={pickMode === "pickup"} eventHandlers={{ dragend: (e) => onPick?.({ lat: (e.target as L.Marker).getLatLng().lat, lng: (e.target as L.Marker).getLatLng().lng }, "pickup") }} />}
        {drop && <Marker position={[drop.lat, drop.lng]} icon={di} draggable={pickMode === "drop"} eventHandlers={{ dragend: (e) => onPick?.({ lat: (e.target as L.Marker).getLatLng().lat, lng: (e.target as L.Marker).getLatLng().lng }, "drop") }} />}
        {extras.map((x, i) => <Marker key={i} position={[x.lat, x.lng]} icon={dot(x.color || "#3A3541")} />)}
        {driver && <TruckMarker at={driver} stale={driverStale} />}
      </MapContainer>
    </div>
  );
}
