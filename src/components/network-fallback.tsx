"use client";

import {useMemo} from "react";
import type {EntityType, Transfer} from "@/data/types";
import {money, short} from "@/lib/format";
import {buildFallbackNetwork} from "@/visualization/fallback-model";

type Props = {
  transfers: Transfer[];
  endpointTypes: Record<string, EntityType>;
  selectedAddress: string | null;
  selectedTransferId: string | null;
  onSelectAddress: (address: string) => void;
  onSelectTransfer: (id: string) => void;
};

function flowType(flow: ReturnType<typeof buildFallbackNetwork>["flows"][number]) {
  if (flow.to.type === "contract") return "contractIn";
  if (flow.from.type === "contract") return "contractOut";
  if (flow.from.type === "unknown" || flow.to.type === "unknown") return "unknown";
  return "wallet";
}

export function NetworkFallback({transfers, endpointTypes, selectedAddress, selectedTransferId, onSelectAddress, onSelectTransfer}: Props) {
  const {nodes, flows} = useMemo(() => buildFallbackNetwork(transfers, endpointTypes, selectedTransferId), [transfers, endpointTypes, selectedTransferId]);
  const highlightedAddress = selectedAddress?.toLowerCase();
  const selectedFlow = flows.find(flow => flow.id === selectedTransferId);
  const topFlows = useMemo(() => [...flows].sort((a, b) => Number(b.transfer.value) - Number(a.transfer.value) || a.id.localeCompare(b.id)).slice(0, 3), [flows]);

  return <div className="fallbackNetwork" role="region" aria-label="Verified Arc Mainnet two-dimensional network">
    <div className="fallbackNetworkHead"><span className="fallbackModeDot"/>2D NETWORK <b>· ARC MAINNET</b></div>
    <svg className="fallbackMap" viewBox="0 0 640 420" role="group" aria-label={`${flows.length} verified USDC flows between ${nodes.length} addresses`}>
      <defs><radialGradient id="aerisFallbackCore"><stop offset="0" stopColor="#0d5477" stopOpacity=".34"/><stop offset="1" stopColor="#062237" stopOpacity=".02"/></radialGradient></defs>
      <circle cx="320" cy="210" r="176" className="fallbackRing outer"/>
      <circle cx="320" cy="210" r="122" className="fallbackRing inner"/>
      <circle cx="320" cy="210" r="83" fill="url(#aerisFallbackCore)" className="fallbackCore"/>
      <path className="fallbackAxis" d="M 320 20 V 400 M 100 210 H 540"/>
      <circle cx="320" cy="210" r="4" className="fallbackCenter"/>
      {flows.map(flow => {
        const active = flow.id === selectedTransferId || Boolean(highlightedAddress && (flow.from.address === highlightedAddress || flow.to.address === highlightedAddress));
        const muted = Boolean((selectedTransferId || highlightedAddress) && !active);
        return <g key={flow.id} className={`fallbackEdge ${flowType(flow)} ${active ? "active" : ""} ${muted ? "muted" : ""}`}>
          <path d={flow.path} className="fallbackEdgeLine"/>
          <path d={flow.path} className="fallbackEdgeHit" role="button" tabIndex={0} aria-label={`Inspect ${money(flow.transfer.value)} USDC transfer from ${short(flow.from.address)} to ${short(flow.to.address)}`} onClick={() => onSelectTransfer(flow.id)} onKeyDown={event => {if (event.key === "Enter" || event.key === " ") {event.preventDefault(); onSelectTransfer(flow.id);}}}/>
        </g>;
      })}
      {nodes.map(node => {
        const active = highlightedAddress === node.address || Boolean(selectedFlow && (selectedFlow.from.address === node.address || selectedFlow.to.address === node.address));
        return <g key={node.address} className={`fallbackNode ${node.type} ${active ? "active" : ""}`} role="button" tabIndex={0} aria-label={`Inspect ${node.type} address ${node.address}`} onClick={() => onSelectAddress(node.address)} onKeyDown={event => {if (event.key === "Enter" || event.key === " ") {event.preventDefault(); onSelectAddress(node.address);}}}>
          <circle cx={node.x} cy={node.y} r={active ? 13 : 10} className="fallbackNodeHalo"/>
          <circle cx={node.x} cy={node.y} r={active ? 5 : 3.5} className="fallbackNodeCore"/>
        </g>;
      })}
    </svg>
    <div className="fallbackNetworkMeta"><span>VERIFIED FLOWS <strong>{flows.length}</strong></span><span>ADDRESSES <strong>{nodes.length}</strong></span></div>
    {topFlows.length ? <div className="fallbackTopFlows"><small>TOP OBSERVED FLOWS</small>{topFlows.map(flow => <button key={flow.id} type="button" className={flow.id === selectedTransferId ? "active" : ""} onClick={() => onSelectTransfer(flow.id)}><span>{short(flow.from.address)} → {short(flow.to.address)}</span><strong>{money(flow.transfer.value)} USDC</strong></button>)}</div> : <div className="fallbackNoFlows">No verified transfers ≥1,000 USDC in this view.</div>}
    <div className="fallbackNetworkFoot"><span>3D UNAVAILABLE · VERIFIED DATA CONTINUES</span><a href="#live-ledger">VIEW LIVE LEDGER ↓</a></div>
  </div>;
}
