# AERIS

**Real-time intelligence for the Arc economy.** AERIS observes broadly, analyzes deeply, and visualizes selectively.

AERIS never presents simulated activity as live. It is Mainnet-only: chain ID `5042`, the official Arc Mainnet RPC, and the native USDC ERC-20 interface at `0x3600000000000000000000000000000000000000`. There is intentionally no testnet or mock-data fallback. See the [Arc network reference](https://docs.arc.network/arc/references/network-information) and [Arc native USDC reference](https://docs.arc.network/arc/concepts/usdc).

The API incrementally reads standard Ethereum-compatible blocks, receipts, bytecode, and the indexed native-USDC `Transfer(address,address,uint256)` event. It normalizes verified USDC transfers, confirmed contract calls, and successful contract deployments into a discriminated `ArcActivityEvent` model. Address classification is cached and conservative: unknown remains unknown.

V7 maintains a chain-timestamp-based rolling 10-minute observation window with a 20,000-event safety ceiling. Economic intelligence only sums verified USDC transfer events. Contract activity remains a separate non-monetary dimension. A deterministic, diversity-aware selector sends at most 500 transfer candidates toward the existing 3D view, which independently enforces responsive flow/node/label caps.

The USDC log scan covers the discovered chain-relative window when `windowCovered` is true. Contract calls and deployments are a bounded sample from the latest six blocks and at most 32 eligible transactions; they are not full-window totals. The dashboard's Data Health panel exposes this distinction, scan coverage, RPC request count, ingestion and client response time, and recent warnings. The activity route emits structured summaries for partial, slow, failed, and periodically sampled healthy requests. Background tabs pause activity requests; foreground tabs resume promptly. Low-power or reduced-motion devices start in the interactive 2D network, with a manual 3D option. Speed Insights collects real-user performance metrics when enabled for the Vercel project.

Pull requests and pushes to `main` run the test suite and production build in GitHub Actions. Before release, verify a preview with live Arc data: open Data Health, select a 2D flow and node, switch 2D/3D when available, inspect the linked ledger selection, and confirm that the deployment status is Ready.

The ingestion cursor processes at most eight new/reconciliation blocks per poll, uses six-way bounded transaction/address concurrency, prevents overlapping server and browser polls, and reconciles a two-block recent hash window. It uses `eth_chainId`, `eth_blockNumber`, `eth_getBlockByNumber`, `eth_getTransactionReceipt`, `eth_getLogs`, and `eth_getCode`; it does not depend on traces, debug methods, WebSockets, batch RPC, archive access, or an indexer.

## Product evidence and grants

The `/about` page gives reviewers a product overview, demo steps, current scope and Circle Agent Wallet verification. `/api/agent-wallet` verifies Circle wallet identity and reads its native USDC balance from a current Arc Mainnet block. Missing credentials show setup pending; failed verification never publishes a balance. Wallet reads do not require an entity secret. `/payments` prepares invoices and verifies settlement. The local Circle runner implements EVM signing, Arc broadcasting, operator limits and a durable recovery journal; public server spending stays disabled. Its first real mainnet payment still requires operator execution and receipt verification. See [Circle payments](docs/circle-payments.md).

See [grant preparation](docs/grants.md) for Arc Microgrants / Circle Developer Grants drafts, milestone evidence, operator setup and release gates. The application must distinguish shipped intelligence and the implemented local payment runner from a verified live payment.

## Run locally

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run build
```

Optional production overrides are `ARC_MAINNET_RPC_URL`, `ARC_MAINNET_EXPLORER`, and `ARC_MAINNET_USDC`. Overrides are validated and the activity pipeline rejects any RPC whose `eth_chainId` is not `5042`.

Architecture: Arc Mainnet RPC → incremental activity ingestion → normalized rolling observation → Zustand → economic/activity intelligence → significance candidates → bounded React Three Fiber visualization and deterministic AERIS Agent.

## Public transfers

`/payments` connects an injected EIP-1193 wallet (EIP-6963 selection; mobile wallet browsers supported). Visitors review an exact USDC transfer and fresh mainnet balance/fee quote, then approve in their own wallet. No token approval, Circle credentials or hosted treasury signing are used by this visitor flow. Receipt verification accepts an explicit payer and verifies exact calldata, sender, recipient, USDC transfer log and a canonical confirmed block. This does not establish Circle wallet identity for visitor wallets.

The browser saves an unresolved attempt before submitting and uses Web Locks to prevent concurrent tabs for the same wallet. It never automatically retries a wallet submission. Unknown outcomes require wallet-activity reconciliation; stored hashes must be freshly verified after reload. Local records are not shared between devices and do not prevent a user from independently sending from another site or wallet. Fee estimates are refreshed before approval; a higher maximum requires another review. The wallet can display its own final fee before approval.

`/payments/operator` retains the separate configured Circle treasury planning and local signing workflow. A public visitor cannot spend that treasury. WalletConnect QR connections, visitor-created Circle wallets and hosted automatic payments are not included. A live personal transfer is not claimed until a user approves it and its receipt verifies.
