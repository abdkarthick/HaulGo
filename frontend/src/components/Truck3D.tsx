import { Canvas, createRoot, extend, useFrame, useThree } from "@react-three/fiber";
import { MutableRefObject, RefObject, Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { PackageLoadArt, TruckSvg } from "./SvgArt";

/* ------------------------------------------------------------------ capability checks */
export function canUse3D(): boolean {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    const nav: any = navigator;
    if (nav.connection?.saveData) return false;
    if ((nav.hardwareConcurrency || 4) <= 2 || (nav.deviceMemory || 4) <= 2) return false;
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}
export const isMobileGpu = () => (typeof window !== "undefined" ? window.matchMedia("(max-width: 820px)").matches : false);

/* ------------------------------------------------------------------ vehicle layouts */
export type Kind = "mini_truck" | "pickup" | "medium_truck" | "heavy_truck" | "trailer" | "hero_truck" | string;
type Cfg = { L: number; H: number; rear: number; dual: boolean; open?: boolean; cs: number; R: number };
const CFG: Record<string, Cfg> = {
  mini_truck: { L: 2.3, H: 1.2, rear: 1, dual: false, open: true, cs: 0.78, R: 0.4 },
  pickup: { L: 2.9, H: 1.1, rear: 1, dual: false, open: true, cs: 0.84, R: 0.42 },
  medium_truck: { L: 4.2, H: 2.2, rear: 1, dual: false, cs: 0.95, R: 0.5 },
  heavy_truck: { L: 5.4, H: 2.45, rear: 2, dual: true, cs: 1, R: 0.55 },
  trailer: { L: 7.6, H: 2.7, rear: 3, dual: true, cs: 1, R: 0.55 },
  hero_truck: { L: 6.8, H: 2.55, rear: 2, dual: true, cs: 1, R: 0.55 },
};
export function truckLayout(kind: Kind) {
  const c = CFG[kind] || CFG.medium_truck;
  const cl = 2.15 * c.cs, ch = 1.95 * c.cs, cw = c.cs < 0.9 ? 2.0 : 2.3;
  const gap = 0.18, total = cl + gap + c.L, front = total / 2;
  const yc = c.R * 1.85;
  const frontAxle = front - 0.78 * c.cs;
  const rearAxles = Array.from({ length: c.rear }).map((_, i) => -total / 2 + 1.15 + i * 1.32);
  return { ...c, cl, ch, cw, total, front, cabX: front - cl / 2, cargoX: -total / 2 + c.L / 2, yc, frontAxle, rearAxles, cargoW: c.open ? 2.0 : 2.42 };
}

/* ------------------------------------------------------------------ shared PBR kit (one set for every canvas) */
let _kit: ReturnType<typeof makeKit> | null = null;
function makeKit() {
  const P = (o: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(o);
  const S = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  const decal = makeDecalTexture();
  return {
    red: P({ color: "#B8732A", roughness: 0.26, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.06 }),
    redDeep: P({ color: "#6E3F10", roughness: 0.3, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.1 }),
    white: P({ color: "#EFEFEC", roughness: 0.4, metalness: 0.15, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
    whiteRib: P({ color: "#dcdcd8", roughness: 0.5, metalness: 0.25, clearcoat: 0.3 }),
    dark: S({ color: "#1A1722", roughness: 0.5, metalness: 0.65 }),
    plastic: S({ color: "#2A2633", roughness: 0.75, metalness: 0.1 }),
    steel: S({ color: "#8b9099", roughness: 0.34, metalness: 0.92 }),
    chrome: S({ color: "#eceef2", roughness: 0.07, metalness: 1 }),
    glass: P({ color: "#2A2633", roughness: 0.03, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.9, envMapIntensity: 2.4 }),
    rubber: S({ color: "#15131B", roughness: 0.93, metalness: 0 }),
    headOn: S({ color: "#ffffff", emissive: "#fff2cf", emissiveIntensity: 3.2, roughness: 0.2 }),
    headOff: S({ color: "#f2f2f2", emissive: "#fff2cf", emissiveIntensity: 0.5, roughness: 0.2 }),
    amber: S({ color: "#ffb02e", emissive: "#ff9a00", emissiveIntensity: 1.2 }),
    tail: S({ color: "#ff2a2a", emissive: "#ff1010", emissiveIntensity: 2.2 }),
    plate: S({ color: "#f5f2e6", roughness: 0.6 }),
    decal: new THREE.MeshBasicMaterial({ map: decal, transparent: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    kraft: S({ color: "#b98a56", roughness: 0.85 }),
    tape: S({ color: "#A8651A", roughness: 0.6 }),
    green: S({ color: "#2E9E5B", emissive: "#2E9E5B", emissiveIntensity: 0.6, roughness: 0.35 }),
  };
}
function kit() { return (_kit ||= makeKit()); }

function makeDecalTexture() {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 256;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const draw = () => {
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, 1024, 256);
    g.textBaseline = "alphabetic";
    g.font = "800 150px Manrope, Arial Black, Arial, sans-serif";
    const w1 = g.measureText("HAUL").width;
    g.fillStyle = "#3A3541"; g.fillText("HAUL", 30, 150);
    g.fillStyle = "#A8651A"; g.fillText("GO", 30 + w1 + 6, 150);
    g.font = "700 44px Manrope, Arial, sans-serif";
    g.fillStyle = "#6b6e75"; g.fillText("MOVING INDUSTRIES FORWARD.", 34, 214);
    t.needsUpdate = true;
  };
  draw();
  try { (document as any).fonts?.load("800 150px Manrope").then(draw).catch(() => {}); } catch { /* ignore */ }
  return t;
}

let _glow: THREE.CanvasTexture | null = null;
function glowTex() {
  if (_glow) return _glow;
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.2, "rgba(255,240,200,.55)"); gr.addColorStop(1, "rgba(255,230,170,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (_glow = new THREE.CanvasTexture(c));
}
let _blob: THREE.CanvasTexture | null = null;
function blobTexture() {
  if (_blob) return _blob;
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, "rgba(0,0,0,.75)"); gr.addColorStop(0.55, "rgba(0,0,0,.35)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return (_blob = new THREE.CanvasTexture(c));
}

const _rb = new Map<string, THREE.BufferGeometry>();
function rbGeo(w: number, h: number, d: number, r = 0.04) {
  const key = [w, h, d, r].map((n) => n.toFixed(3)).join();
  let g = _rb.get(key);
  if (!g) { g = new RoundedBoxGeometry(w, h, d, 3, Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001))); _rb.set(key, g); }
  return g;
}
type V3 = [number, number, number];
function RB({ s, p, m, r = 0.04, rot, cast = true }: { s: V3; p: V3; m: THREE.Material; r?: number; rot?: V3; cast?: boolean }) {
  return <mesh geometry={rbGeo(s[0], s[1], s[2], r)} material={m} position={p} rotation={rot} userData={cast ? undefined : { noShadow: true }} />;
}
function Cyl({ r, h, p, m, rot, seg = 20 }: { r: number; h: number; p: V3; m: THREE.Material; rot?: V3; seg?: number }) {
  return <mesh material={m} position={p} rotation={rot}><cylinderGeometry args={[r, r, h, seg]} /></mesh>;
}

/* ------------------------------------------------------------------ wheel */
const _tyre = new Map<string, THREE.BufferGeometry>();
function tyreGeo(R: number, w: number) {
  const key = `${R}-${w}`;
  let g = _tyre.get(key);
  if (!g) {
    const k = R / 0.55, h = w / 2;
    const pts = [[0.3, -h], [0.42, -h - 0.01], [0.5, -h + 0.005], [0.53, -h + 0.04], [0.55, -h + 0.09], [0.55, h - 0.09], [0.53, h - 0.04], [0.5, h - 0.005], [0.42, h + 0.01], [0.3, h]].map(([r, y]) => new THREE.Vector2(r * k, y));
    g = new THREE.LatheGeometry(pts, 40);
    g.rotateX(Math.PI / 2);
    _tyre.set(key, g);
  }
  return g;
}

function Wheel({ R, w = 0.32, side, x, z, roll, speed }: { R: number; w?: number; side: 1 | -1; x: number; z: number; roll: MutableRefObject<number>; speed: MutableRefObject<number> }) {
  const K = kit();
  const spin = useRef<THREE.Group>(null);
  const blur = useRef<THREE.Mesh>(null);
  const tread = useRef<THREE.InstancedMesh>(null);
  const lugs = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
    const N = 34;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      e.set(0, 0, a); q.setFromEuler(e);
      m.compose(new THREE.Vector3(Math.cos(a) * (R - 0.002), Math.sin(a) * (R - 0.002), 0), q, s);
      tread.current?.setMatrixAt(i, m);
    }
    if (tread.current) tread.current.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      m.compose(new THREE.Vector3(Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.3, 0), new THREE.Quaternion(), s);
      lugs.current?.setMatrixAt(i, m);
    }
    if (lugs.current) lugs.current.instanceMatrix.needsUpdate = true;
  }, [R]);
  useFrame(() => {
    if (spin.current) spin.current.rotation.z = roll.current;
    if (blur.current) (blur.current.material as THREE.MeshBasicMaterial).opacity = Math.min(Math.max(Math.abs(speed.current) - 6, 0) / 16, 0.55);
  });
  const fz = side * (w / 2 - 0.012);
  return (
    <group position={[x, R, z]}>
      <group ref={spin}>
        <mesh geometry={tyreGeo(R, w)} material={K.rubber} />
        <instancedMesh ref={tread} args={[undefined, undefined, 34]} material={K.rubber}>
          <boxGeometry args={[R * 0.045, R * 0.2, w * 0.8]} />
        </instancedMesh>
        <group position={[0, 0, fz]}>
          <Cyl r={R * 0.58} h={0.035} p={[0, 0, 0]} m={K.steel} rot={[Math.PI / 2, 0, 0]} seg={36} />
          <Cyl r={R * 0.44} h={0.05} p={[0, 0, side * 0.012]} m={K.dark} rot={[Math.PI / 2, 0, 0]} seg={32} />
          <mesh position={[0, 0, side * 0.03]} material={K.chrome}><torusGeometry args={[R * 0.53, 0.014, 8, 40]} /></mesh>
          <Cyl r={R * 0.2} h={0.1} p={[0, 0, side * 0.06]} m={K.chrome} rot={[Math.PI / 2, 0, 0]} seg={24} />
          <Cyl r={R * 0.11} h={0.12} p={[0, 0, side * 0.075]} m={K.red} rot={[Math.PI / 2, 0, 0]} seg={20} />
          <instancedMesh ref={lugs} args={[undefined, undefined, 8]} material={K.chrome} position={[0, 0, side * 0.035]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[R * 0.045, R * 0.045, 0.05, 6]} />
          </instancedMesh>
          <mesh position={[R * 0.5, 0, side * 0.02]} material={K.white}><boxGeometry args={[0.07, 0.035, 0.03]} /></mesh>
        </group>
      </group>
      <mesh ref={blur} position={[0, 0, side * (w / 2 + 0.03)]} rotation={[0, side > 0 ? 0 : Math.PI, 0]} userData={{ noShadow: true }}>
        <circleGeometry args={[R * 0.97, 28]} />
        <meshBasicMaterial color="#6d7078" transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ truck */
export function TruckModel({ kind = "medium_truck", speedRef, lights = false, scale = 1, shadowBlob = true }: { kind?: Kind; speedRef?: MutableRefObject<number>; lights?: boolean; scale?: number; shadowBlob?: boolean }) {
  const K = kit();
  const lay = truckLayout(kind);
  const { L, H, cs, R, cl, ch, cw, total, cabX, cargoX, yc, frontAxle, rearAxles, open } = lay;
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const roll = useRef(0), prev = useRef(0), acc = useRef(0);
  const zeroSpeed = useRef(0);
  const sp = speedRef || zeroSpeed;
  const target = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    root.current?.traverse((o: any) => {
      if (!o.isMesh || o.userData?.noShadow) return;
      const mat = o.material as THREE.Material;
      if (mat && (mat.transparent || (mat as any).isMeshBasicMaterial)) return;
      o.castShadow = true; o.receiveShadow = true;
    });
  });
  useFrame((s, dt) => {
    const v = sp.current, t = s.clock.elapsedTime, k = Math.min(Math.abs(v) / 8, 1);
    roll.current -= (v * dt) / R;
    const a = (v - prev.current) / Math.max(dt, 0.001); prev.current = v;
    acc.current += (THREE.MathUtils.clamp(a, -14, 14) - acc.current) * Math.min(dt * 4, 1);
    if (body.current) {
      body.current.position.y = Math.sin(t * 11.3) * 0.005 * k + Math.sin(t * 3.7) * 0.011 * k + Math.sin(t * 1.4) * 0.002 + Math.sin(t * 38) * 0.0012;
      body.current.rotation.z = acc.current * 0.0028 + Math.sin(t * 2.6) * 0.0025 * k;
      body.current.rotation.x = Math.sin(t * 2.1) * 0.004 * k;
    }
  });

  const cabY = yc + 0.06 + ch / 2;
  const cabTop = yc + 0.06 + ch;
  const winY = cabTop - ch * 0.3;
  const cargoY = yc + 0.1 + H / 2;
  const nRibs = Math.floor((L - 0.2) / 0.23);
  const ribs = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    if (!ribs.current) return;
    const m = new THREE.Matrix4();
    for (let i = 0; i < nRibs; i++) for (const sd of [1, -1]) {
      m.setPosition(-L / 2 + 0.2 + i * 0.23, 0.05, sd * (lay.cargoW / 2 + 0.012));
      ribs.current.setMatrixAt(i * 2 + (sd > 0 ? 0 : 1), m);
    }
    ribs.current.instanceMatrix.needsUpdate = true;
  }, [nRibs, L, lay.cargoW]);

  const headMat = lights ? K.headOn : K.headOff;
  const wheelZ = open ? 0.98 : 1.1;
  const duals = lay.dual;
  const rearOffsets = duals ? [0.8, 1.14] : [wheelZ];
  return (
    <group scale={scale}>
      <group ref={root}>
        <primitive object={target} position={[total / 2 + 14, 0.7, 0]} />
        {/* ground contact blob */}
        {shadowBlob && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} userData={{ noShadow: true }}>
            <planeGeometry args={[total + 2.2, 3.6]} />
            <meshBasicMaterial map={blobTexture()} transparent depthWrite={false} opacity={0.9} />
          </mesh>
        )}

        {/* axles (stay on the ground) + wheels */}
        {[frontAxle, ...rearAxles].map((x, i) => (
          <group key={i}>
            <Cyl r={0.07} h={2.1} p={[x, R, 0]} m={K.dark} rot={[Math.PI / 2, 0, 0]} seg={12} />
            {i === 0 && <RB s={[0.34, 0.22, 0.4]} p={[x, R + 0.02, 0]} m={K.dark} r={0.05} />}
          </group>
        ))}
        {[1, -1].map((sd) => (
          <Wheel key={`f${sd}`} R={R} side={sd as 1 | -1} x={frontAxle} z={sd * wheelZ} roll={roll} speed={sp} />
        ))}
        {rearAxles.flatMap((x, i) => [1, -1].flatMap((sd) => rearOffsets.map((o, j) => (
          <Wheel key={`r${i}${sd}${j}`} R={R} side={sd as 1 | -1} x={x} z={sd * o} roll={roll} speed={sp} />
        ))))}
        {/* mudguards */}
        {[frontAxle, ...rearAxles.slice(0, 1)].flatMap((x, i) => [1, -1].map((sd) => (
          <mesh key={`mg${i}${sd}`} material={K.plastic} position={[x, R, sd * (i === 0 ? wheelZ : duals ? 0.97 : wheelZ)]} rotation={[Math.PI / 2, 0, 0]} userData={{ noShadow: false }}>
            <cylinderGeometry args={[R + 0.13, R + 0.13, i === 0 ? 0.44 : duals ? 0.8 : 0.44, 24, 1, true, Math.PI / 2, Math.PI]} />
          </mesh>
        )))}

        {/* everything above the suspension */}
        <group ref={body}>
          {/* chassis */}
          {[1, -1].map((sd) => <RB key={sd} s={[total - 0.15, 0.17, 0.11]} p={[0, yc - 0.17, sd * 0.56]} m={K.dark} r={0.02} />)}
          {[-1.6, -0.2, 1.2].map((x, i) => <RB key={i} s={[0.1, 0.1, 1.1]} p={[x * (total / 5.5), yc - 0.17, 0]} m={K.dark} r={0.02} />)}
          {/* fuel tank + battery + exhaust */}
          <Cyl r={0.3 * cs} h={1.15} p={[cabX - cl / 2 - 0.85, yc - 0.32, wheelZ - 0.3]} m={K.steel} rot={[0, 0, Math.PI / 2]} seg={24} />
          {[0.35, -0.35].map((o) => <RB key={o} s={[0.05, 0.62 * cs, 0.05]} p={[cabX - cl / 2 - 0.85 + o, yc - 0.32, wheelZ - 0.3]} m={K.dark} r={0.01} cast={false} />)}
          <RB s={[0.6, 0.38, 0.4]} p={[cabX - cl / 2 - 0.55, yc - 0.34, -(wheelZ - 0.35)]} m={K.plastic} r={0.04} />
          <Cyl r={0.065} h={2.1 * cs} p={[cabX - cl / 2 - 0.12, yc + 0.9 * cs, cw / 2 - 0.05]} m={K.chrome} seg={16} />
          <Cyl r={0.095} h={0.14} p={[cabX - cl / 2 - 0.12, yc + 1.98 * cs, cw / 2 - 0.05]} m={K.dark} seg={16} />

          {/* ===== cab ===== */}
          <group position={[cabX, 0, 0]}>
            <RB s={[cl, ch, cw]} p={[0, cabY, 0]} m={K.red} r={0.16} />
            <RB s={[cl * 1.015, 0.34 * cs, cw * 1.012]} p={[0, yc + 0.28, 0]} m={K.plastic} r={0.06} />
            <RB s={[cl * 0.9, 0.1, cw * 0.95]} p={[-0.02, cabTop + 0.03, 0]} m={K.redDeep} r={0.05} />
            {/* roof marker lights */}
            {[-0.5, 0, 0.5].map((z) => <RB key={z} s={[0.07, 0.07, 0.17]} p={[cl / 2 - 0.12, cabTop + 0.1, z * cw * 0.6]} m={K.amber} r={0.02} cast={false} />)}
            {/* windscreen */}
            <RB s={[0.06, ch * 0.5, cw * 0.95]} p={[cl / 2 - 0.005, winY, 0]} m={K.plastic} r={0.03} />
            <RB s={[0.06, ch * 0.44, cw * 0.88]} p={[cl / 2 + 0.012, winY, 0]} m={K.glass} r={0.03} cast={false} />
            {/* side glass, door seams, handles */}
            {[1, -1].map((sd) => (
              <group key={sd}>
                <RB s={[cl * 0.56, ch * 0.4, 0.05]} p={[cl * 0.06, winY, sd * (cw / 2 + 0.003)]} m={K.plastic} r={0.03} />
                <RB s={[cl * 0.5, ch * 0.34, 0.05]} p={[cl * 0.06, winY, sd * (cw / 2 + 0.014)]} m={K.glass} r={0.03} cast={false} />
                <RB s={[0.02, ch * 0.88, 0.04]} p={[-cl * 0.26, cabY - 0.05, sd * (cw / 2 + 0.006)]} m={K.dark} r={0.008} cast={false} />
                <RB s={[0.02, ch * 0.7, 0.04]} p={[cl * 0.36, cabY - 0.12, sd * (cw / 2 + 0.006)]} m={K.dark} r={0.008} cast={false} />
                <RB s={[0.22, 0.045, 0.05]} p={[-cl * 0.14, winY - ch * 0.26, sd * (cw / 2 + 0.03)]} m={K.chrome} r={0.02} />
                <RB s={[cl * 0.9, 0.06, 0.03]} p={[0, yc + 0.5, sd * (cw / 2 + 0.01)]} m={K.white} r={0.01} cast={false} />
                {/* step */}
                <RB s={[0.42, 0.05, 0.26]} p={[cl * 0.1, yc - 0.12, sd * (cw / 2 + 0.06)]} m={K.steel} r={0.015} />
                {/* mirror */}
                <Cyl r={0.018} h={0.38} p={[cl / 2 - 0.28, winY + 0.12, sd * (cw / 2 + 0.17)]} m={K.dark} rot={[Math.PI / 2, 0, 0]} seg={8} />
                <RB s={[0.1, 0.42 * cs, 0.17]} p={[cl / 2 - 0.28, winY + 0.05, sd * (cw / 2 + 0.36)]} m={K.plastic} r={0.04} />
                <RB s={[0.012, 0.36 * cs, 0.14]} p={[cl / 2 - 0.332, winY + 0.05, sd * (cw / 2 + 0.36)]} m={K.chrome} r={0.005} cast={false} />
              </group>
            ))}
            {/* grille */}
            <RB s={[0.07, ch * 0.25, cw * 0.7]} p={[cl / 2 + 0.01, yc + 0.06 + ch * 0.2, 0]} m={K.plastic} r={0.03} />
            {[0, 1, 2, 3].map((i) => <RB key={i} s={[0.05, 0.022, cw * 0.66]} p={[cl / 2 + 0.05, yc + 0.06 + ch * 0.1 + i * 0.075 * cs, 0]} m={K.chrome} r={0.008} />)}
            <mesh material={K.red} position={[cl / 2 + 0.06, yc + 0.06 + ch * 0.2, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.1, 0.1, 0.02, 24]} /></mesh>
            {/* headlamps */}
            {[1, -1].map((sd) => (
              <group key={sd}>
                <RB s={[0.12, 0.3 * cs, 0.5]} p={[cl / 2 - 0.02, yc + 0.06 + ch * 0.19, sd * cw * 0.39]} m={K.plastic} r={0.05} />
                <RB s={[0.05, 0.2 * cs, 0.4]} p={[cl / 2 + 0.05, yc + 0.06 + ch * 0.2, sd * cw * 0.39]} m={headMat} r={0.04} cast={false} />
                <RB s={[0.04, 0.06, 0.4]} p={[cl / 2 + 0.05, yc + 0.06 + ch * 0.2 - 0.17 * cs, sd * cw * 0.39]} m={K.amber} r={0.02} cast={false} />
                {lights && (
                  <>
                    <spotLight position={[cl / 2 + 0.1, yc + 0.75 * cs, sd * cw * 0.39]} target={target} angle={0.42} penumbra={0.75} intensity={90} distance={36} decay={1.6} color="#fff0cc" />
                    <sprite position={[cl / 2 + 0.25, yc + 0.6 * cs, sd * cw * 0.39]} scale={[1.9, 1.3, 1]} userData={{ noShadow: true }}>
                      <spriteMaterial map={glowTex()} color="#fff1cc" blending={THREE.AdditiveBlending} depthWrite={false} transparent opacity={0.85} />
                    </sprite>
                  </>
                )}
              </group>
            ))}
            {/* bumper */}
            <RB s={[0.3, 0.34, cw + 0.06]} p={[cl / 2 + 0.12, yc - 0.1, 0]} m={K.steel} r={0.07} />
            <RB s={[0.32, 0.05, cw * 0.96]} p={[cl / 2 + 0.12, yc + 0.1, 0]} m={K.chrome} r={0.02} />
            {[1, -1].map((sd) => <RB key={sd} s={[0.06, 0.1, 0.2]} p={[cl / 2 + 0.28, yc - 0.1, sd * cw * 0.36]} m={headMat} r={0.03} cast={false} />)}
            <RB s={[0.02, 0.2, 0.5]} p={[cl / 2 + 0.285, yc - 0.12, 0]} m={K.plate} r={0.01} cast={false} />
          </group>

          {/* ===== cargo ===== */}
          {open ? (
            <group position={[cargoX, yc + 0.1, 0]}>
              <RB s={[L, 0.1, 2.0]} p={[0, 0.05, 0]} m={K.dark} r={0.03} />
              {[1, -1].map((sd) => <RB key={sd} s={[L, 0.6, 0.06]} p={[0, 0.42, sd * 0.97]} m={K.white} r={0.025} />)}
              <RB s={[0.06, 0.6, 2.0]} p={[-L / 2 + 0.03, 0.42, 0]} m={K.white} r={0.025} />
              <RB s={[0.06, 0.6, 2.0]} p={[L / 2 - 0.03, 0.42, 0]} m={K.white} r={0.025} />
              {[1, -1].map((sd) => <RB key={sd} s={[L, 0.06, 0.09]} p={[0, 0.74, sd * 0.97]} m={K.red} r={0.02} />)}
              <RB s={[0.08, 0.2, 0.4]} p={[-L / 2 - 0.02, 0.1, 0]} m={K.plate} r={0.02} />
              {[1, -1].map((sd) => <RB key={sd} s={[0.06, 0.16, 0.18]} p={[-L / 2 - 0.02, 0.3, sd * 0.8]} m={K.tail} r={0.03} cast={false} />)}
            </group>
          ) : (
            <group position={[cargoX, 0, 0]}>
              <RB s={[L, H, lay.cargoW]} p={[0, cargoY, 0]} m={K.white} r={0.05} />
              <RB s={[L + 0.02, 0.15, lay.cargoW + 0.04]} p={[0, yc + 0.17, 0]} m={K.dark} r={0.03} />
              <RB s={[L + 0.014, 0.3, lay.cargoW + 0.016]} p={[0, yc + 0.5, 0]} m={K.red} r={0.03} />
              <instancedMesh ref={ribs} args={[undefined, undefined, nRibs * 2]} material={K.whiteRib} position={[0, cargoY, 0]}>
                <boxGeometry args={[0.07, H - 0.55, 0.035]} />
              </instancedMesh>
              {[1, -1].map((sd) => (
                <group key={sd}>
                  <RB s={[L + 0.03, 0.06, 0.06]} p={[0, cargoY + H / 2 - 0.02, sd * (lay.cargoW / 2 + 0.01)]} m={K.steel} r={0.02} />
                  <mesh material={K.decal} position={[0.1, cargoY + 0.12, sd * (lay.cargoW / 2 + 0.04)]} rotation={[0, sd > 0 ? 0 : Math.PI, 0]} userData={{ noShadow: true }}>
                    <planeGeometry args={[Math.min(L - 0.8, 3.4), Math.min(L - 0.8, 3.4) / 4]} />
                  </mesh>
                </group>
              ))}
              {/* front wall gap guard + rear doors */}
              {[0.6, -0.6].map((z) => <RB key={z} s={[0.06, H - 0.12, 1.12]} p={[-L / 2 - 0.02, cargoY, z]} m={K.white} r={0.03} />)}
              {[0.28, -0.28, 0.9, -0.9].map((z) => <Cyl key={z} r={0.024} h={H - 0.3} p={[-L / 2 - 0.075, cargoY, z]} m={K.chrome} seg={10} />)}
              {[0.4, -0.4].map((z) => <RB key={z} s={[0.06, 0.12, 0.1]} p={[-L / 2 - 0.09, cargoY - 0.1, z]} m={K.steel} r={0.02} />)}
              <RB s={[0.18, 0.2, lay.cargoW - 0.2]} p={[-L / 2 - 0.14, yc - 0.12, 0]} m={K.dark} r={0.04} />
              {[1, -1].map((sd) => <RB key={sd} s={[0.07, 0.24, 0.22]} p={[-L / 2 - 0.05, yc + 0.32, sd * (lay.cargoW / 2 - 0.15)]} m={K.tail} r={0.04} cast={false} />)}
              <RB s={[0.02, 0.2, 0.52]} p={[-L / 2 - 0.25, yc - 0.1, 0]} m={K.plate} r={0.01} cast={false} />
              {/* reflective chevron tape on the rear bumper */}
              {[-0.8, -0.4, 0, 0.4, 0.8].map((z, i) => <RB key={z} s={[0.02, 0.1, 0.17]} p={[-L / 2 - 0.235, yc - 0.12, z]} m={i % 2 ? K.white : K.tape} r={0.005} cast={false} />)}
            </group>
          )}
        </group>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ lights + reflections */
export function Lights({ shadow = true, follow, strength = 1, dim = false }: { shadow?: boolean; follow?: RefObject<THREE.Object3D | null>; strength?: boolean | number; dim?: boolean }) {
  const { gl, scene } = useThree();
  const key = useRef<THREE.DirectionalLight>(null);
  const tgt = useMemo(() => new THREE.Object3D(), []);
  const small = isMobileGpu();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    (scene as any).environmentIntensity = dim ? 0.38 : 0.7;
    return () => { scene.environment = null; env.dispose(); pm.dispose(); };
  }, [gl, scene, dim]);
  useFrame(() => {
    if (!follow?.current || !key.current) return;
    const p = follow.current.position;
    key.current.position.set(p.x + 6, 11, 7);
    tgt.position.set(p.x, 0, 0);
  });
  const s = typeof strength === "number" ? strength : 1;
  return (
    <>
      <ambientLight intensity={0.18 * s} />
      <hemisphereLight args={["#aab4cc", "#15131B", 0.45 * s]} />
      <primitive object={tgt} />
      <directionalLight ref={key} target={tgt} position={[6, 11, 7]} intensity={(dim ? 1.7 : 2.6) * s} color="#fff6ea" castShadow={shadow}
        shadow-mapSize={[small ? 1024 : 2048, small ? 1024 : 2048]} shadow-camera-left={-13} shadow-camera-right={13} shadow-camera-top={9} shadow-camera-bottom={-9} shadow-camera-near={1} shadow-camera-far={40} shadow-bias={-0.0004} shadow-normalBias={0.04} />
      <directionalLight position={[-8, 4, -6]} intensity={0.4 * s} color="#A8651A" />
      <directionalLight position={[-3, 2, 9]} intensity={0.5 * s} color="#9fb4ff" />
    </>
  );
}

/** Soft dark studio floor that only shows shadows + a faint brand ring (works on light and dark pages). */
function StudioFloor({ ring = true, r = 6 }: { ring?: boolean; r?: number }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow userData={{ noShadow: true }}>
        <circleGeometry args={[r, 64]} />
        <shadowMaterial opacity={0.38} />
      </mesh>
      {ring && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
          <ringGeometry args={[r * 0.86, r * 0.865, 96]} />
          <meshBasicMaterial color="#A8651A" transparent opacity={0.45} />
        </mesh>
      )}
    </group>
  );
}


/* ------------------------------------------------------------------ two-wheelers and cargo auto */
function SmallWheel({ R, w = 0.16, p }: { R: number; w?: number; p: V3 }) {
  const K = kit();
  return (
    <group position={p} rotation={[Math.PI / 2, 0, 0]}>
      <Cyl r={R} h={w} p={[0, 0, 0]} m={K.rubber} seg={28} />
      <Cyl r={R * 0.62} h={w + 0.012} p={[0, 0, 0]} m={K.steel} seg={24} />
      <Cyl r={R * 0.2} h={w + 0.03} p={[0, 0, 0]} m={K.chrome} seg={12} />
    </group>
  );
}
function Lamp({ p, m, r = 0.09 }: { p: V3; m: THREE.Material; r?: number }) {
  return <mesh material={m} position={p}><sphereGeometry args={[r, 16, 12]} /></mesh>;
}
function BikeBody({ scooter }: { scooter: boolean }) {
  const K = kit();
  const R = scooter ? 0.3 : 0.4, fx = scooter ? 0.72 : 0.95, rx = scooter ? -0.72 : -0.95;
  return (
    <group>
      <SmallWheel R={R} p={[fx, R, 0]} />
      <SmallWheel R={R} w={scooter ? 0.2 : 0.2} p={[rx, R, 0]} />
      {scooter ? (
        <>
          <RB s={[0.85, 0.1, 0.36]} p={[0.12, 0.36, 0]} m={K.dark} />
          <RB s={[0.12, 0.78, 0.4]} p={[0.5, 0.78, 0]} rot={[0, 0, 0.12]} m={K.red} r={0.05} />
          <RB s={[0.62, 0.42, 0.38]} p={[-0.42, 0.6, 0]} m={K.red} r={0.08} />
          <RB s={[0.7, 0.12, 0.34]} p={[-0.3, 0.88, 0]} m={K.plastic} r={0.05} />
          <RB s={[0.05, 0.8, 0.05]} p={[0.66, 0.6, 0]} rot={[0, 0, 0.22]} m={K.steel} r={0.02} />
          <RB s={[0.22, 0.2, 0.46]} p={[0.58, 1.18, 0]} m={K.white} r={0.07} />
          <RB s={[0.07, 0.06, 0.78]} p={[0.5, 1.12, 0]} m={K.dark} r={0.02} />
          <Lamp p={[0.7, 1.15, 0]} m={K.headOff} r={0.08} />
          <RB s={[0.5, 0.46, 0.5]} p={[-0.78, 1.18, 0]} m={K.white} r={0.06} />
          <RB s={[0.52, 0.06, 0.52]} p={[-0.78, 1.43, 0]} m={K.red} r={0.02} />
        </>
      ) : (
        <>
          <RB s={[1.1, 0.14, 0.2]} p={[0, 0.68, 0]} rot={[0, 0, 0.05]} m={K.dark} r={0.04} />
          <RB s={[0.42, 0.38, 0.32]} p={[0.04, 0.5, 0]} m={K.dark} r={0.06} />
          <RB s={[0.5, 0.3, 0.34]} p={[0.32, 0.98, 0]} m={K.red} r={0.1} />
          <RB s={[0.62, 0.11, 0.3]} p={[-0.25, 0.92, 0]} m={K.plastic} r={0.05} />
          <RB s={[0.4, 0.2, 0.3]} p={[-0.6, 0.86, 0]} m={K.red} r={0.07} />
          <RB s={[0.07, 0.86, 0.07]} p={[0.82, 0.78, 0]} rot={[0, 0, 0.3]} m={K.steel} r={0.03} />
          <RB s={[0.07, 0.06, 0.8]} p={[0.7, 1.2, 0]} m={K.dark} r={0.02} />
          <Lamp p={[0.86, 1.08, 0]} m={K.headOff} r={0.1} />
          <Cyl r={0.05} h={0.85} p={[-0.35, 0.34, 0.2]} rot={[0, 0, Math.PI / 2]} m={K.chrome} />
          <RB s={[0.6, 0.5, 0.5]} p={[-0.86, 1.2, 0]} m={K.white} r={0.06} />
          <RB s={[0.62, 0.06, 0.52]} p={[-0.86, 1.46, 0]} m={K.red} r={0.02} />
        </>
      )}
      <mesh material={K.tail} position={[scooter ? -1.05 : -1.2, scooter ? 0.62 : 0.9, 0]}><boxGeometry args={[0.04, 0.08, 0.22]} /></mesh>
    </group>
  );
}
function AutoBody() {
  const K = kit();
  const R = 0.3;
  return (
    <group>
      <SmallWheel R={R} w={0.2} p={[1.05, R, 0]} />
      <SmallWheel R={R} w={0.2} p={[-0.75, R, 0.66]} />
      <SmallWheel R={R} w={0.2} p={[-0.75, R, -0.66]} />
      <RB s={[2.5, 0.14, 1.3]} p={[-0.05, 0.5, 0]} m={K.dark} r={0.04} />
      <RB s={[0.75, 0.5, 0.62]} p={[0.92, 0.78, 0]} m={K.red} r={0.14} />
      <RB s={[0.5, 0.05, 0.5]} p={[1.02, 0.52, 0]} m={K.red} r={0.02} />
      <RB s={[0.05, 0.62, 0.7]} p={[0.55, 1.22, 0]} rot={[0, 0, 0.2]} m={K.glass} r={0.02} />
      <RB s={[1.2, 0.07, 1.3]} p={[-0.1, 1.95, 0]} m={K.white} r={0.05} />
      <RB s={[0.1, 0.07, 1.1]} p={[0.58, 1.9, 0]} rot={[0, 0, -0.15]} m={K.white} r={0.03} />
      {[[0.5, 0.58], [0.5, -0.58], [-0.65, 0.58], [-0.65, -0.58]].map(([x, z], i) => <Cyl key={i} r={0.035} h={1.38} p={[x, 1.24, z]} m={K.dark} seg={10} />)}
      <RB s={[0.5, 0.18, 1.08]} p={[-0.2, 0.7, 0]} m={K.plastic} r={0.05} />
      <RB s={[0.12, 0.45, 1.0]} p={[-0.5, 1.0, 0]} m={K.plastic} r={0.04} />
      <RB s={[1.05, 0.32, 0.05]} p={[-0.05, 0.78, 0.64]} m={K.red} r={0.02} />
      <RB s={[1.05, 0.32, 0.05]} p={[-0.05, 0.78, -0.64]} m={K.red} r={0.02} />
      <RB s={[1.15, 0.08, 1.3]} p={[-1.3, 0.62, 0]} m={K.steel} r={0.03} />
      <RB s={[1.15, 0.42, 0.06]} p={[-1.3, 0.88, 0.64]} m={K.red} r={0.02} />
      <RB s={[1.15, 0.42, 0.06]} p={[-1.3, 0.88, -0.64]} m={K.red} r={0.02} />
      <RB s={[0.06, 0.42, 1.3]} p={[-1.88, 0.88, 0]} m={K.red} r={0.02} />
      <RB s={[0.5, 0.4, 0.5]} p={[-1.5, 0.88, 0.25]} m={K.kraft} r={0.03} />
      <RB s={[0.5, 0.3, 0.5]} p={[-1.35, 0.83, -0.28]} m={K.kraft} r={0.03} />
      <RB s={[0.06, 0.06, 0.6]} p={[0.62, 1.0, 0]} m={K.dark} r={0.02} />
      <Lamp p={[1.3, 0.88, 0]} m={K.headOff} r={0.1} />
      <RB s={[0.6, 0.06, 0.5]} p={[1.05, 0.66, 0]} m={K.red} r={0.02} />
      <mesh material={K.tail} position={[-1.92, 0.9, 0.45]}><boxGeometry args={[0.04, 0.1, 0.12]} /></mesh>
      <mesh material={K.tail} position={[-1.92, 0.9, -0.45]}><boxGeometry args={[0.04, 0.1, 0.12]} /></mesh>
    </group>
  );
}
export const SMALL_KINDS = ["scooty", "bike", "auto"];
function SmallVehicleModel({ kind, scale = 1 }: { kind: string; scale?: number }) {
  const g = useRef<THREE.Group>(null);
  useEffect(() => {
    g.current?.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }, [kind]);
  return (
    <group ref={g} scale={scale}>
      {kind === "auto" ? <AutoBody /> : <BikeBody scooter={kind === "scooty"} />}
    </group>
  );
}

const SCALE_BY_KIND: Record<string, number> = { mini_truck: 1.3, pickup: 1.2, medium_truck: 1.0, heavy_truck: 0.86, trailer: 0.7, hero_truck: 0.8, scooty: 2.9, bike: 2.6, auto: 2.0 };

/** Slowly rotating truck for vehicle selection. One canvas only (mobile GPU friendly). */
export function VehicleViewer({ kind, className = "" }: { kind: string; className?: string }) {
  const [ok] = useState(canUse3D);
  if (!ok) return <div className={`flex items-center justify-center ${className}`}><TruckSvg kind={kind} className="w-4/5" dark /></div>;
  return (
    <div className={className}>
      <Canvas shadows dpr={[1, 1.6]} camera={{ position: [8.6, 3.8, 10.2], fov: 34 }} gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}>
        <Suspense fallback={null}>
          <Lights dim />
          <Rotator>{SMALL_KINDS.includes(kind) ? <SmallVehicleModel kind={kind} scale={SCALE_BY_KIND[kind] ?? 1} /> : <TruckModel kind={kind} scale={SCALE_BY_KIND[kind] ?? 1} />}<StudioFloor r={4.9} /></Rotator>
        </Suspense>
      </Canvas>
    </div>
  );
}
function Rotator({ children }: { children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame((s, dt) => { if (g.current) { g.current.rotation.y += dt * 0.3; g.current.position.y = -1.25; } void s; });
  return <group ref={g} position={[0, -1.25, 0]}>{children}</group>;
}

/* ------------------------------------------------------------------ driver search: truck circling a radar ring */
export function FindingLoader({ className = "" }: { className?: string }) {
  const [ok] = useState(canUse3D);
  if (!ok) {
    return (
      <div className={`relative flex items-center justify-center ${className}`}>
        <span className="absolute w-40 h-40 rounded-full border-2 border-brand/40 animate-ping" />
        <TruckSvg kind="pickup" moving className="w-44 relative" />
      </div>
    );
  }
  return (
    <div className={className}>
      <Canvas shadows dpr={[1, 1.5]} camera={{ position: [0, 10.6, 11.8], fov: 36 }} gl={{ alpha: true, powerPreference: "high-performance" }}>
        <Lights dim />
        <Orbiter />
      </Canvas>
    </div>
  );
}
function Orbiter() {
  const g = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const sp = useRef(5);
  useFrame((s) => {
    const t = s.clock.elapsedTime * 0.8, r = 3.5;
    if (g.current) { g.current.position.set(Math.cos(t) * r, 0, -Math.sin(t) * r); g.current.rotation.y = t + Math.PI; }
    sp.current = 0.8 * r;
    if (ring.current) { const k = (s.clock.elapsedTime % 2) / 2; ring.current.scale.setScalar(0.4 + k * 1.6); (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k); }
  });
  return (
    <>
      <StudioFloor r={5} ring={false} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}><ringGeometry args={[3.4, 3.6, 72]} /><meshBasicMaterial color="#A8651A" transparent opacity={0.55} /></mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}><ringGeometry args={[3.3, 3.6, 72]} /><meshBasicMaterial color="#A8651A" transparent opacity={0.4} /></mesh>
      <group ref={g}><TruckModel kind="pickup" speedRef={sp} scale={0.6} /></group>
    </>
  );
}

/* ------------------------------------------------------------------ booking confirmation / delivery completed scenes */
const ease = (x: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(x, 0, 1), 3);
const bounce = (x: number) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t < 0.6 ? 1 - Math.pow(1 - t / 0.6, 2) * 1 + 0 : 1 + Math.sin((t - 0.6) / 0.4 * Math.PI) * 0.08; };

function Box({ p, s = 0.62, rot = 0 }: { p: V3; s?: number; rot?: number }) {
  const K = kit();
  return (
    <group position={p} rotation={[0, rot, 0]}>
      <RB s={[s, s * 0.8, s]} p={[0, 0, 0]} m={K.kraft} r={0.03} />
      <RB s={[s * 0.18, s * 0.805, s * 1.02]} p={[0, 0, 0]} m={K.tape} r={0.01} cast={false} />
    </group>
  );
}

function ScenePackage({ mode }: { mode: "loading" | "delivered" }) {
  const truck = useRef<THREE.Group>(null);
  const boxes = useRef<THREE.Group[]>([]);
  const badge = useRef<THREE.Group>(null);
  const sp = useRef(0);
  const last = useRef(0);
  const lay = truckLayout("pickup");
  const bedY = lay.yc + 0.2;
  const slots: V3[] = [[lay.cargoX - 0.7, bedY + 0.25, 0.45], [lay.cargoX - 0.7, bedY + 0.25, -0.45], [lay.cargoX + 0.6, bedY + 0.25, 0.0], [lay.cargoX - 0.1, bedY + 0.78, 0.0]];
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    if (mode === "loading") {
      const cyc = t % 5.2;
      boxes.current.forEach((b, i) => {
        if (!b) return;
        const t0 = 0.3 + i * 1.0, k = (cyc - t0) / 0.7;
        const [x, y, z] = slots[i];
        if (k < 0) b.visible = false;
        else { b.visible = true; const fall = k >= 1 ? 0 : (1 - ease(k)) ; b.position.set(x - fall * 0.2, y + fall * 4.5, z); b.rotation.y = fall * 1.3; b.scale.setScalar(k >= 1 && k < 1.25 ? 1 + Math.sin((k - 1) * 4 * Math.PI) * 0.05 : 1); }
      });
      sp.current = 0;
    } else {
      // roll in, brake, unload one parcel, show success badge
      const tIn = 2.0, x0 = -11, x1 = 0.4;
      const x = t < tIn ? x0 + (x1 - x0) * ease(t / tIn) : x1;
      const v = t < tIn ? ((x1 - x0) * 3 * Math.pow(1 - THREE.MathUtils.clamp(t / tIn, 0, 1), 2)) / tIn : 0;
      sp.current = v; last.current = x;
      if (truck.current) truck.current.position.x = x;
      boxes.current.forEach((b, i) => {
        if (!b) return;
        const [sx, sy, sz] = slots[i];
        if (i === 3) { const k = (t - 2.4) / 0.9; const e = ease(k); b.position.set(sx + x - 0 - e * 2.6 + 0, sy - e * (sy - 0.32) , sz + e * 1.6); b.rotation.y = e * 0.6; }
        else b.position.set(sx + x, sy, sz);
      });
      if (badge.current) { const k = bounce((t - 3.2) / 0.9); badge.current.scale.setScalar(Math.max(k, 0.0001)); badge.current.rotation.y = Math.sin(t * 1.4) * 0.25; badge.current.position.y = 3.05 + Math.sin(t * 2) * 0.05; }
    }
  });
  const K = kit();
  return (
    <>
      <StudioFloor r={7} ring={false} />
      <group ref={truck}><TruckModel kind="pickup" speedRef={sp} scale={1} /></group>
      {slots.map((p, i) => <group key={i} ref={(g) => { if (g) boxes.current[i] = g; }} visible={mode === "delivered"} position={[p[0], p[1], p[2]]}><Box p={[0, 0, 0]} s={i === 3 ? 0.6 : 0.78} /></group>)}
      {mode === "delivered" && (
        <group ref={badge} position={[0.2, 3.05, 0]} scale={0.0001}>
          <mesh material={K.green}><torusGeometry args={[0.72, 0.09, 16, 48]} /></mesh>
          <RB s={[0.28, 0.1, 0.1]} p={[-0.22, -0.06, 0]} m={K.green} r={0.04} rot={[0, 0, -Math.PI / 4]} />
          <RB s={[0.66, 0.1, 0.1]} p={[0.1, 0.04, 0]} m={K.green} r={0.04} rot={[0, 0, Math.PI / 4]} />
        </group>
      )}
    </>
  );
}

/** 3D package-loading (booking confirmation) or delivery-completed scene. SVG art is only the low-power fallback. */
export function PackageScene({ done = false, className = "h-44" }: { done?: boolean; className?: string }) {
  const [ok] = useState(canUse3D);
  if (!ok) return <PackageLoadArt done={done} />;
  return (
    <div className={className} aria-hidden>
      <Canvas shadows dpr={[1, 1.5]} camera={{ position: [5.8, 3.4, 10.4], fov: 36 }} gl={{ alpha: true, powerPreference: "high-performance" }}>
        <Lights dim />
        <group position={[0.5, -0.9, 0]}><ScenePackage mode={done ? "delivered" : "loading"} /></group>
      </Canvas>
    </div>
  );
}

/* ------------------------------------------------------------------ top-down render of the same 3D truck for live-tracking map markers */
let spritePromise: Promise<string | null> | null = null;
export function truckSprite(): Promise<string | null> {
  if (spritePromise) return spritePromise;
  spritePromise = new Promise((resolve) => {
    if (!canUse3D()) return resolve(null);
    try {
      const W = 112, Hh = 256;
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = Hh;
      extend(THREE as any);
      const root = createRoot(canvas);
      let frames = 0;
      const Cam = () => {
        const { camera } = useThree();
        useEffect(() => { camera.up.set(1, 0, 0); camera.position.set(0.1, 30, 0); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); }, [camera]);
        useFrame(() => { frames++; if (frames === 6) setTimeout(() => { try { resolve(canvas.toDataURL("image/png")); } catch { resolve(null); } setTimeout(() => root.unmount(), 50); }, 60); });
        return null;
      };
      root.configure({ gl: { alpha: true, antialias: true, preserveDrawingBuffer: true }, dpr: 2, orthographic: true, camera: { zoom: 22, position: [0, 30, 0], near: 0.1, far: 80 }, size: { width: W, height: Hh, top: 0, left: 0 }, shadows: true });
      root.render(<><Cam /><Lights dim /><TruckModel kind="heavy_truck" shadowBlob={false} scale={1} /></>);
      setTimeout(() => resolve(null), 6000);
    } catch { resolve(null); }
  });
  return spritePromise;
}
