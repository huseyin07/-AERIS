# AERIS

**Watch money move.** A cinematic, real-time Arc economy observatory.

AERIS never presents simulated activity as live. The current public developer configuration is Arc Testnet. Mainnet RPC, chain ID and explorer values are intentionally not invented; configuration is centralized in `src/data/arc.ts`.

The API indexes the unified USDC `Transfer` event at `0x3600000000000000000000000000000000000000`. Addresses are conservatively classified from bytecode presence; unknown remains unknown.

## Run

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

Optional environment variables: `ARC_RPC_URL`, `ARC_WS_URL`.

Architecture: Arc RPC → server activity route → normalized bounded transfers → Zustand → React Three Fiber visualization/UI.
