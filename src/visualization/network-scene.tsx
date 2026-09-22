"use client";

import {Canvas, type ThreeEvent, useFrame, useThree} from "@react-three/fiber";
import {Html, Line, OrbitControls, Sparkles} from "@react-three/drei";
import {useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject} from "react";
import * as THREE from "three";
import type {Transfer} from "@/data/types";
import type {VisualizationIntent} from "@/intelligence/intents";
import {addressPosition, shortTransactionHash, significantTransferIds, stableHash, transferIdentity, uniqueTransfers} from "./network-model";

const MAX_NODES = 84;
const MAX_FLOWS = 44;
const TRAIL_STEPS = 4;
const BLUE = new THREE.Color("#52b8ff");
const CONTRACT = new THREE.Color("#d8a55f");
const UNKNOWN = new THREE.Color("#718896");
const GOLD = new THREE.Color("#efbd76");

type Props = {
  transfers: Transfer[];
  selectedAddress: string | null;
  selectedTransferId: string | null;
  intent: VisualizationIntent;
  onSelectAddress: (address: string) => void;
  onSelectTransfer: (id: string | null) => void;
};
type Node = {address: string; type: string; position: readonly [number, number, number]; volume: number; count: number};
type Flow = {id: string; transfer: Transfer; from: string; to: string; curve: THREE.QuadraticBezierCurve3; amount: number; phase: number; significant: boolean; color: THREE.Color};

function safeAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}
function nodeColor(type: string) { return type === "contract" ? CONTRACT : type === "wallet" ? BLUE : UNKNOWN; }
function flowColor(transfer: Transfer) { return transfer.fromType === "contract" || transfer.toType === "contract" ? CONTRACT : transfer.fromType === "unknown" || transfer.toType === "unknown" ? UNKNOWN : BLUE; }

function Observatory(props: Props & {interacting: MutableRefObject<boolean>; lastInteraction: MutableRefObject<number>}) {
  const {transfers, selectedAddress, selectedTransferId, intent, onSelectAddress, onSelectTransfer, interacting, lastInteraction} = props;
  const group = useRef<THREE.Group>(null);
  const nodeMesh = useRef<THREE.InstancedMesh>(null);
  const haloMesh = useRef<THREE.InstancedMesh>(null);
  const pulseMesh = useRef<THREE.InstancedMesh>(null);
  const trailMesh = useRef<THREE.InstancedMesh>(null);
  const impactMesh = useRef<THREE.InstancedMesh>(null);
  const [hoveredNode, setHoveredNode] = useState<number | null>(null);
  const [hoveredFlow, setHoveredFlow] = useState<string | null>(null);
  const matrix = useMemo(() => new THREE.Object3D(), []);
  const point = useMemo(() => new THREE.Vector3(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const {size} = useThree();
  const compact = size.width < 760;
  const tablet = size.width < 1050;

  const {nodes, flows} = useMemo(() => {
    const verified = uniqueTransfers(transfers);
    const types = new Map<string, string>();
    const volumes = new Map<string, number>();
    const counts = new Map<string, number>();
    for (const transfer of verified) {
      const amount = safeAmount(transfer.value);
      types.set(transfer.from, transfer.fromType); types.set(transfer.to, transfer.toType);
      volumes.set(transfer.from, (volumes.get(transfer.from) ?? 0) + amount); volumes.set(transfer.to, (volumes.get(transfer.to) ?? 0) + amount);
      counts.set(transfer.from, (counts.get(transfer.from) ?? 0) + 1); counts.set(transfer.to, (counts.get(transfer.to) ?? 0) + 1);
    }
    const nodeLimit = compact ? 56 : MAX_NODES;
    const flowLimit = compact ? 24 : tablet ? 34 : MAX_FLOWS;
    const recent = verified.slice(-flowLimit);
    // Prefer addresses participating in visible flows, then fill from the window.
    const orderedAddresses = [...new Set([...recent.flatMap(item => [item.from, item.to]), ...verified.flatMap(item => [item.from, item.to])])].slice(0, nodeLimit);
    const nextNodes: Node[] = orderedAddresses.map(address => ({address, type: types.get(address) ?? "unknown", position: addressPosition(address), volume: volumes.get(address) ?? 0, count: counts.get(address) ?? 0}));
    const visible = new Set(orderedAddresses);
    const significant = new Set(significantTransferIds(recent, compact ? 1 : tablet ? 3 : 5));
    const nextFlows: Flow[] = recent.flatMap(transfer => {
      if (!visible.has(transfer.from) || !visible.has(transfer.to)) return [];
      const id = transferIdentity(transfer);
      const start = new THREE.Vector3(...addressPosition(transfer.from));
      const end = new THREE.Vector3(...addressPosition(transfer.to));
      const midpoint = start.clone().add(end).multiplyScalar(0.5);
      const normal = start.clone().cross(end);
      if (normal.lengthSq() < 0.001) normal.set(0, 1, 0).cross(start);
      normal.normalize().multiplyScalar(((stableHash(id) % 200) / 100 - 1) * 0.58);
      const lift = 3.05 + (stableHash(`${id}:arc`) % 48) / 100;
      const middle = (midpoint.lengthSq() > 0.001 ? midpoint.normalize() : start.clone().normalize()).multiplyScalar(lift).add(normal);
      return [{id, transfer, from: transfer.from, to: transfer.to, curve: new THREE.QuadraticBezierCurve3(start, middle, end), amount: safeAmount(transfer.value), phase: (stableHash(id) % 1000) / 1000, significant: significant.has(id), color: flowColor(transfer)}];
    });
    return {nodes: nextNodes, flows: nextFlows};
  }, [transfers, compact, tablet]);

  const intentFlowIds = useMemo(() => new Set(intent.type === "highlight-transfers" ? intent.transferIds : []), [intent]);
  const intentAddresses = useMemo(() => new Set(intent.type === "highlight-addresses" ? intent.addresses : intent.type === "focus-address-activity" ? [intent.address] : []), [intent]);
  const flowFocused = useCallback((flow: Flow) => intent.type === "reset" || (intent.type === "highlight-transfers" && (intentFlowIds.has(flow.transfer.id) || intentFlowIds.has(flow.id))) || (intent.type !== "highlight-transfers" && (intentAddresses.has(flow.from) || intentAddresses.has(flow.to))), [intent, intentAddresses, intentFlowIds]);
  const isFlowRelated = useCallback((flow: Flow) => (!selectedAddress || flow.from === selectedAddress || flow.to === selectedAddress) && (!selectedTransferId || flow.id === selectedTransferId) && flowFocused(flow), [flowFocused, selectedAddress, selectedTransferId]);

  useEffect(() => {
    if (!nodeMesh.current || !haloMesh.current) return;
    nodes.forEach((node, index) => {
      const activity = Math.min(1, Math.log10(node.volume + node.count + 1) / 6);
      const endpoint = selectedTransferId && flows.some(flow => flow.id === selectedTransferId && (flow.from === node.address || flow.to === node.address));
      const focused = selectedAddress === node.address || endpoint;
      const unrelated = Boolean((selectedAddress && !flows.some(flow => (flow.from === selectedAddress || flow.to === selectedAddress) && (flow.from === node.address || flow.to === node.address))) || (selectedTransferId && !endpoint));
      const scale = (0.72 + activity * 0.7) * (focused ? 1.5 : 1) * (hoveredNode === index ? 1.22 : 1);
      matrix.position.set(...node.position); matrix.scale.setScalar(scale); matrix.updateMatrix();
      nodeMesh.current!.setMatrixAt(index, matrix.matrix); nodeMesh.current!.setColorAt(index, color.copy(nodeColor(node.type)).multiplyScalar(unrelated ? 0.26 : 1));
      matrix.scale.setScalar((focused ? 2.65 : 1.4 + activity) * scale); matrix.updateMatrix();
      haloMesh.current!.setMatrixAt(index, matrix.matrix); haloMesh.current!.setColorAt(index, focused ? GOLD : color.copy(nodeColor(node.type)).multiplyScalar(unrelated ? 0.2 : 1));
    });
    nodeMesh.current.instanceMatrix.needsUpdate = haloMesh.current.instanceMatrix.needsUpdate = true;
    if (nodeMesh.current.instanceColor) nodeMesh.current.instanceColor.needsUpdate = true;
    if (haloMesh.current.instanceColor) haloMesh.current.instanceColor.needsUpdate = true;
  }, [nodes, flows, selectedAddress, selectedTransferId, hoveredNode, matrix, color]);

  useEffect(() => { document.body.style.cursor = hoveredNode === null && hoveredFlow === null ? "" : "pointer"; return () => { document.body.style.cursor = ""; }; }, [hoveredNode, hoveredFlow]);

  useFrame(({clock, camera}, delta) => {
    const idleFor = performance.now() - lastInteraction.current;
    if (group.current && !interacting.current && idleFor > 10_000) group.current.rotation.y += Math.min(delta, 0.05) * 0.004;
    const elapsed = clock.getElapsedTime();
    if (!pulseMesh.current || !trailMesh.current || !impactMesh.current) return;
    flows.forEach((flow, index) => {
      const progress = (flow.phase + elapsed * (0.042 + Math.min(0.05, Math.log10(flow.amount + 1) * 0.005))) % 1;
      const active = isFlowRelated(flow);
      flow.curve.getPointAt(progress, point); matrix.position.copy(point); matrix.scale.setScalar(flow.significant ? 1.3 : 0.88); matrix.updateMatrix();
      pulseMesh.current!.setMatrixAt(index, matrix.matrix); pulseMesh.current!.setColorAt(index, color.copy(flow.color).multiplyScalar(active ? 1 : 0.18));
      for (let step = 0; step < TRAIL_STEPS; step++) {
        flow.curve.getPointAt((progress - (step + 1) * 0.012 + 1) % 1, point); matrix.position.copy(point); matrix.scale.setScalar((flow.significant ? 1 : 0.62) * (1 - step / (TRAIL_STEPS + 1))); matrix.updateMatrix();
        const trailIndex = index * TRAIL_STEPS + step; trailMesh.current!.setMatrixAt(trailIndex, matrix.matrix); trailMesh.current!.setColorAt(trailIndex, color.copy(flow.color).multiplyScalar(active ? 1 : 0.15));
      }
      flow.curve.getPointAt(1, point); matrix.position.copy(point);
      const arrival = progress > 0.91 ? Math.sin(((progress - 0.91) / 0.09) * Math.PI) : 0; matrix.scale.setScalar(0.001 + arrival * (flow.significant ? 1.45 : 1)); matrix.lookAt(camera.position); matrix.updateMatrix();
      impactMesh.current!.setMatrixAt(index, matrix.matrix); impactMesh.current!.setColorAt(index, color.copy(flow.color).multiplyScalar(active ? 1 : 0.12));
    });
    pulseMesh.current.instanceMatrix.needsUpdate = trailMesh.current.instanceMatrix.needsUpdate = impactMesh.current.instanceMatrix.needsUpdate = true;
    if (pulseMesh.current.instanceColor) pulseMesh.current.instanceColor.needsUpdate = true;
    if (trailMesh.current.instanceColor) trailMesh.current.instanceColor.needsUpdate = true;
    if (impactMesh.current.instanceColor) impactMesh.current.instanceColor.needsUpdate = true;
  });

  const labelled = flows.filter(flow => flow.id === selectedTransferId || flow.id === hoveredFlow || flow.significant)
    .sort((left, right) => Number(right.id === selectedTransferId) - Number(left.id === selectedTransferId) || Number(right.id === hoveredFlow) - Number(left.id === hoveredFlow) || right.amount - left.amount)
    .slice(0, compact ? 2 : tablet ? 3 : 5);
  return <group ref={group}>
    <ambientLight intensity={0.22}/><pointLight position={[1.5, 3, 4]} intensity={20} color="#a6d9ff"/>
    <mesh><icosahedronGeometry args={[2.34, 4]}/><meshBasicMaterial color="#428ab3" wireframe transparent opacity={0.065} depthWrite={false}/></mesh>
    <mesh scale={1.055}><sphereGeometry args={[2.34, 48, 32]}/><meshBasicMaterial color="#0a4c73" transparent opacity={0.055} side={THREE.BackSide} depthWrite={false}/></mesh>
    <Sparkles count={compact ? 42 : 100} scale={[8, 6.8, 7.8]} size={0.38} speed={0.035} opacity={0.16}/>
    {flows.map((flow, index) => <Line key={flow.id} points={flow.curve.getPoints(28)} color={`#${flow.color.getHexString()}`} transparent opacity={isFlowRelated(flow) ? (selectedTransferId === flow.id ? 0.9 : flow.significant ? 0.44 : Math.max(0.1, 0.28 - index / flows.length * 0.14)) : 0.035} lineWidth={selectedTransferId === flow.id ? 1.8 : flow.significant ? 0.9 : 0.45} onPointerOver={(event: ThreeEvent<PointerEvent>) => {event.stopPropagation(); setHoveredFlow(flow.id);}} onPointerOut={() => setHoveredFlow(null)} onClick={(event: ThreeEvent<MouseEvent>) => {event.stopPropagation(); onSelectTransfer(flow.id);}}/>) }
    {labelled.map(flow => <TransferLabel key={flow.id} flow={flow} selected={flow.id === selectedTransferId}/>) }
    <instancedMesh ref={trailMesh} args={[undefined, undefined, MAX_FLOWS * TRAIL_STEPS]} count={flows.length * TRAIL_STEPS}><sphereGeometry args={[0.018, 6, 6]}/><meshBasicMaterial transparent opacity={0.34} depthWrite={false} toneMapped={false}/></instancedMesh>
    <instancedMesh ref={pulseMesh} args={[undefined, undefined, MAX_FLOWS]} count={flows.length} onPointerOver={event => {event.stopPropagation(); const flow = flows[event.instanceId ?? -1]; if (flow) setHoveredFlow(flow.id);}} onPointerOut={() => setHoveredFlow(null)} onClick={event => {event.stopPropagation(); const flow = flows[event.instanceId ?? -1]; if (flow) onSelectTransfer(flow.id);}}><sphereGeometry args={[0.03, 8, 8]}/><meshBasicMaterial toneMapped={false}/></instancedMesh>
    <instancedMesh ref={impactMesh} args={[undefined, undefined, MAX_FLOWS]} count={flows.length}><ringGeometry args={[0.04, 0.065, 16]}/><meshBasicMaterial transparent opacity={0.25} side={THREE.DoubleSide} depthWrite={false} toneMapped={false}/></instancedMesh>
    <instancedMesh ref={haloMesh} args={[undefined, undefined, MAX_NODES]} count={nodes.length}><sphereGeometry args={[0.09, 10, 10]}/><meshBasicMaterial transparent opacity={0.11} depthWrite={false} toneMapped={false}/></instancedMesh>
    <instancedMesh ref={nodeMesh} args={[undefined, undefined, MAX_NODES]} count={nodes.length} onClick={event => {event.stopPropagation(); if (event.instanceId !== undefined && nodes[event.instanceId]) onSelectAddress(nodes[event.instanceId].address);}} onPointerMove={(event: ThreeEvent<PointerEvent>) => {event.stopPropagation(); setHoveredNode(event.instanceId ?? null);}} onPointerOut={() => setHoveredNode(null)}>
      <sphereGeometry args={[0.055, 12, 12]}/><meshStandardMaterial roughness={0.28} metalness={0.08} emissive="#194c6d" emissiveIntensity={1.7}/>
    </instancedMesh>
  </group>;
}

function TransferLabel({flow, selected}: {flow: Flow; selected: boolean}) {
  const anchor = useRef<THREE.Group>(null);
  useFrame(({clock}) => {
    if (!anchor.current) return;
    const speed = 0.042 + Math.min(0.05, Math.log10(flow.amount + 1) * 0.005);
    anchor.current.position.copy(flow.curve.getPointAt((flow.phase + clock.getElapsedTime() * speed) % 1));
  });
  return <group ref={anchor}><Html center distanceFactor={7} zIndexRange={[10, 0]} style={{pointerEvents: "none"}}><div className={`txLabel ${selected ? "selected" : ""}`}><code>{shortTransactionHash(flow.transfer.txHash)}</code><strong>{flow.amount.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})} USDC</strong>{selected && <span>{flow.transfer.fromType.toUpperCase()} → {flow.transfer.toType.toUpperCase()}</span>}</div></Html></group>;
}

export function NetworkScene(props: Props) {
  const interacting = useRef(false);
  const lastInteraction = useRef(Number.NEGATIVE_INFINITY);
  const interactionTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => { if (interactionTimer.current) clearTimeout(interactionTimer.current); }, []);
  return <Canvas dpr={[1, 1.5]} camera={{position: [0, 0.12, 5.55], fov: 40}} gl={{antialias: true, powerPreference: "high-performance"}} fallback={<div className="sceneFallback">WebGL unavailable</div>} onPointerMissed={() => props.onSelectTransfer(null)}>
    <color attach="background" args={["#01040a"]}/><fog attach="fog" args={["#01040a", 5, 9.5]}/>
    <Observatory {...props} interacting={interacting} lastInteraction={lastInteraction}/>
    <OrbitControls makeDefault enablePan={false} minDistance={4.15} maxDistance={7.5} dampingFactor={0.055} enableDamping rotateSpeed={0.32} zoomSpeed={0.42} onStart={() => {if (interactionTimer.current) clearTimeout(interactionTimer.current); interacting.current = true; lastInteraction.current = performance.now();}} onChange={() => {lastInteraction.current = performance.now();}} onEnd={() => {lastInteraction.current = performance.now(); interactionTimer.current = setTimeout(() => {interacting.current = false;}, 10_000);}}/>
  </Canvas>;
}
