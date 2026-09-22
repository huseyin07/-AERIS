# AERIS

**Watch money move.** A real-time Arc Mainnet USDC observatory.

AERIS never presents simulated activity as live. It is Mainnet-only: chain ID `5042`, the official Arc Mainnet RPC, and the native USDC ERC-20 interface at `0x3600000000000000000000000000000000000000`. There is intentionally no testnet or mock-data fallback. See the [Arc network reference](https://docs.arc.network/arc/references/network-information) and [Arc native USDC reference](https://docs.arc.network/arc/concepts/usdc).

The API reads the standard indexed `Transfer(address,address,uint256)` event directly from native USDC, normalizes its 6-decimal token values, and conservatively classifies addresses from bytecode presence. Unknown remains unknown.

## Run

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run build
```

Optional production overrides are `ARC_MAINNET_RPC_URL`, `ARC_MAINNET_EXPLORER`, and `ARC_MAINNET_USDC`. Overrides are validated and the activity pipeline rejects any RPC whose `eth_chainId` is not `5042`.

Architecture: Arc Mainnet RPC → server activity route → normalized bounded transfers → Zustand → React Three Fiber visualization/UI.
