"use client";

import {Canvas, type ThreeEvent, useFrame} from "@react-three/fiber";
import {Line, OrbitControls, Sparkles} from "@react-three/drei";
import {useEffect, useMemo, useRef} from "react";
import * as THREE from "three";
import type {Transfer} from "@/data/types";

const MAX_NODES = 84;
const MAX_FLOWS = 44;
const BLUE = new THREE.Color("#45aaff");
const CONTRACT = new THREE.Color("#d7a768");
const GOLD = new THREE.Color("#efbd76");

type Props = {transfers: Transfer[]; selected: string | null; onSelect: (address: string) => void};
type Node = {address: string; type: string; position: [number, number, number]; volume: number};
type Flow = {id: string; curve: THREE.QuadraticBezierCurve3; amount: number; phase: number; large: boolean};

function hash(value: string) {
  let result = 0;
  for (const character of value) result = (result * 31 + character.charCodeAt(0)) | 0;
  return result;
}

function safeAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function Observatory({transfers, selected, onSelect}: Props) {
  const group = useRef<THREE.Group>(null);
  const nodeMesh = useRef<THREE.InstancedMesh>(null);
  const haloMesh = useRef<THREE.InstancedMesh>(null);
  const particleMesh = useRef<THREE.InstancedMesh>(null);
  const matrix = useMemo(() => new THREE.Object3D(), []);
  const point = useMemo(() => new THREE.Vector3(), []);

  const {nodes, flows} = useMemo(() => {
    const types = new Map<string, string>();
    const volumes = new Map<string, number>();
    for (const transfer of transfers) {
      const amount = safeAmount(transfer.value);
      types.set(transfer.from, transfer.fromType);
      types.set(transfer.to, transfer.toType);
      volumes.set(transfer.from, (volumes.get(transfer.from) ?? 0) + amount);
      volumes.set(transfer.to, (volumes.get(transfer.to) ?? 0) + amount);
    }

    const addresses = [...new Set(transfers.flatMap(transfer => [transfer.from, transfer.to]))].slice(-MAX_NODES);
    const nextNodes: Node[] = addresses.map((address, index) => {
      const seed = hash(address);
      const longitude = index * 2.399963;
      const latitude = Math.asin(-1 + (2 * (index + 0.5)) / Math.max(1, addresses.length));
      const radius = 2.15 + (Math.abs(seed) % 24) / 100;
      return {
        address,
        type: types.get(address) ?? "unknown",
        position: [
          Math.cos(latitude) * Math.cos(longitude) * radius,
          Math.sin(latitude) * radius,
          Math.cos(latitude) * Math.sin(longitude) * radius,
        ],
        volume: volumes.get(address) ?? 0,
      };
    });

    const positions = new Map(nextNodes.map(node => [node.address, node.position]));
    const amounts = transfers.slice(-MAX_FLOWS).map(transfer => safeAmount(transfer.value));
    const sorted = [...amounts].sort((left, right) => left - right);
    const largeThreshold = sorted[Math.max(0, Math.floor(sorted.length * 0.8))] ?? Infinity;
    const nextFlows: Flow[] = transfers.slice(-MAX_FLOWS).flatMap(transfer => {
      const from = positions.get(transfer.from);
      const to = positions.get(transfer.to);
      const amount = safeAmount(transfer.value);
      if (!from || !to || amount < 0) return [];
      const start = new THREE.Vector3(...from);
      const end = new THREE.Vector3(...to);
      const middle = start.clone().add(end).multiplyScalar(0.5).normalize().multiplyScalar(2.85);
      return [{
        id: transfer.id,
        curve: new THREE.QuadraticBezierCurve3(start, middle, end),
        amount,
        phase: ((hash(transfer.id) >>> 0) % 1000) / 1000,
        large: sorted.length >= 5 && amount >= largeThreshold,
      }];
    });
    return {nodes: nextNodes, flows: nextFlows};
  }, [transfers]);

  useEffect(() => {
    if (!nodeMesh.current || !haloMesh.current) return;
    nodes.forEach((node, index) => {
      const emphasis = Math.min(1, Math.log10(node.volume + 1) / 7);
      const selectedScale = selected === node.address ? 1.9 : 1;
      const scale = (0.75 + emphasis * 0.85) * selectedScale;
      matrix.position.set(...node.position);
      matrix.scale.setScalar(scale);
      matrix.updateMatrix();
      nodeMesh.current?.setMatrixAt(index, matrix.matrix);
      nodeMesh.current?.setColorAt(index, node.type === "contract" ? CONTRACT : BLUE);
      matrix.scale.setScalar(selected === node.address ? scale * 2.6 : emphasis > 0.55 ? scale * 1.8 : 0.001);
      matrix.updateMatrix();
      haloMesh.current?.setMatrixAt(index, matrix.matrix);
      haloMesh.current?.setColorAt(index, selected === node.address ? GOLD : node.type === "contract" ? CONTRACT : BLUE);
    });
    nodeMesh.current.instanceMatrix.needsUpdate = true;
    if (nodeMesh.current.instanceColor) nodeMesh.current.instanceColor.needsUpdate = true;
    haloMesh.current.instanceMatrix.needsUpdate = true;
    if (haloMesh.current.instanceColor) haloMesh.current.instanceColor.needsUpdate = true;
  }, [nodes, selected, matrix]);

  useFrame(({clock}, delta) => {
    if (group.current) group.current.rotation.y += Math.min(delta, 0.05) * 0.012;
    if (!particleMesh.current) return;
    const elapsed = clock.getElapsedTime();
    flows.forEach((flow, index) => {
      const speed = 0.055 + Math.min(0.08, Math.log10(flow.amount + 1) * 0.008);
      flow.curve.getPointAt((flow.phase + elapsed * speed) % 1, point);
      matrix.position.copy(point);
      matrix.scale.setScalar(flow.large ? 1.45 : 0.8);
      matrix.updateMatrix();
      particleMesh.current?.setMatrixAt(index, matrix.matrix);
      particleMesh.current?.setColorAt(index, flow.large ? GOLD : BLUE);
    });
    particleMesh.current.instanceMatrix.needsUpdate = true;
    if (particleMesh.current.instanceColor) particleMesh.current.instanceColor.needsUpdate = true;
  });

  function selectNode(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    if (event.instanceId !== undefined) {
      const node = nodes[event.instanceId];
      if (node) onSelect(node.address);
    }
  }

  return <group ref={group}>
    <ambientLight intensity={0.2}/>
    <pointLight position={[1.5, 3, 4]} intensity={22} color="#a6d9ff"/>
    <mesh>
      <icosahedronGeometry args={[2.08, 3]}/>
      <meshBasicMaterial color="#27648b" wireframe transparent opacity={0.055} depthWrite={false}/>
    </mesh>
    <mesh scale={1.02}>
      <sphereGeometry args={[2.08, 48, 24]}/>
      <meshBasicMaterial color="#071b2b" transparent opacity={0.14} depthWrite={false}/>
    </mesh>
    <Sparkles count={90} scale={[6.4, 5.2, 6.4]} size={0.38} speed={0.08} opacity={0.18}/>
    {flows.map(flow => <Line
      key={flow.id}
      points={flow.curve.getPoints(20)}
      color={flow.large ? "#c69252" : "#267db9"}
      transparent
      opacity={flow.large ? 0.52 : 0.24}
      lineWidth={flow.large ? 1.35 : 0.55}
    />)}
    <instancedMesh ref={particleMesh} args={[undefined, undefined, MAX_FLOWS]} count={flows.length}>
      <sphereGeometry args={[0.025, 8, 8]}/>
      <meshBasicMaterial toneMapped={false}/>
    </instancedMesh>
    <instancedMesh ref={haloMesh} args={[undefined, undefined, MAX_NODES]} count={nodes.length}>
      <sphereGeometry args={[0.08, 12, 12]}/>
      <meshBasicMaterial transparent opacity={0.1} depthWrite={false} toneMapped={false}/>
    </instancedMesh>
    <instancedMesh ref={nodeMesh} args={[undefined, undefined, MAX_NODES]} count={nodes.length} onClick={selectNode}>
      <sphereGeometry args={[0.055, 14, 14]}/>
      <meshStandardMaterial roughness={0.3} metalness={0.1} emissive="#184b70" emissiveIntensity={1.8}/>
    </instancedMesh>
  </group>;
}

export function NetworkScene(props: Props) {
  return <Canvas
    dpr={[1, 1.5]}
    camera={{position: [0, 0.15, 6.3], fov: 41}}
    gl={{antialias: true, powerPreference: "high-performance"}}
    fallback={<div className="sceneFallback">WebGL unavailable</div>}
    onPointerMissed={() => undefined}
  >
    <fog attach="fog" args={["#01040a", 5.2, 10]}/>
    <Observatory {...props}/>
    <OrbitControls enablePan={false} minDistance={4} maxDistance={8} dampingFactor={0.055} enableDamping rotateSpeed={0.35} zoomSpeed={0.45}/>
  </Canvas>;
}
