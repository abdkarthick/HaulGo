import { useEffect, useState } from "react";
import { LANGS, LangCode, useI18n } from "../lib/i18n";
import { IcCheck, IcGlobe } from "./Icons";

const GLYPH: Record<string, string> = { en: "A", ta: "அ", hi: "अ", te: "అ", kn: "ಅ", ml: "അ", bn: "অ", mr: "म" };
const HEADLINES = ["Choose your language", "உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்", "अपनी भाषा चुनें", "మీ భాషను ఎంచుకోండి", "ನಿಮ್ಮ ಭಾಷೆಯನ್ನು ಆರಿಸಿ", "നിങ്ങളുടെ ഭാഷ തിരഞ്ഞെടുക്കുക", "আপনার ভাষা বেছে নিন", "तुमची भाषा निवडा"];

/** First-launch full screen language chooser. */
function FirstLaunchPicker({ onClose }: { onClose?: () => void }) {
  const { lang, setLang, t } = useI18n();
  const [pick, setPick] = useState<LangCode>(lang);
  const [h, setH] = useState(0);
  useEffect(() => { const id = setInterval(() => setH((x) => (x + 1) % HEADLINES.length), 2200); return () => clearInterval(id); }, []);
  const choose = (c: LangCode) => { setPick(c); setLang(c); };
  const cur = LANGS.find((l) => l.code === pick)!;
  return (
    <div className="fixed inset-0 z-[3000] bg-obsidian text-white overflow-y-auto animate-fadein" role="dialog" aria-modal="true" aria-label={t("lang.choose")}>
      <div className="pointer-events-none absolute -top-40 -right-32 w-[34rem] h-[34rem] rounded-full opacity-30 blur-3xl" style={{ background: "radial-gradient(circle,#A8651A,transparent 70%)" }} />
      <div className="pointer-events-none absolute -bottom-48 -left-40 w-[30rem] h-[30rem] rounded-full opacity-20 blur-3xl" style={{ background: "radial-gradient(circle,#ffffff,transparent 70%)" }} />
      <div className="relative min-h-full max-w-xl mx-auto px-5 pt-10 pb-32 flex flex-col">
        <div className="flex items-center gap-2.5">
          <span className="w-10 h-10 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center"><IcGlobe /></span>
          <span className="text-xs font-bold tracking-[.25em] uppercase text-white/60">HaulGo</span>
        </div>
        <div className="mt-8 min-h-[5.5rem]">
          <h1 key={h} className="text-3xl sm:text-4xl font-extrabold leading-tight animate-rise">{HEADLINES[h]}</h1>
        </div>
        <p className="text-sm text-white/55 mt-2">{t("lang.sub")}</p>
        <div className="grid grid-cols-2 gap-3 mt-7">
          {LANGS.map((l) => {
            const on = pick === l.code;
            return (
              <button key={l.code} onClick={() => choose(l.code)} aria-pressed={on}
                className={`group relative overflow-hidden text-left rounded-3xl border p-4 transition-all duration-200 active:scale-[.97] ${on ? "border-brand bg-gradient-to-br from-brand/25 to-white/5 shadow-[0_10px_40px_-12px_rgba(168,101,26,.75)]" : "border-white/10 bg-white/[.04] hover:bg-white/[.08] hover:border-white/25"}`}>
                <span className={`absolute -right-2 -top-3 text-7xl font-extrabold leading-none select-none transition ${on ? "text-brand/30" : "text-white/[.06] group-hover:text-white/10"}`} aria-hidden="true">{GLYPH[l.code]}</span>
                <span className="relative block text-xl font-extrabold leading-tight">{l.native}</span>
                <span className="relative block text-xs text-white/55 mt-1">{l.english}</span>
                {on && <span className="absolute bottom-3 right-3 w-6 h-6 rounded-full bg-brand text-white flex items-center justify-center"><IcCheck size={14} /></span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="fixed left-0 right-0 bottom-0 z-10 bg-gradient-to-t from-obsidian via-obsidian/95 to-transparent pt-8 pb-5 px-5">
        <button className="btn-primary w-full max-w-xl mx-auto block !py-4 text-base shadow-glow" onClick={() => { setLang(pick); onClose?.(); }}>{t("lang.continue")} · {cur.native}</button>
      </div>
    </div>
  );
}

/** Language chooser. `blocking` = first-launch full screen picker; otherwise a closable sheet. */
export function LanguagePicker({ blocking = false, onClose }: { blocking?: boolean; onClose?: () => void }) {
  if (blocking) return <FirstLaunchPicker onClose={onClose} />;
  const { lang, setLang, t } = useI18n();
  const [pick, setPick] = useState<LangCode>(lang);
  const choose = (c: LangCode) => { setPick(c); setLang(c); };
  const done = () => { setLang(pick); onClose?.(); };
  return (
    <div className="fixed inset-0 z-[3000] flex items-end sm:items-center justify-center bg-obsidian/80 backdrop-blur-sm p-3 animate-fadein" role="dialog" aria-modal="true" aria-label={t("lang.choose")}
      onClick={(e) => { if (!blocking && e.target === e.currentTarget) onClose?.(); }}>
      <div className="w-full max-w-md bg-white text-obsidian rounded-3xl p-5 sm:p-6 shadow-2xl animate-rise">
        <div className="w-11 h-11 rounded-2xl bg-obsidian text-white flex items-center justify-center"><IcGlobe /></div>
        <h2 className="text-2xl font-extrabold mt-4">{t("lang.choose")}</h2>
        <p className="text-sm text-steel mt-1">{t("lang.sub")}</p>
        <div className="grid grid-cols-2 gap-2.5 mt-5">
          {LANGS.map((l) => {
            const on = pick === l.code;
            return (
              <button key={l.code} onClick={() => choose(l.code)} aria-pressed={on}
                className={`relative text-left rounded-2xl border px-4 py-3.5 transition ${on ? "border-brand bg-brand/5 shadow-glow" : "border-line hover:border-obsidian/40"}`}>
                <span className="block text-lg font-extrabold leading-tight">{l.native}</span>
                <span className="block text-xs text-steel mt-0.5">{l.english}</span>
                {on && <span className="absolute top-3 right-3 w-5 h-5 rounded-full bg-brand text-white flex items-center justify-center"><IcCheck size={13} /></span>}
              </button>
            );
          })}
        </div>
        <button className="btn-primary w-full !py-3.5 mt-5 text-base" onClick={done}>{t("lang.continue")}</button>
      </div>
    </div>
  );
}

/** Small pill that opens the picker (top bars). */
export function LanguageButton({ light = false }: { light?: boolean }) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const cur = LANGS.find((l) => l.code === lang)!;
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Language"
        className={`h-10 px-3 rounded-full inline-flex items-center gap-1.5 text-xs font-bold transition ${light ? "bg-white/10 text-white hover:bg-white/20" : "bg-white border border-line text-obsidian hover:bg-offwhite"}`}>
        <IcGlobe size={17} />{cur.code.toUpperCase()}
      </button>
      {open && <LanguagePicker onClose={() => setOpen(false)} />}
    </>
  );
}
