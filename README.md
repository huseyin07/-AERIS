# AERIS

**Real-time intelligence for the Arc economy.** AERIS observes broadly, analyzes deeply, and visualizes selectively.

AERIS never presents simulated activity as live. It is Mainnet-only: chain ID `5042`, the official Arc Mainnet RPC, and the native USDC ERC-20 interface at `0x3600000000000000000000000000000000000000`. There is intentionally no testnet or mock-data fallback. See the [Arc network reference](https://docs.arc.network/arc/references/network-information) and [Arc native USDC reference](https://docs.arc.network/arc/concepts/usdc).

The API incrementally reads standard Ethereum-compatible blocks, receipts, bytecode, and the indexed native-USDC `Transfer(address,address,uint256)` event. It normalizes verified USDC transfers, confirmed contract calls, and successful contract deployments into a discriminated `ArcActivityEvent` model. Address classification is cached and conservative: unknown remains unknown.

V7 maintains a chain-timestamp-based rolling 10-minute observation window with a 20,000-event safety ceiling. Economic intelligence only sums verified USDC transfer events. Contract activity remains a separate non-monetary dimension. A deterministic, diversity-aware selector sends at most 500 transfer candidates toward the existing 3D view, which independently enforces responsive flow/node/label caps.

The USDC log scan covers the discovered chain-relative window when `windowCovered` is true. Contract calls and deployments are a bounded sample from the latest six blocks and at most 32 eligible transactions; they are not full-window totals. The dashboard's Data Health panel exposes this distinction, scan coverage, RPC request count, ingestion and client response time, and recent warnings. The activity route emits structured summaries for partial, slow, failed, and periodically sampled healthy requests. Background tabs pause activity requests; foreground tabs resume promptly. Low-power or reduced-motion devices start in the interactive 2D network, with a manual 3D option. Speed Insights collects real-user performance metrics when enabled for the Vercel project.

Pull requests and pushes to `main` run the test suite and production build in GitHub Actions. Before release, verify a preview with live Arc data: open Data Health, select a 2D flow and node, switch 2D/3D when available, inspect the linked ledger selection, and confirm that the deployment status is Ready.

The ingestion cursor processes at most eight new/reconciliation blocks per poll, uses six-way bounded transaction/address concurrency, prevents overlapping server and browser polls, and reconciles a two-block recent hash window. It uses `eth_chainId`, `eth_blockNumber`, `eth_getBlockByNumber`, `eth_getTransactionReceipt`, `eth_getLogs`, and `eth_getCode`; it does not depend on traces, debug methods, WebSockets, batch RPC, archive access, or an indexer.

## Run

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run build
```

Optional production overrides are `ARC_MAINNET_RPC_URL`, `ARC_MAINNET_EXPLORER`, and `ARC_MAINNET_USDC`. Overrides are validated and the activity pipeline rejects any RPC whose `eth_chainId` is not `5042`.

Architecture: Arc Mainnet RPC → incremental activity ingestion → normalized rolling observation → Zustand → economic/activity intelligence → significance candidates → bounded React Three Fiber visualization and deterministic AERIS Agent.
