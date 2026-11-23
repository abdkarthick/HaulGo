import { useCallback, useEffect, useRef, useState } from "react";

export const money = (n?: number | null) => (n === undefined || n === null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN"));
export const km = (n?: number | null) => (n === undefined || n === null ? "—" : `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} km`);

export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
export const fmtTime = (s?: string | null) => (s ? new Date(s).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "");
export const ago = (s?: string | null) => {
  if (!s) return "never";
  const sec = Math.max(0, (Date.now() - new Date(s).getTime()) / 1000);
  if (sec < 60) return `${Math.floor(sec)}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h ago`;
  return `${Math.floor(sec / 86400)} d ago`;
};

export const STATUS: Record<string, { label: string; tone: string }> = {
  quotation_requested: { label: "Quotation requested", tone: "amber" },
  quotation_sent: { label: "Quotation ready", tone: "amber" },
  awaiting_payment: { label: "Awaiting payment", tone: "amber" },
  pending_assignment: { label: "Finding driver", tone: "blue" },
  driver_assigned: { label: "Driver assigned", tone: "blue" },
  driver_accepted: { label: "Driver on the way", tone: "green" },
  driver_reached: { label: "Driver at pickup", tone: "green" },
  pickup_verified: { label: "Goods picked up", tone: "green" },
  in_transit: { label: "In transit", tone: "brand" },
  delivery_pending: { label: "Arrived at drop", tone: "brand" },
  delivered: { label: "Delivered", tone: "green" },
  completed: { label: "Completed", tone: "dark" },
  cancelled: { label: "Cancelled", tone: "grey" },
  refund_pending: { label: "Refund pending", tone: "amber" },
  refunded: { label: "Refunded", tone: "grey" },
};
export const TONES: Record<string, string> = {
  amber: "bg-amber-100 text-amber-800", blue: "bg-sky-100 text-sky-800", green: "bg-emerald-100 text-emerald-800",
  brand: "bg-brand/10 text-brand", red: "bg-danger/10 text-danger", dark: "bg-obsidian text-white", grey: "bg-neutral-200 text-neutral-700",
};
export const CATEGORIES: [string, string][] = [
  ["raw_materials", "Raw materials"], ["finished_products", "Finished products"], ["industrial_components", "Industrial components"],
  ["machinery", "Machinery"], ["equipment", "Equipment"], ["packaging_materials", "Packaging materials"], ["general_commercial", "General commercial goods"],
];
export const PAY_LABEL: Record<string, string> = { online: "Online (UPI / card / net banking)", cod: "Cash on delivery", credit: "Monthly business credit" };

export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: any[] = [], enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(async () => {
    try { setData(await fnRef.current()); setError(null); } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    run();
    const id = setInterval(() => { if (!document.hidden) run(); }, ms);
    const vis = () => { if (!document.hidden) run(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", vis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, enabled, ...deps]);
  return { data, error, loading, reload: run, setData };
}

export function useCountdown(iso?: string | null, fallbackSeconds?: number) {
  const target = useRef<number>(0);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    target.current = iso ? new Date(iso).getTime() : Date.now() + (fallbackSeconds || 0) * 1000;
    const tick = () => setLeft(Math.max(0, Math.ceil((target.current - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [iso, fallbackSeconds]);
  return left;
}

// ---- sound alerts (WebAudio, no files). Respect user settings; never loop continuously.
let ac: AudioContext | null = null;
export const soundPrefs = {
  get: () => localStorage.getItem("hg_sound") !== "off",
  set: (on: boolean) => localStorage.setItem("hg_sound", on ? "on" : "off"),
};
function tone(freq: number, start: number, dur: number, vol = 0.12, type: OscillatorType = "sine") {
  if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, ac.currentTime + start);
  g.gain.linearRampToValueAtTime(vol, ac.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + dur);
  o.connect(g).connect(ac.destination);
  o.start(ac.currentTime + start); o.stop(ac.currentTime + start + dur + 0.05);
}
export function unlockAudio() {
  try { ac = ac || new (window.AudioContext || (window as any).webkitAudioContext)(); if (ac.state === "suspended") ac.resume(); } catch { /* no audio */ }
}
export function playSound(kind: "message" | "trip") {
  if (!soundPrefs.get()) return;
  unlockAudio();
  if (kind === "message") { tone(880, 0, 0.12); tone(1320, 0.13, 0.16); }
  else { [0, 0.35, 0.7].forEach((t) => { tone(660, t, 0.18, 0.18, "square"); tone(990, t + 0.18, 0.16, 0.18, "square"); }); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); }
}
if (typeof window !== "undefined") {
  const once = () => { unlockAudio(); window.removeEventListener("pointerdown", once); };
  window.addEventListener("pointerdown", once);
}

export function getPosition(timeout = 8000): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error("Location is not supported on this device"));
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => rej(new Error(e.code === 1 ? "Location permission denied. Allow location access in your browser/app settings." : "Could not get your location")),
      { enableHighAccuracy: true, timeout, maximumAge: 15000 },
    );
  });
}

export function tel(p?: string) { return p ? `tel:${p}` : undefined; }
