"use client";

import {Canvas, type ThreeEvent, useFrame} from "@react-three/fiber";
import {Line, OrbitControls, Sparkles} from "@react-three/drei";
import {useEffect, useMemo, useRef, useState} from "react";
import * as THREE from "three";
import type {Transfer} from "@/data/types";

const MAX_NODES = 84;
const MAX_FLOWS = 44;
const TRAIL_STEPS = 4;
const BLUE = new THREE.Color("#52b8ff");
const CONTRACT = new THREE.Color("#d8a55f");
const UNKNOWN = new THREE.Color("#718896");
const GOLD = new THREE.Color("#efbd76");

type Props = {transfers: Transfer[]; selected: string | null; onSelect: (address: string) => void};
type Node = {address: string; type: string; position: [number, number, number]; volume: number};
type Flow = {id: string; from: string; to: string; curve: THREE.QuadraticBezierCurve3; amount: number; phase: number; large: boolean};

function hash(value: string) {
  let result = 0;
  for (const character of value) result = (result * 31 + character.charCodeAt(0)) | 0;
  return result;
}

function safeAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function nodeColor(type: string) {
  return type === "contract" ? CONTRACT : type === "wallet" ? BLUE : UNKNOWN;
}

function Observatory({transfers, selected, onSelect, interacting}: Props & {interacting: React.MutableRefObject<boolean>}) {
  const group = useRef<THREE.Group>(null);
  const nodeMesh = useRef<THREE.InstancedMesh>(null);
  const haloMesh = useRef<THREE.InstancedMesh>(null);
  const pulseMesh = useRef<THREE.InstancedMesh>(null);
  const trailMesh = useRef<THREE.InstancedMesh>(null);
  const selectionRing = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState<number | null>(null);
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
        position: [Math.cos(latitude) * Math.cos(longitude) * radius, Math.sin(latitude) * radius, Math.cos(latitude) * Math.sin(longitude) * radius],
        volume: volumes.get(address) ?? 0,
      };
    });

    const positions = new Map(nextNodes.map(node => [node.address, node.position]));
    const recent = transfers.slice(-MAX_FLOWS);
    const amounts = recent.map(transfer => safeAmount(transfer.value)).sort((a, b) => a - b);
    const largeThreshold = amounts[Math.max(0, Math.floor(amounts.length * 0.8))] ?? Infinity;
    const nextFlows: Flow[] = recent.flatMap(transfer => {
      const from = positions.get(transfer.from);
      const to = positions.get(transfer.to);
      const amount = safeAmount(transfer.value);
      if (!from || !to) return [];
      const start = new THREE.Vector3(...from);
      const end = new THREE.Vector3(...to);
      const midpoint = start.clone().add(end).multiplyScalar(0.5);
      const middle = midpoint.lengthSq() > 0.001 ? midpoint.normalize().multiplyScalar(2.9) : start.clone().cross(new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(2.9);
      return [{id: transfer.id, from: transfer.from, to: transfer.to, curve: new THREE.QuadraticBezierCurve3(start, middle, end), amount, phase: ((hash(transfer.id) >>> 0) % 1000) / 1000, large: amounts.length >= 5 && amount >= largeThreshold}];
    });
    return {nodes: nextNodes, flows: nextFlows};
  }, [transfers]);

  useEffect(() => {
    if (!nodeMesh.current || !haloMesh.current) return;
    nodes.forEach((node, index) => {
      const activity = Math.min(1, Math.log10(node.volume + 1) / 6);
      const focused = selected === node.address;
      const unrelated = Boolean(selected && !flows.some(flow => (flow.from === selected || flow.to === selected) && (flow.from === node.address || flow.to === node.address)));
      const hoverScale = hovered === index ? 1.24 : 1;
      const scale = (0.72 + activity * 0.75) * (focused ? 1.55 : 1) * hoverScale;
      matrix.position.set(...node.position);
      matrix.scale.setScalar(scale);
      matrix.updateMatrix();
      nodeMesh.current!.setMatrixAt(index, matrix.matrix);
      nodeMesh.current!.setColorAt(index, unrelated ? nodeColor(node.type).clone().multiplyScalar(0.35) : nodeColor(node.type));
      matrix.scale.setScalar((focused ? 2.8 : 1.45 + activity) * scale);
      matrix.updateMatrix();
      haloMesh.current!.setMatrixAt(index, matrix.matrix);
      haloMesh.current!.setColorAt(index, focused ? GOLD : unrelated ? nodeColor(node.type).clone().multiplyScalar(0.22) : nodeColor(node.type));
    });
    nodeMesh.current.instanceMatrix.needsUpdate = true;
    if (nodeMesh.current.instanceColor) nodeMesh.current.instanceColor.needsUpdate = true;
    haloMesh.current.instanceMatrix.needsUpdate = true;
    if (haloMesh.current.instanceColor) haloMesh.current.instanceColor.needsUpdate = true;
    const selectedNode = nodes.find(node => node.address === selected);
    if (selectionRing.current) selectionRing.current.visible = Boolean(selectedNode);
    if (selectedNode && selectionRing.current) selectionRing.current.position.set(...selectedNode.position);
  }, [nodes, flows, selected, hovered, matrix]);

  useEffect(() => {
    document.body.style.cursor = hovered === null ? "" : "pointer";
    return () => { document.body.style.cursor = ""; };
  }, [hovered]);

  useFrame(({clock, camera}, delta) => {
    if (group.current && !interacting.current) group.current.rotation.y += Math.min(delta, 0.05) * 0.007;
    const elapsed = clock.getElapsedTime();
    if (selectionRing.current) {
      const scale = 1 + Math.sin(elapsed * 2.2) * 0.08;
      selectionRing.current.scale.setScalar(scale);
      selectionRing.current.lookAt(camera.position);
    }
    if (!pulseMesh.current || !trailMesh.current) return;
    flows.forEach((flow, index) => {
      const speed = 0.045 + Math.min(0.055, Math.log10(flow.amount + 1) * 0.006);
      const progress = (flow.phase + elapsed * speed) % 1;
      flow.curve.getPointAt(progress, point);
      matrix.position.copy(point);
      matrix.scale.setScalar(flow.large ? 1.35 : 0.86);
      matrix.updateMatrix();
      pulseMesh.current!.setMatrixAt(index, matrix.matrix);
      pulseMesh.current!.setColorAt(index, flow.large ? GOLD : BLUE);
      for (let step = 0; step < TRAIL_STEPS; step++) {
        flow.curve.getPointAt((progress - (step + 1) * 0.012 + 1) % 1, point);
        matrix.position.copy(point);
        matrix.scale.setScalar((flow.large ? 1 : 0.62) * (1 - step / (TRAIL_STEPS + 1)));
        matrix.updateMatrix();
        const trailIndex = index * TRAIL_STEPS + step;
        trailMesh.current!.setMatrixAt(trailIndex, matrix.matrix);
        trailMesh.current!.setColorAt(trailIndex, flow.large ? GOLD : BLUE);
      }
    });
    pulseMesh.current.instanceMatrix.needsUpdate = true;
    trailMesh.current.instanceMatrix.needsUpdate = true;
    if (pulseMesh.current.instanceColor) pulseMesh.current.instanceColor.needsUpdate = true;
    if (trailMesh.current.instanceColor) trailMesh.current.instanceColor.needsUpdate = true;
  });

  const related = (flow: Flow) => !selected || flow.from === selected || flow.to === selected;
  return <group ref={group}>
    <ambientLight intensity={0.22}/><pointLight position={[1.5, 3, 4]} intensity={20} color="#a6d9ff"/>
    <mesh><icosahedronGeometry args={[2.1, 4]}/><meshBasicMaterial color="#367aa2" wireframe transparent opacity={0.065} depthWrite={false}/></mesh>
    <mesh scale={1.055}><sphereGeometry args={[2.1, 48, 32]}/><meshBasicMaterial color="#0a4469" transparent opacity={0.055} side={THREE.BackSide} depthWrite={false}/></mesh>
    <mesh scale={1.22}><sphereGeometry args={[2.1, 48, 32]}/><meshBasicMaterial color="#167bb7" transparent opacity={0.025} side={THREE.BackSide} depthWrite={false}/></mesh>
    <Sparkles count={110} scale={[7.8, 6.5, 7.2]} size={0.36} speed={0.055} opacity={0.2}/>
    <Sparkles count={42} scale={[4.4, 4.4, 4.4]} size={0.6} speed={0.035} opacity={0.15}/>
    {flows.map(flow => <Line key={flow.id} points={flow.curve.getPoints(24)} color={flow.large ? "#c89859" : "#2b85bc"} transparent opacity={related(flow) ? (selected ? 0.66 : flow.large ? 0.42 : 0.2) : 0.045} lineWidth={related(flow) && selected ? 1.15 : flow.large ? 0.9 : 0.45}/>) }
    <instancedMesh ref={trailMesh} args={[undefined, undefined, MAX_FLOWS * TRAIL_STEPS]} count={flows.length * TRAIL_STEPS}><sphereGeometry args={[0.018, 6, 6]}/><meshBasicMaterial transparent opacity={0.32} depthWrite={false} toneMapped={false}/></instancedMesh>
    <instancedMesh ref={pulseMesh} args={[undefined, undefined, MAX_FLOWS]} count={flows.length}><sphereGeometry args={[0.028, 8, 8]}/><meshBasicMaterial toneMapped={false}/></instancedMesh>
    <instancedMesh ref={haloMesh} args={[undefined, undefined, MAX_NODES]} count={nodes.length}><sphereGeometry args={[0.09, 10, 10]}/><meshBasicMaterial transparent opacity={0.11} depthWrite={false} toneMapped={false}/></instancedMesh>
    <instancedMesh ref={nodeMesh} args={[undefined, undefined, MAX_NODES]} count={nodes.length} onClick={event => {event.stopPropagation(); if (event.instanceId !== undefined && nodes[event.instanceId]) onSelect(nodes[event.instanceId].address);}} onPointerMove={(event: ThreeEvent<PointerEvent>) => {event.stopPropagation(); setHovered(event.instanceId ?? null);}} onPointerOut={() => setHovered(null)}>
      <sphereGeometry args={[0.055, 12, 12]}/><meshStandardMaterial roughness={0.28} metalness={0.08} emissive="#194c6d" emissiveIntensity={1.7}/>
    </instancedMesh>
    <mesh ref={selectionRing} visible={false}><ringGeometry args={[0.12, 0.145, 32]}/><meshBasicMaterial color="#dff5ff" transparent opacity={0.82} side={THREE.DoubleSide} depthWrite={false}/></mesh>
  </group>;
}

export function NetworkScene(props: Props) {
  const interacting = useRef(false);
  return <Canvas dpr={[1, 1.5]} camera={{position: [0, 0.12, 5.7], fov: 40}} gl={{antialias: true, powerPreference: "high-performance"}} fallback={<div className="sceneFallback">WebGL unavailable</div>}>
    <color attach="background" args={["#01040a"]}/><fog attach="fog" args={["#01040a", 5, 9.5]}/>
    <Observatory {...props} interacting={interacting}/>
    <OrbitControls enablePan={false} minDistance={4.15} maxDistance={7.5} dampingFactor={0.055} enableDamping rotateSpeed={0.32} zoomSpeed={0.42} onStart={() => {interacting.current = true;}} onEnd={() => {window.setTimeout(() => {interacting.current = false;}, 1800);}}/>
  </Canvas>;
}
