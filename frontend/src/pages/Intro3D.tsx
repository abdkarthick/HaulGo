import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState, Component, ReactNode } from "react";
import * as THREE from "three";
import { Lights, TruckModel } from "../components/Truck3D";
import { RoadWorld } from "../components/World3D";

const T_ARRIVE = 1.2;
const T_ORBIT = 2.0;
const T_LOGO = 1.6;
const T_SLOW = 2.5;
const T_EXIT = 3.2;
const easeOut = (x: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(x, 0, 1), 3);
const easeIn = (x: number) => Math.pow(THREE.MathUtils.clamp(x, 0, 1), 2.6);
const easeIO = (x: number) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

// FIX: 3D fail aanaalum Intro crash aagathu, logo mattum kaatum
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return <div className="absolute inset-0 bg-obsidian flex items-center justify-center"><p className="text-white font-extrabold text-[13vw] sm:text-[6.4vw]">HAUL<span className="text-brand">GO</span></p></div>;
    return this.props.children;
  }
}

export default function Intro3D() {
  const [logo, setLogo] = useState(false);
  return (
    <ErrorBoundary>
      <div className="absolute inset-0 bg-obsidian">
        <Canvas dpr={1} camera={{ fov: 34, position: [8, 1.6, 9], near: 0.1, far: 200 }} gl={{ antialias: false, powerPreference: "low-power", stencil: false, depth: true }}>
          <Director onLogo={() => setLogo(true)} />
        </Canvas>
        <div className={`absolute left-0 right-0 top-[5%] text-center pointer-events-none transition-opacity duration-300 ${logo ? "opacity-100" : "opacity-0"}`}>
          <p className="text-white font-extrabold text-[13vw] sm:text-[6.4vw]">HAUL<span className="text-brand">GO</span></p>
        </div>
      </div>
    </ErrorBoundary>
  );
}

function Director({ onLogo }: { onLogo: () => void }) {
  const truck = useRef<THREE.Group>(null);
  const speed = useRef(13), off = useRef(0), vTruck = useRef(13);
  const logoShown = useRef(false);
  const last = useRef({ x: -40, t: 0 });
  const t0 = useRef<number | null>(null);
  const look = useMemo(() => new THREE.Vector3(), []);
  const { camera, size } = useThree();
  useFrame((s) => {
    if (t0.current === null) t0.current = s.clock.elapsedTime;
    const t = s.clock.elapsedTime - t0.current;
    const aspect = size.width / size.height;
    const dBase = THREE.MathUtils.clamp(23.5 / Math.min(aspect, 2.2), 12.5, 38);
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
    const kOrbit = easeIO((t - 0.6) / (T_ORBIT - 0.6));
    const az = THREE.MathUtils.degToRad(34 + 56 * kOrbit);
    const d = dBase * (1 + 0.12 * (1 - kOrbit));
    const h = 1.15 + 0.7 * kOrbit;
    camera.position.set(Math.cos(az) * d, h, Math.sin(az) * d);
    look.set(THREE.MathUtils.lerp(0.3, 0, kOrbit), 1.3 + 1.1 * kOrbit, 0);
    camera.lookAt(look);
    if (t > T_LOGO && !logoShown.current) { logoShown.current = true; onLogo(); }
  });
  return (
    <>
      <RoadWorld speedRef={speed} offRef={off} />
      <Lights dim follow={truck} />
      <group ref={truck} position={[-40, 0, 0]}><TruckModel kind="hero_truck" speedRef={vTruck} lights scale={1} /></group>
    </>
  );
}