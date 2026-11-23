import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Lights, TruckModel, canUse3D } from "../components/Truck3D";
import { RoadWorld } from "../components/World3D";
import { TruckSvg } from "../components/SvgArt";

/** true once the opening animation is finished (the landing page uses it to start its own 3D hero). */
export const IntroDoneCtx = createContext(true);
export const useIntroDone = () => useContext(IntroDoneCtx);

// Timeline (seconds)
const T_ARRIVE = 2.9;     // scene 1 ends: truck has emerged from the distance
const T_ORBIT = 5.2;      // scene 2 ends: three-quarter front -> side tracking shot
const T_LOGO = 4.4;       // logo + tagline reveal
const T_SLOW = 6.5;       // truck eases down while the logo holds
const T_EXIT = 8.4;       // scene 3: truck accelerates off screen pulling the reveal
/** Dev/QA helper: ?hgt=3.5 freezes the intro timeline at that second (used for screenshots). */
const DEBUG_T = (() => { try { const v = parseFloat(new URLSearchParams(window.location.search).get("hgt") || ""); return Number.isFinite(v) ? v : null; } catch { return null; } })();
const easeOut = (x: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(x, 0, 1), 3);
const easeIn = (x: number) => Math.pow(THREE.MathUtils.clamp(x, 0, 1), 2.6);
const easeIO = (x: number) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

/**
 * Cinematic opening. A real 3D truck emerges from the dark, is followed by the camera (three-quarter front -> side tracking),
 * the HAULGO logo is revealed, then the truck accelerates off and its rear edge pulls a skewed reveal of the landing page.
 */
export default function IntroShell({ children }: { children: ReactNode }) {
  const [done, setDone] = useState(() => DEBUG_T === null && sessionStorage.getItem("hg_intro") === "1");
  const [mode] = useState<"3d" | "css" | "reduced">(() => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : canUse3D() ? "3d" : "css"));
  const landRef = useRef<HTMLDivElement>(null);
  const finish = () => { sessionStorage.setItem("hg_intro", "1"); setDone(true); };
  useEffect(() => {
    if (done || DEBUG_T !== null) return;
    const ms = mode === "reduced" ? 900 : mode === "css" ? 3800 : (T_EXIT + 0.25) * 1000;
    const id = setTimeout(finish, ms);
    return () => clearTimeout(id);
  }, [done, mode]);
  return (
    <IntroDoneCtx.Provider value={done}>
      <div className="relative min-h-full">
        <div ref={landRef} style={!done && mode === "3d" ? { transform: "scale(.94)", opacity: 0.4, transformOrigin: "50% 40%", willChange: "transform, opacity" } : undefined}>{children}</div>
        {!done && (
          <div className="fixed inset-0 z-[3000]" aria-label="HaulGo intro">
            {mode === "3d" ? <Intro3D landRef={landRef} /> : mode === "css" ? <IntroCss /> : <Logo3Static />}
            <button onClick={finish} className="absolute top-4 right-4 z-20 text-xs font-semibold text-white/70 hover:text-white border border-white/20 rounded-full px-3.5 py-2 backdrop-blur">Skip intro</button>
          </div>
        )}
      </div>
    </IntroDoneCtx.Provider>
  );
}

function Wordmark({ show }: { show: boolean }) {
  return (
    <div className={`absolute left-0 right-0 top-[5%] text-center px-4 pointer-events-none transition-opacity duration-500 ${show ? "opacity-100" : "opacity-0"}`}>
      <div className="flex justify-center gap-[.04em] text-white font-extrabold text-[13vw] sm:text-[6.4vw] leading-none drop-shadow-[0_6px_30px_rgba(0,0,0,.6)]" aria-label="HAULGO">
        {"HAULGO".split("").map((c, i) => (
          <span key={i} className={`inline-block ${i > 3 ? "text-brand" : ""}`} style={show ? { animation: `rise .7s ${i * 0.07}s cubic-bezier(.2,.8,.2,1) both` } : { opacity: 0 }}>{c}</span>
        ))}
      </div>
      <p className="mt-2 text-white/80 tracking-[.32em] text-[2.6vw] sm:text-[.9vw] uppercase font-semibold" style={show ? { animation: "rise .8s .6s both" } : { opacity: 0 }}>Moving Industries Forward.</p>
      <p className="mt-1.5 text-white/45 text-[2.2vw] sm:text-[.75vw] tracking-[.2em] uppercase" style={show ? { animation: "rise .8s .9s both" } : { opacity: 0 }}>HighCodeX Technologies</p>
    </div>
  );
}

function Intro3D({ landRef }: { landRef: React.RefObject<HTMLDivElement> }) {
  const clipRef = useRef<HTMLDivElement>(null);
  const [logo, setLogo] = useState(false);
  return (
    <div ref={clipRef} className="absolute inset-0 bg-obsidian">
      <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 34, position: [8, 1.6, 9], near: 0.1, far: 200 }} gl={{ antialias: true, powerPreference: "high-performance" }}>
        <Director clipRef={clipRef} landRef={landRef} onLogo={() => setLogo(true)} />
      </Canvas>
      <Wordmark show={logo} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at 50% 55%, transparent 55%, rgba(0,0,0,.55) 100%)" }} />
      <div className="absolute inset-x-0 top-0 h-[30%] pointer-events-none" style={{ background: "linear-gradient(rgba(0,0,0,.35), transparent)" }} />
    </div>
  );
}

function Director({ clipRef, landRef, onLogo }: { clipRef: React.RefObject<HTMLDivElement>; landRef: React.RefObject<HTMLDivElement>; onLogo: () => void }) {
  const truck = useRef<THREE.Group>(null);
  const speed = useRef(13), off = useRef(0), vTruck = useRef(13);
  const logoShown = useRef(false);
  const last = useRef({ x: -40, t: 0 });
  const t0 = useRef<number | null>(null);
  const v = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  const { camera, size } = useThree();
  useFrame((s) => {
    if (t0.current === null) t0.current = s.clock.elapsedTime;
    const t = DEBUG_T !== null ? DEBUG_T : s.clock.elapsedTime - t0.current;
    const aspect = size.width / size.height;
    // distance so a ~10 m truck fills the frame on both portrait and landscape
    const dBase = THREE.MathUtils.clamp(23.5 / Math.min(aspect, 2.2), 12.5, 38);

    // ---- truck position (screen-ish x, world scrolls under it) and road speed
    let tx: number, ws: number;
    if (t < T_ARRIVE) { tx = -40 + 40 * easeOut(t / T_ARRIVE); ws = 11 + 4 * easeOut(t / T_ARRIVE); }
    else if (t < T_SLOW) { tx = 0; ws = t < T_ORBIT ? 15 : 15 - 11 * easeIO((t - T_ORBIT) / (T_SLOW - T_ORBIT)); }
    else { const k = (t - T_SLOW) / (T_EXIT - T_SLOW); tx = 46 * easeIn(k); ws = 4 + 22 * easeIO(k); }
    const dt = Math.max(t - last.current.t, 0.001);
    const vx = (tx - last.current.x) / dt;
    last.current = { x: tx, t };
    vTruck.current = THREE.MathUtils.lerp(vTruck.current, ws + (Number.isFinite(vx) ? vx : 0), 0.3);
    speed.current = ws;
    if (truck.current) truck.current.position.x = tx;

    // ---- camera: scene 1 three-quarter front low, scene 2 sweep to side tracking, scene 3 locked side shot
    const kOrbit = easeIO((t - 1.6) / (T_ORBIT - 1.6));
    const az = THREE.MathUtils.degToRad(34 + 56 * kOrbit);
    const d = dBase * (1 + 0.12 * (1 - kOrbit)) + Math.min(t, 8) * 0.05;
    const h = 1.15 + 0.7 * kOrbit + Math.sin(t * 0.7) * 0.05;
    const shake = t < T_SLOW ? 0.012 : 0.004;
    camera.position.set(Math.cos(az) * d + Math.sin(t * 9) * shake, h + Math.sin(t * 13) * shake, Math.sin(az) * d);
    look.set(THREE.MathUtils.lerp(0.3, 0, kOrbit), 1.3 + 1.1 * kOrbit, 0);
    camera.lookAt(look);

    if (t > T_LOGO && !logoShown.current) { logoShown.current = true; onLogo(); }
    if (t >= T_SLOW && clipRef.current) {
      v.set(tx - 4.9, 1.2, 0).project(camera);
      const px = (v.x * 0.5 + 0.5) * 100;
      clipRef.current.style.clipPath = `polygon(${px + 9}% 0, 101% 0, 101% 100%, ${px - 9}% 100%)`;
      const p = Math.min((t - T_SLOW) / (T_EXIT - T_SLOW), 1);
      if (landRef.current) { landRef.current.style.transform = `scale(${0.94 + 0.06 * easeOut(p)})`; landRef.current.style.opacity = String(0.4 + 0.6 * easeOut(p)); }
    }
  });
  return (
    <>
      <RoadWorld speedRef={speed} offRef={off} />
      <Lights dim follow={truck} />
      <group ref={truck} position={[-40, 0, 0]}><TruckModel kind="hero_truck" speedRef={vTruck} lights scale={1} /></group>
    </>
  );
}

function IntroCss() {
  return (
    <div className="absolute inset-0 bg-obsidian overflow-hidden">
      <style>{`@keyframes slideTruck{0%{transform:translateX(-120%)}55%{transform:translateX(0)}70%{transform:translateX(0)}100%{transform:translateX(130%)}}@keyframes fadeOut{0%,80%{opacity:1}100%{opacity:0;visibility:hidden}}`}</style>
      <div className="absolute inset-0" style={{ animation: "fadeOut 3.8s both" }}>
        <Wordmark show />
        <div className="absolute left-0 right-0 bottom-[22%] flex justify-center" style={{ animation: "slideTruck 3.4s ease-in-out both" }}><TruckSvg kind="medium_truck" dark moving className="w-[70vw] max-w-xl" /></div>
        <div className="absolute left-0 right-0 bottom-0 h-[24%] bg-[#15131B]"><div className="absolute left-0 right-0 top-1/2 h-[3px] opacity-50" style={{ backgroundImage: "repeating-linear-gradient(90deg,#FAF7F2 0 46px,transparent 46px 92px)", animation: "dashx .5s linear infinite" }} /></div>
        <style>{`@keyframes dashx{to{background-position:-92px 0}}`}</style>
      </div>
    </div>
  );
}

function Logo3Static() {
  return <div className="absolute inset-0 bg-obsidian"><Wordmark show /></div>;
}
