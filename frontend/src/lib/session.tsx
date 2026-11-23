import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, remembered, Role, tokens } from "./api";

export type Me = { id: number; role: Role; name?: string; phone?: string; email?: string; company_name?: string; gstin?: string; contact_person?: string; business_phone?: string; verified?: boolean; profile_complete?: boolean; driver_status?: string; admin_level?: string };
type Ctx = { role: Role; me: Me | null; loading: boolean; setSession: (token: string, me: Me) => void; refresh: () => Promise<void>; logout: () => void };
const C = createContext<Ctx>(null as any);
export const useSession = () => useContext(C);

export function SessionProvider({ role, children }: { role: Role; children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!tokens.get(role));
  const refresh = useCallback(async () => {
    if (!tokens.get(role)) { setMe(null); setLoading(false); return; }
    try { setMe(await api<Me>(role, "/me")); } catch { setMe(null); } finally { setLoading(false); }
  }, [role]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const h = (e: Event) => { if ((e as CustomEvent).detail === role) setMe(null); };
    window.addEventListener("hg-logout", h);
    return () => window.removeEventListener("hg-logout", h);
  }, [role]);
  const setSession = (token: string, m: Me) => { tokens.set(role, token); if (role !== "admin") remembered.setRole(role); setMe(m); };
  const logout = () => { tokens.clear(role); setMe(null); };
  return <C.Provider value={{ role, me, loading, setSession, refresh, logout }}>{children}</C.Provider>;
}

// ---- toast
type Toast = { id: number; msg: string; tone: "ok" | "err" | "info" };
const T = createContext<{ toast: (m: string, tone?: Toast["tone"]) => void }>({ toast: () => {} });
export const useToast = () => useContext(T).toast;
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((msg: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, msg, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4200);
  }, []);
  return (
    <T.Provider value={{ toast }}>
      {children}
      <div className="fixed z-[2000] top-3 left-0 right-0 flex flex-col items-center gap-2 px-3 pointer-events-none" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`animate-rise pointer-events-auto max-w-md w-full rounded-xl px-4 py-3 text-sm font-medium shadow-card border ${t.tone === "err" ? "bg-brand text-white border-brand" : t.tone === "ok" ? "bg-obsidian text-white border-obsidian" : "bg-white text-obsidian border-line"}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </T.Provider>
  );
}
