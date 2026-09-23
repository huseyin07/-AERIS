"use client";

import {Canvas, type ThreeEvent, useFrame, useThree} from "@react-three/fiber";
import {Html, Line, OrbitControls, Sparkles} from "@react-three/drei";
import {memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject} from "react";
import * as THREE from "three";
import type {Transfer} from "@/data/types";
import type {VisualizationIntent} from "@/intelligence/intents";
import {addressPosition, reconcileIdentityOrder, selectLabelCandidates, shortTransactionHash, significantTransferIds, stableHash, transferIdentity, uniqueTransfers} from "./network-model";

const MAX_NODES = 84;
const MAX_FLOWS = 44;
const TRAIL_STEPS = 6;
const BLUE = new THREE.Color("#52b8ff");
const CONTRACT = new THREE.Color("#d8a55f");
const UNKNOWN = new THREE.Color("#718896");
const GOLD = new THREE.Color("#efbd76");

type IntelligenceAnnotation = {address: string; label: string};

type Props = {
  transfers: Transfer[];
  annotations?: IntelligenceAnnotation[];
  selectedAddress: string | null;
  selectedTransferId: string | null;
  intent: VisualizationIntent;
  onSelectAddress: (address: string) => void;
  onSelectTransfer: (id: string | null) => void;
};
type Node = {address: string; type: string; position: readonly [number, number, number]; volume: number; count: number};
type Flow = {id: string; transfer: Transfer; from: string; to: string; curve: THREE.QuadraticBezierCurve3; points: THREE.Vector3[]; amount: number; strength: number; phase: number; significant: boolean; recency: number; color: THREE.Color; enteredAt: number};
type LabelRect = {left: number; right: number; top: number; bottom: number};

function safeAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}
function nodeColor(type: string) { return type === "contract" ? CONTRACT : type === "wallet" ? BLUE : UNKNOWN; }
function flowColor(transfer: Transfer) { return transfer.fromType === "contract" || transfer.toType === "contract" ? CONTRACT : transfer.fromType === "unknown" || transfer.toType === "unknown" ? UNKNOWN : BLUE; }

function Observatory(props: Props & {interacting: MutableRefObject<boolean>; lastInteraction: MutableRefObject<number>}) {
  const {transfers, annotations = [], selectedAddress, selectedTransferId, intent, onSelectAddress, onSelectTransfer, interacting, lastInteraction} = props;
  const group = useRef<THREE.Group>(null);
  const nodeMesh = useRef<THREE.InstancedMesh>(null);
  const haloMesh = useRef<THREE.InstancedMesh>(null);
  const pulseMesh = useRef<THREE.InstancedMesh>(null);
  const pulseHaloMesh = useRef<THREE.InstancedMesh>(null);
  const trailMesh = useRef<THREE.InstancedMesh>(null);
  const impactMesh = useRef<THREE.InstancedMesh>(null);
  const arrivalHaloMesh = useRef<THREE.InstancedMesh>(null);
  const previousProgress = useRef(new Map<string, number>());
  const completedArrivals = useRef(new Set<string>());
  const arrivalStarted = useRef(new Map<string, number>());
  const labelRects = useRef<LabelRect[]>([]);
  const [hoveredNode, setHoveredNode] = useState<number | null>(null);
  const [hoveredFlow, setHoveredFlow] = useState<string | null>(null);
  const matrix = useMemo(() => new THREE.Object3D(), []);
  const point = useMemo(() => new THREE.Vector3(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const {size} = useThree();
  const compact = size.width < 760;
  const tablet = size.width < 1050;
  const [reducedMotion, setReducedMotion] = useState(false);
  const nodeOrder = useRef<string[]>([]);
  const flowOrder = useRef<string[]>([]);
  const flowResources = useRef(new Map<string, Pick<Flow, "curve" | "points" | "phase" | "color" | "enteredAt">>());

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const {nodes, flows} = useMemo(() => {
    const verified = uniqueTransfers(transfers);
    const types = new Map<string, string>();
    const volumes = new Map<string, number>();
    const counts = new Map<string, number>();
    for (const transfer of verified) {
      const amount = safeAmount(transfer.value);
      const from = transfer.from.toLowerCase(); const to = transfer.to.toLowerCase();
      types.set(from, transfer.fromType); types.set(to, transfer.toType);
      volumes.set(from, (volumes.get(from) ?? 0) + amount); volumes.set(to, (volumes.get(to) ?? 0) + amount);
      counts.set(from, (counts.get(from) ?? 0) + 1); counts.set(to, (counts.get(to) ?? 0) + 1);
    }
    const nodeLimit = compact ? 56 : MAX_NODES;
    const flowLimit = compact ? 24 : tablet ? 34 : MAX_FLOWS;
    const recent = verified.slice(-flowLimit);
    // Prefer addresses participating in visible flows, then fill from the window.
    const candidateAddresses = [...new Set([...recent.flatMap(item => [item.from.toLowerCase(), item.to.toLowerCase()]), ...verified.flatMap(item => [item.from.toLowerCase(), item.to.toLowerCase()])])].slice(0, nodeLimit);
    const orderedAddresses = reconcileIdentityOrder(nodeOrder.current, candidateAddresses);
    nodeOrder.current = orderedAddresses;
    const nextNodes: Node[] = orderedAddresses.map(address => ({address, type: types.get(address) ?? "unknown", position: addressPosition(address), volume: volumes.get(address) ?? 0, count: counts.get(address) ?? 0}));
    const visible = new Set(orderedAddresses);
    const significant = new Set(significantTransferIds(recent, compact ? 1 : tablet ? 3 : 5));
    const byId = new Map(recent.map((transfer, index) => [transferIdentity(transfer), {transfer, index}]));
    const orderedFlowIds = reconcileIdentityOrder(flowOrder.current, [...byId.keys()]);
    flowOrder.current = orderedFlowIds;
    const nextFlows: Flow[] = orderedFlowIds.flatMap(id => {
      const entry = byId.get(id);
      if (!entry) return [];
      const {transfer, index} = entry;
      const from = transfer.from.toLowerCase(); const to = transfer.to.toLowerCase();
      if (!visible.has(from) || !visible.has(to)) return [];
      let resource = flowResources.current.get(id);
      if (!resource) {
        const start = new THREE.Vector3(...addressPosition(from));
        const end = new THREE.Vector3(...addressPosition(to));
        const midpoint = start.clone().add(end).multiplyScalar(0.5);
        const normal = start.clone().cross(end);
        if (normal.lengthSq() < 0.001) normal.set(0, 1, 0).cross(start);
        normal.normalize().multiplyScalar(((stableHash(id) % 200) / 100 - 1) * 0.58);
        const lift = 3.05 + (stableHash(`${id}:arc`) % 48) / 100;
        const middle = (midpoint.lengthSq() > 0.001 ? midpoint.normalize() : start.clone().normalize()).multiplyScalar(lift).add(normal);
        const curve = new THREE.QuadraticBezierCurve3(start, middle, end);
        resource = {curve, points: curve.getPoints(28), phase: (stableHash(id) % 1000) / 1000, color: flowColor(transfer).clone(), enteredAt: performance.now()};
        flowResources.current.set(id, resource);
      }
      const amount = safeAmount(transfer.value);
      return [{id, transfer, from, to, ...resource, amount, strength: THREE.MathUtils.clamp(Math.log10(amount + 1) / 6, 0, 1), significant: significant.has(id), recency: (index + 1) / recent.length}];
    });
    const activeIds = new Set(orderedFlowIds);
    for (const id of flowResources.current.keys()) if (!activeIds.has(id)) flowResources.current.delete(id);
    return {nodes: nextNodes, flows: nextFlows};
  }, [transfers, compact, tablet]);

  const intentFlowIds = useMemo(() => new Set(intent.type === "highlight-transfers" ? intent.transferIds : []), [intent]);
  const intentAddresses = useMemo(() => new Set(intent.type === "highlight-addresses" ? intent.addresses : intent.type === "focus-address-activity" ? [intent.address] : []), [intent]);
  const flowFocused = useCallback((flow: Flow) => intent.type === "reset" || (intent.type === "highlight-transfers" && (intentFlowIds.has(flow.transfer.id) || intentFlowIds.has(flow.id))) || (intent.type !== "highlight-transfers" && (intentAddresses.has(flow.from) || intentAddresses.has(flow.to))), [intent, intentAddresses, intentFlowIds]);
  const isFlowRelated = useCallback((flow: Flow) => (!selectedAddress || flow.from === selectedAddress || flow.to === selectedAddress) && (!selectedTransferId || flow.id === selectedTransferId) && flowFocused(flow), [flowFocused, selectedAddress, selectedTransferId]);
  const inspectedFlowId = selectedTransferId ?? hoveredFlow;

  useEffect(() => {
    if (!nodeMesh.current || !haloMesh.current) return;
    nodes.forEach((node, index) => {
      const activity = Math.min(1, Math.log10(node.volume + node.count + 1) / 6);
      const endpoint = inspectedFlowId && flows.some(flow => flow.id === inspectedFlowId && (flow.from === node.address || flow.to === node.address));
      const focused = selectedAddress === node.address || endpoint;
      const unrelated = Boolean((selectedAddress && !flows.some(flow => (flow.from === selectedAddress || flow.to === selectedAddress) && (flow.from === node.address || flow.to === node.address))) || (inspectedFlowId && !endpoint));
      const depth = THREE.MathUtils.clamp((node.position[2] + 2.7) / 5.4, 0, 1);
      const scale = (0.72 + activity * 0.7) * (focused ? 1.5 : 1) * (hoveredNode === index ? 1.22 : 1);
      matrix.position.set(...node.position); matrix.scale.setScalar(scale); matrix.updateMatrix();
      nodeMesh.current!.setMatrixAt(index, matrix.matrix); nodeMesh.current!.setColorAt(index, color.copy(nodeColor(node.type)).multiplyScalar(unrelated ? 0.26 : 0.62 + depth * 0.38));
      matrix.scale.setScalar((focused ? 2.65 : 1.4 + activity) * scale); matrix.updateMatrix();
      haloMesh.current!.setMatrixAt(index, matrix.matrix); haloMesh.current!.setColorAt(index, focused ? GOLD : color.copy(nodeColor(node.type)).multiplyScalar(unrelated ? 0.2 : 1));
    });
    nodeMesh.current.instanceMatrix.needsUpdate = haloMesh.current.instanceMatrix.needsUpdate = true;
    if (nodeMesh.current.instanceColor) nodeMesh.current.instanceColor.needsUpdate = true;
    if (haloMesh.current.instanceColor) haloMesh.current.instanceColor.needsUpdate = true;
  }, [nodes, flows, selectedAddress, inspectedFlowId, hoveredNode, matrix, color]);

  useEffect(() => { document.body.style.cursor = hoveredNode === null && hoveredFlow === null ? "" : "pointer"; return () => { document.body.style.cursor = ""; }; }, [hoveredNode, hoveredFlow]);

  useFrame(({clock, camera}, delta) => {
    labelRects.current = [];
    const idleFor = performance.now() - lastInteraction.current;
    if (group.current && !reducedMotion && !interacting.current && idleFor > 10_000) group.current.rotation.y += Math.min(delta, 0.05) * 0.004;
    const elapsed = clock.getElapsedTime();
    if (!pulseMesh.current || !pulseHaloMesh.current || !trailMesh.current || !impactMesh.current || !arrivalHaloMesh.current) return;
    flows.forEach((flow, index) => {
      const progress = (flow.phase + elapsed * (0.042 + Math.min(0.05, Math.log10(flow.amount + 1) * 0.005))) % 1;
      const active = isFlowRelated(flow);
      const inspected = flow.id === inspectedFlowId;
      const introduction = reducedMotion ? 1 : THREE.MathUtils.smoothstep(performance.now() - flow.enteredAt, 0, 420);
      flow.curve.getPointAt(progress, point); matrix.position.copy(point); matrix.scale.setScalar((inspected ? 1.45 : flow.significant ? 1.18 : 0.82) * introduction); matrix.updateMatrix();
      pulseMesh.current!.setMatrixAt(index, matrix.matrix); pulseMesh.current!.setColorAt(index, color.copy(flow.color).multiplyScalar(active ? (inspected ? 1.25 : 1) : 0.18));
      matrix.scale.multiplyScalar(inspected ? 2.9 : flow.significant ? 2.5 : 2.1); matrix.updateMatrix();
      pulseHaloMesh.current!.setMatrixAt(index, matrix.matrix); pulseHaloMesh.current!.setColorAt(index, color.copy(flow.color).multiplyScalar(active ? (inspected ? 1 : 0.72) : 0.1));
      for (let step = 0; step < TRAIL_STEPS; step++) {
        const enabled = !reducedMotion || step < 2;
        const spacing = inspected || flow.significant ? 0.017 : 0.013;
        flow.curve.getPointAt((progress - (step + 1) * spacing + 1) % 1, point); matrix.position.copy(point); matrix.scale.setScalar(enabled ? (inspected ? 1.12 : flow.significant ? 0.92 : 0.66) * (1 - step / (TRAIL_STEPS + 1)) : 0.001); matrix.updateMatrix();
        const trailIndex = index * TRAIL_STEPS + step; trailMesh.current!.setMatrixAt(trailIndex, matrix.matrix); trailMesh.current!.setColorAt(trailIndex, color.copy(flow.color).multiplyScalar(active ? (inspected ? 1 : 0.82) : 0.12));
      }
      flow.curve.getPointAt(1, point); matrix.position.copy(point);
      const previous = previousProgress.current.get(flow.id); previousProgress.current.set(flow.id, progress);
      if (previous !== undefined && previous > 0.9 && progress < 0.1 && !completedArrivals.current.has(flow.id)) {
        completedArrivals.current.add(flow.id); arrivalStarted.current.set(flow.id, performance.now());
      }
      const arrivalAge = performance.now() - (arrivalStarted.current.get(flow.id) ?? -1000);
      const arrival = !reducedMotion && arrivalAge >= 0 && arrivalAge < 500 ? Math.sin((arrivalAge / 500) * Math.PI) : 0;
      matrix.scale.setScalar(0.001 + arrival * (flow.significant ? 1.7 : 1.25)); matrix.lookAt(camera.position); matrix.updateMatrix();
      impactMesh.current!.setMatrixAt(index, matrix.matrix); impactMesh.current!.setColorAt(index, color.copy(flow.color).multiplyScalar(active ? 1 : 0.12));
      matrix.scale.setScalar(0.001 + arrival * (flow.significant ? 1.45 : 1.1)); matrix.updateMatrix();
      arrivalHaloMesh.current!.setMatrixAt(index, matrix.matrix); arrivalHaloMesh.current!.setColorAt(index, color.copy(flow.color).multiplyScalar(active ? 1 : 0.1));
    });
    pulseMesh.current.instanceMatrix.needsUpdate = pulseHaloMesh.current.instanceMatrix.needsUpdate = trailMesh.current.instanceMatrix.needsUpdate = impactMesh.current.instanceMatrix.needsUpdate = arrivalHaloMesh.current.instanceMatrix.needsUpdate = true;
    if (pulseMesh.current.instanceColor) pulseMesh.current.instanceColor.needsUpdate = true;
    if (pulseHaloMesh.current.instanceColor) pulseHaloMesh.current.instanceColor.needsUpdate = true;
    if (trailMesh.current.instanceColor) trailMesh.current.instanceColor.needsUpdate = true;
    if (impactMesh.current.instanceColor) impactMesh.current.instanceColor.needsUpdate = true;
    if (arrivalHaloMesh.current.instanceColor) arrivalHaloMesh.current.instanceColor.needsUpdate = true;
  });

  const labelled = selectLabelCandidates(flows.map(flow => ({...flow, agentHighlighted: intent.type === "highlight-transfers" && (intentFlowIds.has(flow.id) || intentFlowIds.has(flow.transfer.id))})), {selectedId: selectedTransferId, hoveredId: hoveredFlow, limit: compact ? 1 : tablet ? 2 : 3});
  return <group ref={group}>
    <ambientLight intensity={0.22}/><pointLight position={[1.5, 3, 4]} intensity={20} color="#a6d9ff"/>
    <mesh><sphereGeometry args={[2.32, 48, 32]}/><meshStandardMaterial color="#031726" emissive="#06263b" emissiveIntensity={0.34} roughness={0.88} metalness={0.05} transparent opacity={0.24} depthWrite={false}/></mesh>
    <mesh><icosahedronGeometry args={[2.35, 4]}/><meshBasicMaterial color="#428ab3" wireframe transparent opacity={0.062} depthWrite={false}/></mesh>
    <mesh rotation={[0.32, 0.18, 0.12]} scale={0.992}><icosahedronGeometry args={[2.35, 2]}/><meshBasicMaterial color="#2b759e" wireframe transparent opacity={0.025} depthWrite={false}/></mesh>
    <mesh scale={1.055}><sphereGeometry args={[2.34, 48, 32]}/><meshBasicMaterial color="#2d9ad1" transparent opacity={0.052} side={THREE.BackSide} blending={THREE.AdditiveBlending} depthWrite={false}/></mesh>
    <Sparkles count={compact ? 42 : 100} scale={[8, 6.8, 7.8]} size={0.38} speed={0.035} opacity={0.16}/>
    {flows.map(flow => <Line key={flow.id} points={flow.points} color={`#${flow.color.getHexString()}`} transparent opacity={isFlowRelated(flow) ? (inspectedFlowId === flow.id ? 0.94 : flow.significant ? 0.38 + flow.strength * 0.16 : 0.07 + flow.recency * 0.11 + flow.strength * 0.08) : 0.026} lineWidth={inspectedFlowId === flow.id ? 1.75 : flow.significant ? 0.78 + flow.strength * 0.38 : 0.4 + flow.strength * 0.22} onPointerOver={(event: ThreeEvent<PointerEvent>) => {event.stopPropagation(); setHoveredFlow(flow.id);}} onPointerOut={() => setHoveredFlow(null)} onClick={(event: ThreeEvent<MouseEvent>) => {event.stopPropagation(); onSelectTransfer(flow.id);}}/>) }
    {labelled.map(flow => <TransferLabel key={flow.id} flow={flow} selected={flow.id === selectedTransferId} hovered={flow.id === hoveredFlow} occupied={labelRects}/>) }
    {annotations.slice(0, compact ? 0 : tablet ? 1 : 2).map(annotation => {
      const node = nodes.find(item => item.address.toLowerCase() === annotation.address.toLowerCase());
      if (!node) return null;
      return <group key={`annotation:${annotation.address}`} position={node.position as [number, number, number]}><Html center distanceFactor={8} zIndexRange={[6, 0]} style={{pointerEvents: "none"}}><div className="entityAnnotation">{annotation.label}</div></Html></group>;
    })}
    <instancedMesh ref={trailMesh} args={[undefined, undefined, MAX_FLOWS * TRAIL_STEPS]} count={flows.length * TRAIL_STEPS}><sphereGeometry args={[0.018, 6, 6]}/><meshBasicMaterial transparent opacity={0.34} depthWrite={false} toneMapped={false}/></instancedMesh>
    <instancedMesh ref={pulseMesh} args={[undefined, undefined, MAX_FLOWS]} count={flows.length} onPointerOver={event => {event.stopPropagation(); const flow = flows[event.instanceId ?? -1]; if (flow) setHoveredFlow(flow.id);}} onPointerOut={() => setHoveredFlow(null)} onClick={event => {event.stopPropagation(); const flow = flows[event.instanceId ?? -1]; if (flow) onSelectTransfer(flow.id);}}><sphereGeometry args={[0.03, 8, 8]}/><meshBasicMaterial toneMapped={false}/></instancedMesh>
    <instancedMesh ref={pulseHaloMesh} args={[undefined, undefined, MAX_FLOWS]} count={flows.length}><sphereGeometry args={[0.03, 8, 8]}/><meshBasicMaterial transparent opacity={0.16} depthWrite={false} toneMapped={false}/></instancedMesh>
    <instancedMesh ref={impactMesh} args={[undefined, undefined, MAX_FLOWS]} count={flows.length}><ringGeometry args={[0.04, 0.065, 16]}/><meshBasicMaterial transparent opacity={0.25} side={THREE.DoubleSide} depthWrite={false} toneMapped={false}/></instancedMesh>
    <instancedMesh ref={arrivalHaloMesh} args={[undefined, undefined, MAX_FLOWS]} count={flows.length}><sphereGeometry args={[0.09, 10, 10]}/><meshBasicMaterial transparent opacity={0.14} depthWrite={false} toneMapped={false}/></instancedMesh>
    <instancedMesh ref={haloMesh} args={[undefined, undefined, MAX_NODES]} count={nodes.length}><sphereGeometry args={[0.09, 10, 10]}/><meshBasicMaterial transparent opacity={0.11} depthWrite={false} toneMapped={false}/></instancedMesh>
    <instancedMesh ref={nodeMesh} args={[undefined, undefined, MAX_NODES]} count={nodes.length} onClick={event => {event.stopPropagation(); if (event.instanceId !== undefined && nodes[event.instanceId]) onSelectAddress(nodes[event.instanceId].address);}} onPointerMove={(event: ThreeEvent<PointerEvent>) => {event.stopPropagation(); setHoveredNode(event.instanceId ?? null);}} onPointerOut={() => setHoveredNode(null)}>
      <sphereGeometry args={[0.055, 12, 12]}/><meshStandardMaterial roughness={0.28} metalness={0.08} emissive="#194c6d" emissiveIntensity={1.7}/>
    </instancedMesh>
  </group>;
}

function TransferLabel({flow, selected, hovered, occupied}: {flow: Flow; selected: boolean; hovered: boolean; occupied: MutableRefObject<LabelRect[]>}) {
  const anchor = useRef<THREE.Group>(null);
  const label = useRef<HTMLDivElement>(null);
  const worldPosition = useMemo(() => new THREE.Vector3(), []);
  const projected = useMemo(() => new THREE.Vector3(), []);
  const cameraDirection = useMemo(() => new THREE.Vector3(), []);
  const surfaceNormal = useMemo(() => new THREE.Vector3(), []);
  useFrame(({clock, camera, size}) => {
    if (!anchor.current) return;
    const speed = 0.042 + Math.min(0.05, Math.log10(flow.amount + 1) * 0.005);
    anchor.current.position.copy(flow.curve.getPointAt((flow.phase + clock.getElapsedTime() * speed) % 1));
    anchor.current.updateWorldMatrix(true, false);
    anchor.current.getWorldPosition(worldPosition);
    projected.copy(worldPosition).project(camera);
    cameraDirection.copy(camera.position).sub(worldPosition).normalize();
    const rearFacing = surfaceNormal.copy(worldPosition).normalize().dot(cameraDirection) < -0.12;
    const centerX = (projected.x * 0.5 + 0.5) * size.width;
    const centerY = (-projected.y * 0.5 + 0.5) * size.height;
    const rect = {left: centerX - 42, right: centerX + 42, top: centerY - 25, bottom: centerY + 13};
    const collides = occupied.current.some(item => rect.left < item.right && rect.right > item.left && rect.top < item.bottom && rect.bottom > item.top);
    const visible = selected || hovered || (!rearFacing && !collides);
    if (label.current) label.current.style.opacity = visible ? "1" : "0";
    if (visible) occupied.current.push(rect);
  });
  return <group ref={anchor}><Html center distanceFactor={7} zIndexRange={[10, 0]} style={{pointerEvents: "none"}}><div ref={label} className={`txLabel ${selected ? "selected" : ""}`}><code>{shortTransactionHash(flow.transfer.txHash)}</code><strong>{flow.amount.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})} USDC</strong>{selected && <span>{flow.transfer.fromType.toUpperCase()} → {flow.transfer.toType.toUpperCase()}</span>}</div></Html></group>;
}

function NetworkSceneComponent(props: Props) {
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

export const NetworkScene = memo(NetworkSceneComponent);
