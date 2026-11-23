import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, Role } from "../lib/api";
import { LangCode, useI18n } from "../lib/i18n";
import { IcChatBubble, IcClose, IcMic, IcSend, IcSpeaker, IcStop } from "./Icons";

type Msg = { role: "user" | "assistant"; text: string };
type Phase = "idle" | "listening" | "thinking" | "speaking";

const SPEECH_LANG: Record<LangCode, string> = { en: "en-IN", ta: "ta-IN", hi: "hi-IN", te: "te-IN", kn: "kn-IN", ml: "ml-IN", bn: "bn-IN", mr: "mr-IN" };

const getRecognition = (): any => (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;
const OPTIONS: Record<string, string[]> = {
  customer: ["booking", "track", "pay", "fare", "otp", "support"],
  driver: ["register", "earn", "otp", "pay", "support"],
};
const plain = (s: string) => s.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();

/** Chat + voice assistant. Speech-to-text and text-to-speech run in the browser; answers come from POST /api/ai/chat. */
export default function Assistant({ role }: { role: Role }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"chat" | "voice">("chat");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [readAloud, setReadAloud] = useState(false);
  const [basic, setBasic] = useState(false);
  const [note, setNote] = useState("");
  const [heard, setHeard] = useState("");
  const rec = useRef<any>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const msgsRef = useRef<Msg[]>([]);
  msgsRef.current = msgs;
  const supported = useMemo(() => !!getRecognition(), []);

  useEffect(() => { alive.current = true; return () => { alive.current = false; try { rec.current?.abort(); } catch { /* ignore */ } if (canSpeak()) window.speechSynthesis.cancel(); }; }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, phase]);

  const stopAll = useCallback(() => {
    try { rec.current?.abort(); } catch { /* ignore */ }
    if (canSpeak()) window.speechSynthesis.cancel();
    setPhase("idle");
  }, []);

  const close = () => { stopAll(); setOpen(false); };

  const speak = useCallback((text: string) => {
    if (!canSpeak()) { setPhase("idle"); return; }
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(plain(text));
    u.lang = SPEECH_LANG[lang];
    const v = synth.getVoices().find((x) => x.lang.toLowerCase().replace("_", "-").startsWith(lang));
    if (v) u.voice = v;
    u.onend = () => alive.current && setPhase("idle");
    u.onerror = () => alive.current && setPhase("idle");
    setPhase("speaking");
    synth.speak(u);
  }, [lang]);

  const send = useCallback(async (text: string, viaVoice: boolean, topic?: string) => {
    const q = text.trim();
    if (!q) { setPhase("idle"); return; }
    setNote("");
    const history = msgsRef.current.slice(-10);
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setPhase("thinking");
    try {
      const r = await Promise.race([
        api<{ reply: string; mode: string }>(role, "/ai/chat", { body: { message: q, history, lang, voice: viaVoice, topic } }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error(t("ai.error"))), 45000)),
      ]);
      if (!alive.current) return;
      setBasic(r.mode === "basic");
      setMsgs((m) => [...m, { role: "assistant", text: r.reply }]);
      if (viaVoice || readAloud) speak(r.reply); else setPhase("idle");
    } catch (e: any) {
      if (!alive.current) return;
      setNote(e?.message || t("ai.error"));
      setPhase("idle");
    }
  }, [role, lang, readAloud, speak, t]);

  const listen = useCallback((viaVoice: boolean) => {
    const SR = getRecognition();
    if (!SR) { setNote(t("ai.noMic")); return; }
    if (canSpeak()) window.speechSynthesis.cancel();
    setNote(""); setHeard("");
    const r = new SR();
    rec.current = r;
    r.lang = SPEECH_LANG[lang];
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    let finalText = "";
    r.onresult = (e: any) => {
      let s = "";
      for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
      finalText = s;
      setHeard(s);
      if (!viaVoice) setInput(s);
    };
    r.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setNote(t("ai.micDenied"));
      else if (e.error === "no-speech") setNote(t("ai.noSpeech"));
      else if (e.error !== "aborted") setNote(t("ai.error"));
      if (alive.current) setPhase("idle");
    };
    r.onend = () => {
      if (!alive.current) return;
      if (finalText.trim()) { setInput(""); send(finalText, viaVoice); }
      else setPhase((p) => (p === "listening" ? "idle" : p));
    };
    try { r.start(); setPhase("listening"); } catch { setPhase("idle"); }
  }, [lang, send, t]);

  const micTap = (viaVoice: boolean) => {
    if (phase === "listening") { try { rec.current?.stop(); } catch { /* ignore */ } return; }
    if (phase === "speaking") { stopAll(); return; }
    if (phase === "thinking") return;
    listen(viaVoice);
  };

  const submit = (e: React.FormEvent) => { e.preventDefault(); if (phase === "thinking") return; const q = input; setInput(""); send(q, false); };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} aria-label={t("ai.open")}
        className="fixed z-[1200] right-4 bottom-24 h-14 pl-4 pr-5 rounded-full bg-brand text-white shadow-xl shadow-brand/30 flex items-center gap-2 font-extrabold text-sm hover:bg-brand-dark transition animate-rise">
        <IcChatBubble size={22} />{t("ai.open")}
      </button>
    );
  }

  const opts = OPTIONS[role === "driver" ? "driver" : "customer"];
  const chips = (
    <div className="pt-1">
      <p className="text-[11px] font-bold uppercase tracking-wide text-steel mb-1.5">{t("ai.menu")}</p>
      <div className="flex flex-wrap gap-2">
        {opts.map((k) => (
          <button key={k} type="button" disabled={phase === "thinking"} onClick={() => send(t(`ai.o.${k}` as any), false, k)}
            className="rounded-full border border-brand/30 bg-brand/5 text-brand text-[13px] font-bold px-3.5 py-2 hover:bg-brand hover:text-white transition disabled:opacity-50">{t(`ai.o.${k}` as any)}</button>
        ))}
      </div>
    </div>
  );
  const status = phase === "listening" ? t("ai.listening") : phase === "thinking" ? t("ai.thinking") : phase === "speaking" ? "…" : t("ai.tapSpeak");
  const last = msgs[msgs.length - 1];
  return (
    <div className="fixed inset-0 z-[3100] flex items-end sm:items-center justify-center bg-obsidian/60 backdrop-blur-sm p-0 sm:p-4 animate-fadein" role="dialog" aria-modal="true" aria-label={t("ai.title")}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="w-full max-w-md h-[82vh] sm:h-[640px] bg-white text-obsidian rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-rise">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-brand text-white flex items-center justify-center"><IcChatBubble size={19} /></span>
            <div><p className="font-extrabold leading-tight">{t("ai.title")}</p>{basic && <p className="text-[10px] text-steel leading-tight">{t("ai.basic")}</p>}</div>
          </div>
          <button onClick={close} aria-label={t("ai.close")} className="w-9 h-9 rounded-full bg-offwhite flex items-center justify-center"><IcClose size={18} /></button>
        </div>
        <div className="grid grid-cols-2 gap-1.5 p-1.5 mx-3 mt-3 bg-offwhite rounded-xl" role="tablist">
          {(["chat", "voice"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => { stopAll(); setTab(k); setNote(""); }}
              className={`rounded-lg py-2 text-sm font-bold flex items-center justify-center gap-1.5 transition ${tab === k ? "bg-obsidian text-white" : "text-obsidian/70"}`}>
              {k === "chat" ? <IcChatBubble size={16} /> : <IcMic size={16} />}{k === "chat" ? t("ai.chatTab") : t("ai.voiceTab")}
            </button>
          ))}
        </div>

        {tab === "chat" ? (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
              <Bubble role="assistant" text={t("ai.hello")} />
              {msgs.map((m, i) => <Bubble key={i} role={m.role} text={m.text} />)}
              {phase === "thinking" && <p className="text-xs text-steel animate-pulseDot">{t("ai.thinking")}</p>}
              {phase !== "thinking" && (!last || last.role === "assistant") && chips}
              {note && <p className="text-xs text-danger font-semibold">{note}</p>}
              <div ref={endRef} />
            </div>
            <div className="px-3 pb-3 pt-2 border-t border-line">
              {canSpeak() && (
                <label className="flex items-center gap-2 text-xs text-steel font-semibold mb-2 cursor-pointer">
                  <input type="checkbox" checked={readAloud} onChange={(e) => { setReadAloud(e.target.checked); if (!e.target.checked && canSpeak()) { window.speechSynthesis.cancel(); setPhase("idle"); } }} />
                  <IcSpeaker size={15} />{t("ai.readAloud")}
                </label>
              )}
              <form onSubmit={submit} className="flex items-center gap-2">
                <input className="input flex-1" value={input} onChange={(e) => setInput(e.target.value)} placeholder={phase === "listening" ? t("ai.listening") : t("ai.placeholder")} maxLength={1000} />
                {supported && (
                  <button type="button" onClick={() => micTap(false)} aria-label={t("ai.mic")}
                    className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition ${phase === "listening" ? "bg-brand text-white animate-brandRing" : "bg-offwhite text-obsidian"}`}><IcMic size={20} /></button>
                )}
                <button className="w-11 h-11 rounded-full bg-obsidian text-white flex items-center justify-center shrink-0 disabled:opacity-40" disabled={!input.trim() || phase === "thinking"} aria-label={t("ai.send")}><IcSend size={19} /></button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-between px-5 py-5 overflow-y-auto">
            <p className="text-sm text-steel text-center">{t("ai.voiceHint")}</p>
            <div className="w-full space-y-3 my-4 text-center min-h-[120px]">
              {phase === "listening" && heard && <p className="text-lg font-bold text-obsidian/70">{heard}</p>}
              {phase !== "listening" && last && (
                <>
                  {msgs.length > 1 && <p className="text-sm text-steel">{msgs[msgs.length - 2].role === "user" ? msgs[msgs.length - 2].text : ""}</p>}
                  {last.role === "assistant" && <p className="text-lg font-bold leading-snug">{last.text}</p>}
                </>
              )}
              {!last && phase === "idle" && <p className="text-lg font-bold">{t("ai.hello")}</p>}
              {note && <p className="text-xs text-danger font-semibold">{note}</p>}
            </div>
            {supported ? (
              <div className="flex flex-col items-center gap-3">
                <button onClick={() => micTap(true)} aria-label={phase === "listening" || phase === "speaking" ? t("ai.stop") : t("ai.mic")} disabled={phase === "thinking"}
                  className={`w-24 h-24 rounded-full flex items-center justify-center text-white shadow-xl transition disabled:opacity-60 ${phase === "listening" ? "bg-brand animate-brandRing" : phase === "speaking" ? "bg-obsidian" : "bg-brand hover:bg-brand-dark"}`}>
                  {phase === "speaking" ? <IcStop size={34} /> : <IcMic size={38} />}
                </button>
                <p className="text-sm font-bold">{phase === "speaking" ? t("ai.stop") : status}</p>
              </div>
            ) : <p className="text-sm text-danger font-semibold text-center">{t("ai.noMic")}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function Bubble({ role, text }: Msg) {
  const me = role === "user";
  return (
    <div className={`flex ${me ? "justify-end" : "justify-start"}`}>
      <p className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${me ? "bg-obsidian text-white rounded-br-md" : "bg-offwhite text-obsidian rounded-bl-md"}`}>{text}</p>
    </div>
  );
}