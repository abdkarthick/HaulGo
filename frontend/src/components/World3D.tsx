import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { MutableRefObject, RefObject, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Lights, TruckModel, canUse3D, isMobileGpu } from "./Truck3D";

/* ------------------------------------------------------------------ procedural textures */
function asphaltTexture() {
  const S = 512, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3F3A4A"; g.fillRect(0, 0, S, S);
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 34 + (Math.random() > 0.985 ? 38 : 0);
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 1.03;
  }
  g.putImageData(img, 0, 0);
  // worn patches and tyre polish
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(${Math.random() > 0.5 ? "0,0,0" : "255,255,255"},${0.02 + Math.random() * 0.03})`;
    g.beginPath(); g.ellipse(Math.random() * S, Math.random() * S, 40 + Math.random() * 90, 10 + Math.random() * 30, Math.random() * 3, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = "rgba(0,0,0,.18)";
  g.fillRect(0, S * 0.3, S, S * 0.05); g.fillRect(0, S * 0.65, S, S * 0.05); // wheel tracks
  // lane markings (tile = 12 m wide, 12 m long): edge lines + dashed centre
  g.fillStyle = "rgba(230,230,224,.78)";
  g.fillRect(0, S * 0.045, S, S * 0.012); g.fillRect(0, S * 0.943, S, S * 0.012);
  g.fillStyle = "rgba(240,200,60,.85)";
  g.fillRect(S * 0.02, S * 0.494, S * 0.46, S * 0.014);
  g.fillStyle = "rgba(0,0,0,.35)";
  for (let i = 0; i < 400; i++) g.fillRect(Math.random() * S, S * 0.04 + Math.random() * 3, 2 + Math.random() * 10, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,214,150,1)"); gr.addColorStop(0.25, "rgba(255,170,80,.45)"); gr.addColorStop(1, "rgba(255,140,40,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
function skyTexture() {
  const c = document.createElement("canvas"); c.width = 16; c.height = 256;
  const g = c.getContext("2d")!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, "#15131B"); gr.addColorStop(0.55, "#1E1B26"); gr.addColorStop(0.82, "#3A3040"); gr.addColorStop(1, "#7A5A3A");
  g.fillStyle = gr; g.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const SPAN = 150;
const wrap = (x: number) => ((((x + SPAN / 2) % SPAN) + SPAN) % SPAN) - SPAN / 2;

type Prop = { x: number; node: JSX.Element };

/** Industrial road scene that scrolls past a fixed truck. `offRef` accumulates distance travelled. */
export function RoadWorld({ speedRef, offRef }: { speedRef: MutableRefObject<number>; offRef: MutableRefObject<number> }) {
  const road = useMemo(asphaltTexture, []);
  const glow = useMemo(glowTexture, []);
  const sky = useMemo(skyTexture, []);
  const props = useRef<THREE.Group[]>([]);
  const streaks = useRef<THREE.InstancedMesh>(null);
  const small = isMobileGpu();
  const items = useMemo<Prop[]>(() => {
    const out: Prop[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // warehouses (far side) in a repeating row
    for (let i = 0; i < 6; i++) {
      const w = 15 + rnd() * 9, h = 5.5 + rnd() * 3, x = -SPAN / 2 + i * (SPAN / 6) + rnd() * 6;
      out.push({ x, node: (
        <group>
          <mesh position={[0, h / 2, -21]} castShadow receiveShadow><boxGeometry args={[w, h, 12]} /><meshStandardMaterial color="#5A5465" roughness={0.7} metalness={0.5} envMapIntensity={0.5} /></mesh>
          <mesh position={[0, h + 0.15, -14.9]}><boxGeometry args={[w + 0.3, 0.3, 0.4]} /><meshStandardMaterial color="#A8651A" roughness={0.5} emissive="#A8651A" emissiveIntensity={0.25} /></mesh>
          {Array.from({ length: Math.floor(w / 6) }).map((_, d) => (
            <group key={d} position={[-w / 2 + 3 + d * 6, 0, -14.93]}>
              <mesh position={[0, 2, 0]}><boxGeometry args={[3.6, 4, 0.12]} /><meshStandardMaterial color="#4A4455" roughness={0.6} metalness={0.6} /></mesh>
              {[0.4, 0.9, 1.4, 1.9, 2.4, 2.9, 3.4].map((y) => <mesh key={y} position={[0, y, 0.07]}><boxGeometry args={[3.5, 0.03, 0.03]} /><meshBasicMaterial color="#15131B" /></mesh>)}
              <mesh position={[0, 4.55, 0.1]}><boxGeometry args={[3.2, 0.14, 0.08]} /><meshBasicMaterial color="#ffd9a0" toneMapped={false} /></mesh>
              <sprite position={[0, 4.4, 1]} scale={[9, 5, 1]}><spriteMaterial map={glow} blending={THREE.AdditiveBlending} depthWrite={false} transparent opacity={0.55} fog={false} /></sprite>
            </group>
          ))}
        </group>) });
    }
    // container stacks near the warehouses
    for (let i = 0; i < 9; i++) {
      const x = -SPAN / 2 + i * (SPAN / 9) + 8 + rnd() * 4;
      const cols = ["#8A5014", "#6E6A78", "#b8b9b5", "#2A2633", "#a37a2c"];
      out.push({ x, node: (
        <group position={[0, 0, -11.2]}>
          {Array.from({ length: 1 + Math.floor(rnd() * 3) }).map((_, k) => (
            <mesh key={k} position={[0, 1.3 + k * 2.6, 0]} castShadow receiveShadow><boxGeometry args={[6.1, 2.55, 2.4]} /><meshStandardMaterial color={cols[Math.floor(rnd() * cols.length)]} roughness={0.55} metalness={0.45} envMapIntensity={0.6} /></mesh>
          ))}
        </group>) });
    }
    // light poles every 25 m on the near-side verge
    for (let i = 0; i < 6; i++) {
      const x = -SPAN / 2 + i * (SPAN / 6) + 4;
      out.push({ x, node: (
        <group position={[0, 0, -8]}>
          <mesh position={[0, 4.5, 0]} castShadow><cylinderGeometry args={[0.1, 0.14, 9, 10]} /><meshStandardMaterial color="#6A6475" metalness={0.8} roughness={0.4} /></mesh>
          <mesh position={[0, 8.9, 1.4]}><boxGeometry args={[0.2, 0.12, 3]} /><meshStandardMaterial color="#6A6475" metalness={0.8} roughness={0.4} /></mesh>
          <mesh position={[0, 8.78, 2.7]}><boxGeometry args={[0.8, 0.12, 0.35]} /><meshBasicMaterial color="#fff0cf" toneMapped={false} /></mesh>
          <sprite position={[0, 8.6, 2.7]} scale={[7, 7, 1]}><spriteMaterial map={glow} blending={THREE.AdditiveBlending} depthWrite={false} transparent opacity={0.8} fog={false} /></sprite>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 8.2]}><circleGeometry args={[7.5, 32]} /><meshBasicMaterial map={glow} blending={THREE.AdditiveBlending} depthWrite={false} transparent opacity={0.28} fog={false} /></mesh>
        </group>) });
    }
    // fence posts + wire along the yard edge
    for (let i = 0; i < 30; i++) {
      const x = -SPAN / 2 + i * (SPAN / 30);
      out.push({ x, node: <mesh position={[0, 0.9, -6.6]} castShadow><boxGeometry args={[0.08, 1.8, 0.08]} /><meshStandardMaterial color="#4F4A5A" metalness={0.7} roughness={0.5} /></mesh> });
    }
    // reflective roadside markers
    for (let i = 0; i < 15; i++) {
      const x = -SPAN / 2 + i * (SPAN / 15) + 3;
      out.push({ x, node: <mesh position={[0, 0.45, -6.4]}><boxGeometry args={[0.08, 0.9, 0.08]} /><meshStandardMaterial color="#FAF7F2" emissive="#A8651A" emissiveIntensity={0.35} /></mesh> });
    }
    return out;
  }, [glow]);

  const streakData = useMemo(() => Array.from({ length: small ? 18 : 34 }).map((_, i) => ({ x: (i / (small ? 18 : 34)) * SPAN - SPAN / 2, y: 0.25 + Math.random() * 4.5, z: (Math.random() > 0.5 ? 1 : -1) * (7.2 + Math.random() * 3.5) + (Math.random() > 0.8 ? -6 : 0), l: 1.4 + Math.random() * 2.4 })), [small]);

  useFrame((_, dt) => {
    const sp = speedRef.current;
    offRef.current += sp * dt;
    road.offset.x = (offRef.current / 12) % 1;
    const o = offRef.current;
    props.current.forEach((g, i) => { if (g) g.position.x = wrap(items[i].x - o); });
    if (streaks.current) {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      const k = Math.min(Math.max(sp - 3, 0) / 14, 1);
      streakData.forEach((d, i) => {
        s.set(d.l * (0.3 + k * 1.4), 1, 1);
        m.compose(new THREE.Vector3(wrap(d.x - o * 1.35), d.y, d.z), q, s);
        streaks.current!.setMatrixAt(i, m);
      });
      streaks.current.instanceMatrix.needsUpdate = true;
      (streaks.current.material as THREE.MeshBasicMaterial).opacity = 0.05 + k * 0.26;
    }
  });
  const tex = road;
  useEffect(() => { tex.repeat.set(SPAN * 2 / 12, 1); }, [tex]);
  return (
    <>
      <color attach="background" args={["#1F1C26"]} />
      <fog attach="fog" args={["#17141D", 24, 92]} />
      {/* horizon glow */}
      <mesh position={[0, 24, -85]} scale={[400, 62, 1]}><planeGeometry /><meshBasicMaterial map={sky} fog={false} toneMapped={false} /></mesh>
      {/* road */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[SPAN * 2, 12]} />
        <meshStandardMaterial map={tex} bumpMap={tex} bumpScale={0.9} roughness={0.72} metalness={0.12} envMapIntensity={0.7} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, -30]} receiveShadow><planeGeometry args={[SPAN * 2, 80]} /><meshStandardMaterial color="#25212D" roughness={0.9} metalness={0.1} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 30]} receiveShadow><planeGeometry args={[SPAN * 2, 40]} /><meshStandardMaterial color="#25212D" roughness={0.9} metalness={0.1} /></mesh>
      {[6.15, -6.15].map((z) => <mesh key={z} position={[0, 0.06, z]} receiveShadow><boxGeometry args={[SPAN * 2, 0.14, 0.3]} /><meshStandardMaterial color="#8a8c92" roughness={0.8} /></mesh>)}
      {items.map((p, i) => <group key={i} ref={(g) => { if (g) props.current[i] = g; }} position={[p.x, 0, 0]}>{p.node}</group>)}
      {/* speed streaks */}
      <instancedMesh ref={streaks} args={[undefined, undefined, streakData.length]} frustumCulled={false}>
        <boxGeometry args={[1, 0.012, 0.012]} />
        <meshBasicMaterial color="#e8ecff" transparent opacity={0.1} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
      </instancedMesh>
    </>
  );
}

/* ------------------------------------------------------------------ hero stage on the landing page */
function HeroDirector() {
  const speed = useRef(10), off = useRef(0);
  const truck = useRef<THREE.Group>(null);
  const { camera, size } = useThree();
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    // natural cruise: gentle accelerate / ease off
    speed.current = 11 + Math.sin(t * 0.33) * 3.2 + Math.sin(t * 0.9) * 0.6;
    const aspect = size.width / size.height;
    const d = THREE.MathUtils.clamp(Math.max(10.8, 20 / aspect), 10.8, 34);
    const a = THREE.MathUtils.degToRad(66 + Math.sin(t * 0.17) * 26); // swings between three-quarter front and side tracking
    const h = 1.75 + Math.sin(t * 0.21) * 0.35;
    camera.position.set(Math.cos(a) * d, h, Math.sin(a) * d);
    camera.lookAt(0.3, 1.7, 0);
    if (truck.current) truck.current.position.x = Math.sin(t * 0.33) * -0.25;
  });
  return (
    <>
      <RoadWorld speedRef={speed} offRef={off} />
      <Lights dim follow={truck} />
      <group ref={truck}><TruckModel kind="hero_truck" speedRef={speed} lights scale={1} /></group>
    </>
  );
}

export function HeroStage({ className = "", paused = false }: { className?: string; paused?: boolean }) {
  const [ok] = useState(canUse3D);
  const ref = useRef<HTMLDivElement>(null);
  const [vis, setVis] = useState(true);
  useEffect(() => {
    if (!ref.current || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setVis(e.isIntersecting), { threshold: 0.01 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`relative overflow-hidden ${className}`} aria-hidden>
      {/* lightweight static fallback / loading placeholder (also what low-power devices see) */}
      <div className="absolute inset-0" style={{ background: "linear-gradient(#1F1C26 0%, #2A2633 52%, #5A4636 78%, #1C1924 79%, #1A1722 100%)" }}>
        <img src="/hero-truck.webp" alt="" className="absolute inset-0 w-full h-full object-cover object-bottom" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
      </div>
      {ok && !paused && (
        <Canvas shadows dpr={[1, 1.5]} frameloop={vis ? "always" : "never"} camera={{ fov: 32, near: 0.1, far: 200, position: [6, 2, 10] }} gl={{ antialias: true, powerPreference: "high-performance" }} className="!absolute inset-0 animate-fadein">
          <HeroDirector />
        </Canvas>
      )}
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-obsidian to-transparent pointer-events-none" />
    </div>
  );
}

export type { RefObject };
