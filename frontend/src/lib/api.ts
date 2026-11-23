import { translateError } from "./i18n";
export type Role = "customer" | "driver" | "admin";

const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

const tk = (r: Role) => `hg_token_${r}`;
// Tokens live in sessionStorage: every new tab / app launch starts at the login page (by design).
export const tokens = {
  get: (r: Role) => sessionStorage.getItem(tk(r)),
  set: (r: Role, v: string) => sessionStorage.setItem(tk(r), v),
  clear: (r: Role) => sessionStorage.removeItem(tk(r)),
};
// Role choice and last phone are remembered across sessions (convenience only, never a credential).
export const remembered = {
  role: (): Role | null => (localStorage.getItem("hg_role") as Role | null),
  setRole: (r: Role) => localStorage.setItem("hg_role", r),
  phone: (r: Role) => localStorage.getItem(`hg_phone_${r}`) || "",
  setPhone: (r: Role, p: string) => localStorage.setItem(`hg_phone_${r}`, p),
};

export class ApiError extends Error {
  status: number;
  constructor(msg: string, status: number) { super(msg); this.status = status; }
}

function errMsg(d: any): string {
  if (!d) return "Something went wrong. Please try again.";
  if (typeof d.detail === "string") return translateError(d.detail);
  if (Array.isArray(d.detail)) {
    return d.detail.map((x: any) => `${(x.loc || []).slice(1).join(" › ")} ${x.msg}`.trim()).join("; ");
  }
  return "Something went wrong. Please try again.";
}

type Opts = { method?: string; body?: any; form?: FormData; query?: Record<string, any> };

export async function api<T = any>(role: Role, path: string, o: Opts = {}): Promise<T> {
  const t = tokens.get(role);
  const headers: Record<string, string> = {};
  if (t) headers.Authorization = `Bearer ${t}`;
  let body: BodyInit | undefined;
  if (o.form) body = o.form;
  else if (o.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(o.body); }
  let url = API_BASE ? `${API_BASE}/api${path}` : `/api${path}`;
  if (o.query) {
    const q = new URLSearchParams();
    Object.entries(o.query).forEach(([k, v]) => v !== undefined && v !== null && v !== "" && q.set(k, String(v)));
    const s = q.toString();
    if (s) url += (url.includes("?") ? "&" : "?") + s;
  }
  let res: Response;
  try {
    res = await fetch(url, { method: o.method || (body ? "POST" : "GET"), headers, body });
  } catch {
    throw new ApiError("Cannot reach the server. Check your internet connection.", 0);
  }
  if (res.status === 401 && t) {
    tokens.clear(role);
    window.dispatchEvent(new CustomEvent("hg-logout", { detail: role }));
  }
  if (!res.ok) {
    let d: any = null;
    try { d = await res.json(); } catch { /* ignore */ }
    if (!d && res.status >= 500) throw new ApiError(`Backend not reachable or crashed (HTTP ${res.status}). Make sure the backend is running on port 8000.`, res.status);
    throw new ApiError(errMsg(d), res.status);
  }
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("json") ? await res.json() : (await res.blob())) as T;
}

export const fileUrl = (role: Role, id: number) => `${API_BASE}/api/files/${id}?t=${tokens.get(role) || ""}`;
export const downloadAuthed = async (role: Role, path: string, name: string) => {
  const blob = await api<Blob>(role, path);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
export const openAuthed = async (role: Role, path: string) => {
  const blob = await api<Blob>(role, path);
  window.open(URL.createObjectURL(blob), "_blank");
};