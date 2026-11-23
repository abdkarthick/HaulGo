import { useEffect, useRef, useState } from "react";
import { api, fileUrl, Role } from "../lib/api";
import { fmtTime, getPosition, playSound, usePoll, ago, fmtDate, soundPrefs } from "../lib/util";
import { useToast } from "../lib/session";
import { Chip, Photo, Sheet, Spinner, Switch, Warn } from "./ui";
import { useI18n } from "../lib/i18n";

/* ------------------------------------------------------------------ Chat */
export function ChatPanel({ role, bookingId, onClose }: { role: Role; bookingId: number; onClose: () => void }) {
  const toast = useToast();
  const [msgs, setMsgs] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const last = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const fetchNew = async () => {
    try {
      const r = await api(role, `/chat/${bookingId}/messages`, { query: { after: last.current } });
      setMeta(r);
      if (r.messages.length) {
        last.current = r.messages[r.messages.length - 1].id;
        setMsgs((m) => [...m, ...r.messages.filter((x: any) => !m.some((y) => y.id === x.id))]);
        if (!first.current && r.messages.some((x: any) => !x.mine && !x.system)) playSound("message");
        api(role, `/chat/${bookingId}/read`, { method: "POST" }).catch(() => {});
      }
      first.current = false;
    } catch { /* keep polling */ }
  };
  useEffect(() => { fetchNew(); const id = setInterval(() => !document.hidden && fetchNew(), 3000); return () => clearInterval(id); /* eslint-disable-next-line */ }, [bookingId]);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" }); }, [msgs.length]);
  const send = async (body: any) => {
    setBusy(true);
    try { await api(role, `/chat/${bookingId}/messages`, { body }); setText(""); await fetchNew(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  const shareLoc = async () => { try { const p = await getPosition(); await send({ kind: "location", lat: p.lat, lng: p.lng, body: "My current location" }); } catch (e: any) { toast(e.message, "err"); } };
  const sendImg = async (f?: File) => {
    if (!f) return; const form = new FormData(); form.append("file", f);
    setBusy(true); try { await api(role, `/chat/${bookingId}/image`, { form }); await fetchNew(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  const open = meta?.open;
  return (
    <Sheet open onClose={onClose} title={meta ? `Chat · ${meta.other_party || ""}` : "Chat"}>
      <div ref={box} className="h-[46vh] overflow-auto space-y-2 pr-1" aria-live="polite">
        <Warn tone="dark">🔒 Private chat for this booking. Phone numbers are hidden.</Warn>
        {msgs.map((m) => m.system ? (
          <p key={m.id} className="text-center text-[11px] text-steel py-1">{m.body}</p>
        ) : (
          <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${m.mine ? "bg-obsidian text-white rounded-br-md" : "bg-offwhite rounded-bl-md"}`}>
              {m.kind === "image" && m.attachment_id && <img src={fileUrl(role, m.attachment_id)} className="rounded-xl mb-1 max-h-44" alt="Shared" />}
              {m.kind === "location" ? <a className="underline font-semibold" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${m.lat},${m.lng}`}>📍 {m.body} (open map)</a> : m.kind !== "image" && <span>{m.body}</span>}
              <span className={`block text-[10px] mt-0.5 ${m.mine ? "text-white/50" : "text-steel"}`}>{fmtTime(m.at)}{m.mine ? (m.read ? " · ✓✓ read" : m.delivered ? " · ✓✓" : " · ✓") : ""}</span>
            </div>
          </div>
        ))}
        {!msgs.length && <p className="text-center text-sm text-steel py-8">No messages yet. Use a quick reply below.</p>}
      </div>
      {open ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {(meta?.quick_replies || []).map((q: string) => (
              <button key={q} disabled={busy} onClick={() => send({ kind: "quick", body: q })} className={`rounded-xl border border-line bg-white font-semibold hover:bg-offwhite ${role === "driver" ? "px-4 py-3.5 text-[15px] flex-1 min-w-[45%]" : "px-3 py-2 text-xs"}`}>{q}</button>
            ))}
          </div>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); text.trim() && send({ body: text }); }}>
            <button type="button" onClick={shareLoc} className="btn-ghost !px-3" aria-label="Share location">📍</button>
            <label className="btn-ghost !px-3 cursor-pointer" aria-label="Send photo">📷<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => sendImg(e.target.files?.[0])} /></label>
            <input className="input" placeholder={role === "driver" ? "Type only when stopped" : "Type a message"} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
            <button className="btn-primary" disabled={busy || !text.trim()}>{busy ? <Spinner /> : "Send"}</button>
          </form>
          {role === "driver" && <p className="text-[11px] text-steel mt-2">Please do not type while driving. Use the quick replies.</p>}
        </>
      ) : <div className="mt-3"><Warn>Chat is closed because the trip is completed or cancelled. For help, use Support / Complaint.</Warn></div>}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Contact panel: in-app chat / masked call */
export function ContactPanel({ role, booking, onChat, unread }: { role: "customer" | "driver"; booking: any; onChat: () => void; unread: number }) {
  const toast = useToast();
  const { t } = useI18n();
  const [callMsg, setCallMsg] = useState<string | null>(null);
  const live = booking.comms_open;
  const call = async () => {
    try { const r = await api(role, `/calls/${booking.id}/start`, { method: "POST" }); setCallMsg(r.message); } catch (e: any) { toast(e.message, "err"); }
  };
  return (
    <div className="card p-4">
      <p className="font-extrabold mb-3">{role === "customer" ? t("ct.contactDriver") : t("ct.contactCustomer")}</p>
      <div className="grid grid-cols-2 gap-2">
        <button disabled={!live} onClick={onChat} className="btn-dark relative">💬 {t("ct.chat")}{unread > 0 && <span className="absolute -top-2 -right-2 bg-brand text-white text-[11px] rounded-full min-w-5 h-5 px-1 flex items-center justify-center">{unread}</span>}</button>
        <button disabled={!live} onClick={call} className="btn-ghost">📞 {t("ct.call")}</button>
      </div>
      <p className="text-[11px] text-steel mt-2">{t("ct.privacy")}</p>
      <Sheet open={!!callMsg} onClose={() => setCallMsg(null)} title="Masked call"><p className="text-sm leading-relaxed">{callMsg}</p><button className="btn-dark w-full mt-4" onClick={() => setCallMsg(null)}>OK</button></Sheet>
    </div>
  );
}

/* ------------------------------------------------------------------ SOS */
export function SosButton({ role, bookingId, floating = true }: { role: Role; bookingId?: number; floating?: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [note, setNote] = useState("");
  const raise = async () => {
    setBusy(true);
    let pos: { lat?: number; lng?: number } = {};
    try { const p = await getPosition(6000); pos = { lat: p.lat, lng: p.lng }; } catch { /* server falls back to last known location */ }
    try { setRes(await api(role, "/sos", { body: { booking_id: bookingId, note: note || undefined, ...pos } })); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <>
      <button onClick={() => { setOpen(true); setRes(null); }} aria-label="SOS emergency help"
        className={`${floating ? "fixed right-4 bottom-24 z-[1200]" : ""} w-14 h-14 rounded-full bg-danger text-white font-extrabold text-sm shadow-xl animate-siren border-2 border-white`}>SOS</button>
      <Sheet open={open} onClose={() => setOpen(false)} title={res ? "SOS sent" : "Emergency help"}>
        {!res ? (
          <div className="space-y-4">
            <Warn tone="red">SOS alerts the HaulGo safety team with your booking, details and location. <b>It is not a replacement for police, ambulance or emergency services.</b> If you are in danger, call 112 first.</Warn>
            <p className="text-xs text-steel">We will use your device location (if you allow it) only to help the safety team find you. Otherwise your last known trip location is shared.</p>
            <textarea className="input" rows={2} maxLength={400} placeholder="What is happening? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn-primary w-full !py-4 text-base" disabled={busy} onClick={raise}>{busy ? <Spinner /> : "Send SOS alert now"}</button>
            <a href="tel:112" className="btn-dark w-full">📞 Call 112 emergency</a>
          </div>
        ) : (
          <div className="space-y-4">
            <Warn tone="dark">{res.message}</Warn>
            <div className="grid grid-cols-2 gap-2">{Object.entries(res.emergency_numbers).map(([k, v]) => <a key={k} href={`tel:${v}`} className="btn-ghost justify-between"><span>{k}</span><b>{v as string}</b></a>)}</div>
            <p className="text-xs text-steel">Location shared: {res.location === "live" ? "live" : res.location === "last_known" ? "last known" : "not available"}. The alert stays active until the team acknowledges it.</p>
          </div>
        )}
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------------ Complaints */
export function ComplaintCenter({ role, bookingId, onClose }: { role: Role; bookingId?: number; onClose: () => void }) {
  const toast = useToast();
  const { t } = useI18n();
  const cats = usePoll(() => api<string[]>(role, "/complaints/categories"), 600000);
  const mine = usePoll(() => api<any[]>(role, "/complaints/mine"), 15000);
  const [view, setView] = useState<"new" | "list">(bookingId ? "new" : "list");
  const [cat, setCat] = useState("");
  const [desc, setDesc] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const f = new FormData(); f.append("category", cat); f.append("description", desc); if (bookingId) f.append("booking_id", String(bookingId)); files.forEach((x) => f.append("files", x));
      await api(role, "/complaints", { form: f }); toast(t("ts.complaint"), "ok"); setDesc(""); setCat(""); setFiles([]); setView("list"); mine.reload();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} title="Help & complaints" wide>
      <div className="flex gap-2 mb-4"><button className={view === "new" ? "btn-dark btn-sm" : "btn-ghost btn-sm"} onClick={() => setView("new")}>New complaint</button><button className={view === "list" ? "btn-dark btn-sm" : "btn-ghost btn-sm"} onClick={() => setView("list")}>My complaints</button></div>
      {view === "new" ? (
        <div className="space-y-3">
          <Warn>For emergencies use the SOS button or call 112. Complaints are non-urgent and reviewed by our team.</Warn>
          <div className="flex flex-wrap gap-2">{(cats.data || []).map((c) => <button key={c} onClick={() => setCat(c)} className={`chip !text-xs !px-3 !py-2 ${cat === c ? "bg-obsidian text-white" : "bg-offwhite"}`}>{c}</button>)}</div>
          <textarea className="input" rows={4} maxLength={1000} placeholder="Describe the problem (min 10 characters)" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <label className="btn-ghost btn-sm cursor-pointer w-fit">📷 Add photos ({files.length}/4)<input type="file" accept="image/*" multiple hidden onChange={(e) => setFiles([...files, ...Array.from(e.target.files || [])].slice(0, 4))} /></label>
          <button className="btn-primary w-full" disabled={busy || !cat || desc.trim().length < 10} onClick={submit}>{busy ? <Spinner /> : "Submit complaint"}</button>
        </div>
      ) : (
        <div className="space-y-3">
          {!mine.data?.length && <p className="text-sm text-steel text-center py-8">No complaints yet.</p>}
          {mine.data?.map((c) => (
            <div key={c.id} className="rounded-2xl border border-line p-4">
              <div className="flex justify-between items-start gap-2"><p className="font-bold text-sm">#{c.id} · {c.category}</p><Chip tone={c.status === "resolved" ? "green" : c.status === "in_review" ? "blue" : "amber"}>{c.status.replace("_", " ")}</Chip></div>
              <p className="text-sm mt-1 text-steel">{c.description}</p>
              {c.photos.length > 0 && <div className="flex gap-2 mt-2">{c.photos.map((p: number) => <Photo key={p} src={fileUrl(role, p)} />)}</div>}
              {c.admin_response && <div className="mt-3 rounded-xl bg-offwhite p-3 text-sm"><p className="text-[11px] font-bold text-steel uppercase">HaulGo response</p>{c.admin_response}</div>}
              <p className="text-[11px] text-steel mt-2">{fmtDate(c.created_at)}</p>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Notifications */
export function NotificationCenter({ role, onClose }: { role: Role; onClose: () => void }) {
  const n = usePoll(() => api(role, "/notifications"), 8000);
  const [snd, setSnd] = useState(soundPrefs.get());
  useEffect(() => { if (n.data?.unread) api(role, "/notifications/read", { method: "POST" }).catch(() => {}); }, [n.data?.unread, role]);
  return (
    <Sheet open onClose={onClose} title="Notifications" footer={<button className="btn-dark w-full" onClick={onClose}>Close</button>}>
      <div className="flex items-center justify-between rounded-xl bg-offwhite p-3 mb-3"><span className="text-sm font-semibold">Sound alerts</span><Switch on={snd} label="Sound alerts" onChange={(v) => { setSnd(v); soundPrefs.set(v); }} /></div>
      {!n.data?.items.length && <p className="text-center text-sm text-steel py-8">You are all caught up.</p>}
      <ul className="space-y-2">
        {n.data?.items.map((x: any) => (
          <li key={x.id} className={`rounded-xl border p-3 ${x.read ? "border-line" : "border-brand/40 bg-brand/5"}`}>
            <p className="font-bold text-sm">{x.title}</p><p className="text-sm text-steel">{x.body}</p><p className="text-[11px] text-steel mt-1">{ago(x.created_at)}</p>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** Polls notifications + chat unread, shows toasts and plays sound on new items (foreground alerts). */
export function useLiveAlerts(role: Role, enabled: boolean) {
  const toast = useToast();
  const seen = useRef<number>(-1);
  const [unread, setUnread] = useState(0);
  const [chatUnread, setChatUnread] = useState<{ total: number; bookings: Record<string, number> }>({ total: 0, bookings: {} });
  const lastChat = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const n = await api(role, "/notifications");
        if (stop) return;
        setUnread(n.unread);
        const top = n.items[0]?.id ?? 0;
        if (seen.current >= 0) {
          const fresh = n.items.filter((x: any) => x.id > seen.current && !x.read);
          fresh.slice(0, 2).forEach((x: any) => toast(`${x.title}: ${x.body}`));
          if (fresh.some((x: any) => x.kind === "new_trip_request")) playSound("trip");
          else if (fresh.some((x: any) => x.kind === "admin_sos")) playSound("trip");
        }
        seen.current = Math.max(seen.current, top);
        if (role !== "admin") {
          const c = await api(role, "/chat-unread");
          if (c.total > lastChat.current && lastChat.current >= 0) playSound("message");
          lastChat.current = c.total; setChatUnread(c);
        }
      } catch { /* offline */ }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, enabled]);
  return { unread, chatUnread };
}
