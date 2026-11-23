import { useState } from "react";
import { api, downloadAuthed } from "../lib/api";
import { ago, fmtDate, usePoll } from "../lib/util";
import { useToast } from "../lib/session";
import { Chip, Field, Loading, Sheet, Tabs, Warn } from "../components/ui";
import MapView from "../components/MapView";
import { PageHead, Table } from "./kit";

export function Safety() {
  const toast = useToast();
  const [tab, setTab] = useState("sos");
  const sos = usePoll(() => api("admin", "/admin/sos"), 4000);
  const cmp = usePoll(() => api<any[]>("admin", "/admin/complaints"), 10000);
  const [sel, setSel] = useState<any>(null);
  const [note, setNote] = useState("");
  const [c, setC] = useState<any>(null);
  const [resp, setResp] = useState("");
  const alerts = sos.data?.alerts || [];
  const activeCount = alerts.filter((a: any) => a.status === "active").length;
  const act = async (id: number, action: string) => { try { const r = await api("admin", `/admin/sos/${id}`, { body: { action, note: note || null } }); toast("Logged", "ok"); setNote(""); setSel(r); sos.reload(); } catch (e: any) { toast(e.message, "err"); } };
  const cact = async (status: string) => { try { await api("admin", `/admin/complaints/${c.id}`, { body: { status, response: resp || null } }); toast("Updated", "ok"); setC(null); setResp(""); cmp.reload(); } catch (e: any) { toast(e.message, "err"); } };
  const cur = sel ? alerts.find((a: any) => a.id === sel.id) || sel : null;
  return (
    <div className="space-y-4">
      <PageHead title="Emergency and safety centre"><Tabs value={tab} onChange={setTab} items={[["sos", "SOS alerts", activeCount], ["complaints", "Complaints", (cmp.data || []).filter((x) => ["open", "in_review"].includes(x.status)).length]]} /></PageHead>
      {sos.data && <div className="flex flex-wrap gap-2 text-sm"><span className="text-steel font-semibold">Emergency numbers:</span>{Object.entries(sos.data.emergency_numbers).map(([k, v]) => <a key={k} href={`tel:${v}`} className="chip bg-white border border-line font-bold">{k} {v as string}</a>)}</div>}
      {tab === "sos" && (!sos.data ? <Loading /> : (
        <div className="space-y-3">
          {!alerts.length && <div className="card p-8 text-center text-steel">No SOS alerts. They appear here instantly with a siren alert when a customer or driver presses SOS.</div>}
          {alerts.map((a: any) => (
            <button key={a.id} onClick={() => setSel(a)} className={`card w-full text-left p-4 flex items-center justify-between gap-3 ${a.status === "active" ? "border-brand bg-red-50" : ""}`}>
              <div><p className="font-extrabold">{a.status === "active" && "🚨 "}SOS #{a.id} · {a.role} · {a.booking || "no booking"}</p><p className="text-sm text-steel">{a.note || "No message"} · {ago(a.at)}</p></div>
              <Chip tone={a.status === "active" ? "red" : a.status === "acknowledged" ? "amber" : "green"}>{a.status}</Chip>
            </button>))}
        </div>
      ))}
      {tab === "complaints" && <Table loading={cmp.loading} rows={cmp.data} onRow={(r) => { setC(r); setResp(r.admin_response || ""); }} empty="No complaints" cols={[["#", (r: any) => r.id], ["From", (r: any) => `${r.user} (${r.role})`], ["Booking", (r: any) => r.booking || "—"], ["Category", (r: any) => r.category.replace(/_/g, " ")], ["Description", (r: any) => <span className="text-xs">{r.description.slice(0, 80)}</span>], ["Status", (r: any) => <Chip tone={r.status === "resolved" ? "green" : r.status === "rejected" ? "red" : "amber"}>{r.status.replace("_", " ")}</Chip>], ["At", (r: any) => fmtDate(r.at)]]} />}

      {cur && (
        <Sheet open onClose={() => setSel(null)} title={`SOS #${cur.id}`} wide>
          <div className="space-y-4">
            <div className="flex gap-2 flex-wrap"><Chip tone={cur.status === "active" ? "red" : cur.status === "acknowledged" ? "amber" : "green"}>{cur.status}</Chip><Chip>{cur.role}</Chip>{cur.booking && <Chip>{cur.booking}</Chip>}<Chip>{fmtDate(cur.at)}</Chip></div>
            {cur.note && <Warn tone="red">{cur.note}</Warn>}
            {cur.lat != null ? <MapView height={220} pickup={{ lat: cur.lat, lng: cur.lng }} /> : <Warn>No GPS location was available when the alert was raised.{cur.location ? ` Note: ${cur.location}` : ""}</Warn>}
            {cur.snapshot && Object.keys(cur.snapshot).length > 0 && <div className="rounded-2xl border border-line p-4"><p className="font-extrabold mb-1">Trip snapshot at the time of alert</p>{Object.entries(cur.snapshot).map(([k, v]) => <p key={k} className="text-sm"><span className="text-steel">{k.replace(/_/g, " ")}:</span> {typeof v === "object" ? JSON.stringify(v) : String(v)}</p>)}</div>}
            {cur.status !== "resolved" && (
              <div className="space-y-2"><Field label="Note / resolution"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you do? (required to resolve)" /></Field>
                <div className="flex gap-2 flex-wrap">{cur.status === "active" && <button className="btn-primary btn-sm" onClick={() => act(cur.id, "acknowledge")}>Acknowledge</button>}<button className="btn-ghost btn-sm" onClick={() => act(cur.id, "contacted_customer")}>Logged: contacted customer</button><button className="btn-ghost btn-sm" onClick={() => act(cur.id, "contacted_driver")}>Logged: contacted driver</button><button className="btn-ghost btn-sm" disabled={!note} onClick={() => act(cur.id, "note")}>Add note</button><button className="btn-dark btn-sm" disabled={!note} onClick={() => act(cur.id, "resolve")}>Resolve</button></div></div>)}
            <div className="rounded-2xl border border-line p-4"><p className="font-extrabold mb-1">Action log</p>{cur.actions.map((x: any, i: number) => <p key={i} className="text-sm py-1"><b>{x.action.replace(/_/g, " ")}</b> <span className="text-xs text-steel">{fmtDate(x.at)} · admin #{x.actor}{x.note ? ` · ${x.note}` : ""}</span></p>)}{!cur.actions.length && <p className="text-sm text-steel">No actions yet.</p>}</div>
          </div>
        </Sheet>
      )}
      {c && (
        <Sheet open onClose={() => setC(null)} title={`Complaint #${c.id}`}>
          <div className="space-y-3">
            <p className="text-sm"><b>{c.user}</b> ({c.role}) · {c.booking || "no booking"} · {c.category.replace(/_/g, " ")}</p><p className="text-sm bg-offwhite rounded-xl p-3">{c.description}</p>
            {c.events.map((e: any, i: number) => <p key={i} className="text-xs text-steel">{fmtDate(e.at)} · {e.actor} · {e.status}: {e.text}</p>)}
            <Field label="Response to user"><textarea className="input" rows={3} value={resp} onChange={(e) => setResp(e.target.value)} /></Field>
            <div className="flex gap-2 flex-wrap"><button className="btn-ghost btn-sm" onClick={() => cact("in_review")}>Mark in review</button><button className="btn-dark btn-sm" onClick={() => cact("resolved")}>Resolve</button><button className="btn-ghost btn-sm !text-danger" onClick={() => cact("rejected")}>Reject</button></div>
          </div>
        </Sheet>
      )}
    </div>
  );
}

export function Communication() {
  const toast = useToast();
  const [tab, setTab] = useState("logs");
  const { data, reload } = usePoll(() => api("admin", "/admin/communication"), 10000);
  const [tpl, setTpl] = useState<any>(null);
  const [chatId, setChatId] = useState("");
  const [chat, setChat] = useState<any>(null);
  if (!data) return <Loading />;
  const saveTpl = async () => { try { const { id, event, to_receiver, ...body } = tpl; await api("admin", `/admin/templates/${id}`, { method: "PUT", body }); toast("Template saved", "ok"); setTpl(null); reload(); } catch (e: any) { toast(e.message, "err"); } };
  const tone = (s: string) => (s === "sent" || s === "delivered" ? "green" : s === "failed" ? "red" : "amber");
  return (
    <div className="space-y-4">
      <PageHead title="Communication"><Tabs value={tab} onChange={setTab} items={[["logs", "Notification logs"], ["calls", "Call sessions"], ["pickup", "Pickup help", data.pickup_requests.filter((p: any) => p.open).length], ["templates", "Templates"], ["chat", "Chat investigation"]]} /></PageHead>
      <div className="grid grid-cols-3 gap-3 text-center"><div className="card p-3"><p className="text-xs text-steel">Chat messages</p><b className="text-xl">{data.stats.chat_messages}</b></div><div className="card p-3"><p className="text-xs text-steel">Call sessions</p><b className="text-xl">{data.stats.calls}</b></div><div className="card p-3"><p className="text-xs text-steel">External not delivered</p><b className="text-xl">{data.stats.undelivered_external}</b></div></div>
      {tab === "logs" && (<><Warn>SMS and push show "not_configured" until a provider (DLT-approved SMS gateway, FCM) is set up in the server environment. Nothing is pretended as sent.</Warn>
        <Table rows={data.notification_logs} empty="No external notifications logged" cols={[["Event", (r: any) => r.event.replace(/_/g, " ")], ["Channel", (r: any) => <Chip>{r.channel}</Chip>], ["To", (r: any) => <span className="text-xs">{r.recipient}</span>], ["Status", (r: any) => <Chip tone={tone(r.status)}>{r.status.replace("_", " ")}</Chip>], ["Detail", (r: any) => <span className="text-xs">{r.detail}</span>], ["At", (r: any) => fmtDate(r.at)]]} /></>)}
      {tab === "calls" && <Table rows={data.call_sessions} empty="No call sessions" cols={[["#", (r: any) => r.id], ["Booking", (r: any) => r.booking_id], ["Provider", (r: any) => <Chip tone={r.provider === "demo" ? "amber" : "green"}>{r.provider}</Chip>], ["Status", (r: any) => r.status], ["Detail", (r: any) => <span className="text-xs">{r.detail}</span>], ["At", (r: any) => fmtDate(r.at)]]} />}
      {tab === "pickup" && <Table rows={data.pickup_requests} empty="No pickup help requests" cols={[["Booking", (r: any) => <b>{r.code}</b>], ["Pickup", (r: any) => <span className="text-xs">{r.pickup}</span>], ["Status", (r: any) => r.status.replace(/_/g, " ")], ["Requested", (r: any) => fmtDate(r.requested_at)], ["", (r: any) => (r.open ? <Chip tone="amber">driver waiting</Chip> : <Chip tone="green">closed</Chip>)]]} />}
      {tab === "templates" && <Table rows={data.templates} onRow={(r) => setTpl({ ...r })} cols={[["Event", (r: any) => <b>{r.event.replace(/_/g, " ")}</b>], ["Title", (r: any) => r.title], ["Message", (r: any) => <span className="text-xs">{r.body}</span>], ["Channels", (r: any) => <span className="text-xs">{["in-app", r.sms && "SMS", r.email && "email"].filter(Boolean).join(", ")}</span>], ["On", (r: any) => (r.enabled ? <Chip tone="green">on</Chip> : <Chip>off</Chip>)]]} />}
      {tab === "chat" && (
        <div className="card p-4 space-y-3"><p className="text-sm text-steel">Chats are private between customer and driver. Admin can open one only to investigate a complaint; every access is recorded in the audit log.</p>
          <div className="flex gap-2"><input className="input !w-56" type="number" placeholder="Booking ID" value={chatId} onChange={(e) => setChatId(e.target.value)} /><button className="btn-dark btn-sm" disabled={!chatId} onClick={async () => { try { setChat(await api("admin", `/admin/chat/${chatId}`)); } catch (e: any) { toast(e.message, "err"); } }}>Open (audited)</button></div>
          {chat && <div className="rounded-2xl bg-obsidian text-white p-4 max-h-96 overflow-auto space-y-1.5 text-sm"><p className="font-bold">{chat.booking}</p>{chat.messages.map((m: any) => <p key={m.id}><span className="text-white/50 text-xs">{fmtDate(m.at)} · {m.from}:</span> {m.kind === "location" ? `📍 ${m.lat},${m.lng}` : m.body}</p>)}{!chat.messages.length && <p className="text-white/50">No messages.</p>}</div>}</div>)}
      {tpl && (
        <Sheet open onClose={() => setTpl(null)} title={`Template: ${tpl.event}`}>
          <div className="space-y-3"><Field label="Title"><input className="input" value={tpl.title} onChange={(e) => setTpl({ ...tpl, title: e.target.value })} /></Field><Field label="Message" hint="Placeholders such as {code} are filled by the system. Never put phone numbers or OTP-revealing text."><textarea className="input" rows={3} value={tpl.body} onChange={(e) => setTpl({ ...tpl, body: e.target.value })} /></Field>
            <div className="flex gap-4 flex-wrap text-sm">{(["sms", "email", "enabled"] as const).map((k) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={tpl[k]} onChange={(e) => setTpl({ ...tpl, [k]: e.target.checked })} />{k}</label>)}</div>
            <button className="btn-primary" onClick={saveTpl}>Save template</button></div>
        </Sheet>
      )}
    </div>
  );
}

export function Reports() {
  const toast = useToast();
  const audit = usePoll(() => api<any[]>("admin", "/admin/audit"), 30000);
  const dl = async (n: string) => { try { await downloadAuthed("admin", `/admin/reports/${n}.csv`, `haulgo-${n}.csv`); } catch (e: any) { toast(e.message, "err"); } };
  return (
    <div className="space-y-4">
      <PageHead title="Reports and audit log" />
      <div className="card p-4"><p className="font-extrabold mb-3">Download CSV reports</p><div className="flex gap-2 flex-wrap">{[["bookings", "Bookings"], ["payments", "Payments"], ["commission", "Commission"], ["payouts", "Driver payouts"], ["credit", "Credit accounts"]].map(([k, l]) => <button key={k} className="btn-dark btn-sm" onClick={() => dl(k)}>⬇ {l}</button>)}</div></div>
      <p className="font-extrabold">Audit log (latest 300)</p>
      <Table loading={audit.loading} rows={audit.data} cols={[["#", (r: any) => r.id], ["Admin", (r: any) => r.actor ?? "system"], ["Action", (r: any) => <b>{r.action.replace(/_/g, " ")}</b>], ["Entity", (r: any) => `${r.entity}${r.entity_id ? " #" + r.entity_id : ""}`], ["Detail", (r: any) => <span className="text-xs">{r.detail}</span>], ["At", (r: any) => fmtDate(r.at)]]} />
    </div>
  );
}
