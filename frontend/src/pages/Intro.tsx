import { createContext, ReactNode, useCallback, useContext, useEffect, useState, lazy, Suspense } from "react";
import { TruckSvg } from "../components/SvgArt";

export const IntroDoneCtx = createContext(true);
export const useIntroDone = () => useContext(IntroDoneCtx);

// FIX: Intro3D ku prop eh vendaam, simple ah vechom - ithaan error ku kaaranam
const Intro3D = lazy(() => import("./Intro3D.tsx"));

const DEBUG_T = (() => { try { const v = parseFloat(new URLSearchParams(window.location.search).get("hgt") || ""); return Number.isFinite(v) ? v : null; } catch { return null; } })();

export default function IntroShell({ children }: { children: ReactNode }) {
  const wantIntro = (() => { try { return new URLSearchParams(window.location.search).get("intro") === "1"; } catch { return false; } })();

  // FIX: Bracket pottu clear ah eluthiten - ithu thaan error
  const [done, setDone] = useState<boolean>(() => {
    if (!wantIntro) return true; // ?intro=1 illana Intro illa
    if (DEBUG_T !== null) return false; // Debug la Intro kaatu
    return sessionStorage.getItem("hg_intro") === "1";
  });

  const [mode] = useState<"3d" | "css" | "reduced">(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "reduced";
    // FIX: ?intro=1 + desktop na mattum 3D, matha ellathukum CSS
    if (wantIntro && window.innerWidth >= 768) return "3d";
    return "css";
  });

  const finish = useCallback(() => { sessionStorage.setItem("hg_intro", "1"); setDone(true); }, []);

  useEffect(() => {
    if (done || DEBUG_T !== null) return;
    const ms = mode === "3d" ? 3600 : mode === "reduced" ? 600 : 1200;
    const id = setTimeout(finish, ms);
    return () => clearTimeout(id);
  }, [done, finish, mode]);

  return (
    <IntroDoneCtx.Provider value={done}>
      <div className="relative min-h-full">
        <div>{children}</div>
        {!done && (
          <div className="fixed inset-0 z-[3000]" aria-label="HaulGo intro">
            {mode === "3d" ? (
              <Suspense fallback={<IntroCss />}>
                <Intro3D />
              </Suspense>
            ) : mode === "css" ? <IntroCss /> : <Logo3Static />}
            <button onClick={finish} className="absolute top-4 right-4 z-20 text-xs font-semibold text-white/70 hover:text-white border border-white/20 rounded-full px-3.5 py-2 backdrop-blur">Skip intro</button>
          </div>
        )}
      </div>
    </IntroDoneCtx.Provider>
  );
}

function Wordmark({ show }: { show: boolean }) {
  return (
    <div className={`absolute left-0 right-0 top-[5%] text-center px-4 pointer-events-none transition-opacity duration-300 ${show ? "opacity-100" : "opacity-0"}`}>
      <div className="flex justify-center gap-[.04em] text-white font-extrabold text-[13vw] sm:text-[6.4vw] leading-none" aria-label="HAULGO">
        {"HAULGO".split("").map((c, i) => (
          <span key={i} className={`inline-block ${i > 3 ? "text-brand" : ""}`} style={show ? { animation: `rise .5s ${i * 0.05}s cubic-bezier(.2,.8,.2,1) both` } : { opacity: 0 }}>{c}</span>
        ))}
      </div>
      <p className="mt-2 text-white/80 tracking-[.32em] text-[2.6vw] sm:text-[.9vw] uppercase font-semibold" style={show ? { animation: "rise .5s .4s both" } : { opacity: 0 }}>Moving Industries Forward.</p>
      <p className="mt-1.5 text-white/45 text-[2.2vw] sm:text-[.75vw] tracking-[.2em] uppercase" style={show ? { animation: "rise .5s .6s both" } : { opacity: 0 }}>HighCodeX Technologies</p>
    </div>
  );
}

function IntroCss() {
  return (
    <div className="absolute inset-0 bg-obsidian overflow-hidden">
      <style>{`@keyframes slideTruck{0%{transform:translateX(-120%)}55%{transform:translateX(0)}70%{transform:translateX(0)}100%{transform:translateX(130%)}}@keyframes fadeOut{0%,80%{opacity:1}100%{opacity:0;visibility:hidden}}`}</style>
      <div className="absolute inset-0" style={{ animation: "fadeOut 1.2s both" }}>
        <Wordmark show />
        <div className="absolute left-0 right-0 bottom-[22%] flex justify-center" style={{ animation: "slideTruck 1.1s ease-in-out both" }}><TruckSvg kind="medium_truck" dark moving className="w-[70vw] max-w-xl" /></div>
        <div className="absolute left-0 right-0 bottom-0 h-[24%] bg-[#15131B]"><div className="absolute left-0 right-0 top-1/2 h-[3px] opacity-50" style={{ backgroundImage: "repeating-linear-gradient(90deg,#FAF7F2 0 46px,transparent 46px 92px)", animation: "dashx .5s linear infinite" }} /></div>
        <style>{`@keyframes dashx{to{background-position:-92px 0}}`}</style>
      </div>
    </div>
  );
}

function Logo3Static() {
  return <div className="absolute inset-0 bg-obsidian"><Wordmark show /></div>;
}