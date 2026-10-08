import type { WalletProvider } from "./visitor-wallet";
import { PAYMENT_CHAIN, PAYMENT_RPC } from "./core";
let instance:
  | InstanceType<typeof import("@walletconnect/ethereum-provider").default>
  | undefined;
let cancel: (() => void) | undefined;
export function cancelMobileWallet() {
  cancel?.();
}
export async function connectMobileWallet(
  projectId: string,
  origin: string,
  onUri: (uri: string) => void,
): Promise<WalletProvider> {
  if (!/^[a-f\d]{32}$/i.test(projectId))
    throw Error("WalletConnect project setup is incomplete.");
  if (!instance) {
    const { EthereumProvider } = await import(
      "@walletconnect/ethereum-provider"
    );
    instance = await EthereumProvider.init({
      projectId,
      showQrModal: false,
      optionalChains: [PAYMENT_CHAIN],
      rpcMap: { [PAYMENT_CHAIN]: PAYMENT_RPC },
      optionalMethods: [
        "eth_sendTransaction",
        "wallet_switchEthereumChain",
        "wallet_addEthereumChain",
      ],
      optionalEvents: ["chainChanged", "accountsChanged"],
      metadata: {
        name: "AERIS",
        description: "USDC transfers on Arc Mainnet",
        url: origin,
        icons: [],
      },
    });
  }
  const handler = (uri: string) => onUri(uri);
  instance.on("display_uri", handler);
  let cancelled = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!instance.session) {
      const connection = instance.connect().then(async () => {
        if (cancelled && instance?.session) await instance.disconnect();
      });
      const stopped = new Promise<never>((_, reject) => {
        cancel = () => {
          cancelled = true;
          instance?.signer.abortPairingAttempt();
          reject(
            Error("Mobile connection cancelled. No transfer was requested."),
          );
        };
        timer = setTimeout(() => {
          cancelled = true;
          instance?.signer.abortPairingAttempt();
          reject(Error("Mobile connection expired. Try again."));
        }, 120000);
      });
      await Promise.race([connection, stopped]);
    }
    return instance as unknown as WalletProvider;
  } finally {
    if (timer) clearTimeout(timer);
    cancel = undefined;
    instance.removeListener("display_uri", handler);
    onUri("");
  }
}
export async function disconnectMobileWallet() {
  if (instance?.session) await instance.disconnect();
}
export function mobileWalletLinks(uri: string) {
  if (!uri.startsWith("wc:")) return [];
  return [
    {
      name: "Open Trust Wallet",
      url: `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}`,
    },
  ];
}
