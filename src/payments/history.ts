import {
  invoiceFingerprint,
  units,
  validateInvoice,
  type Invoice,
} from "./core";
import { address } from "./visitor-wallet";
export type PersonalTransfer = {
  id: string;
  payer: string;
  invoice: Invoice;
  txHash: string;
  createdAt: string;
  previousHashes?: string[];
  nonceProofs?: Record<string, string>;
  source?: "browser" | "arc";
};
const HASH = /^0x[\da-f]{64}$/i;
export function validateHistory(value: unknown): PersonalTransfer[] {
  if (!Array.isArray(value) || value.length > 500)
    throw new Error("Keep at most 500 transfer records in one history file.");
  const ids = new Set<string>(),
    hashes = new Set<string>();
  return value.map((item) => {
    const v = item as PersonalTransfer;
    if (
      !v ||
      typeof v.id !== "string" ||
      !/^[\w-]{1,100}$/.test(v.id) ||
      ids.has(v.id) ||
      typeof v.createdAt !== "string" ||
      !Number.isFinite(Date.parse(v.createdAt)) ||
      typeof v.txHash !== "string" ||
      (v.txHash && !HASH.test(v.txHash))
    )
      throw new Error("Invalid or duplicate transfer history record.");
    ids.add(v.id);
    const payer = address(v.payer),
      invoice = validateInvoice(v.invoice);
    if (payer === invoice.recipient)
      throw new Error("A transfer record cannot pay itself.");
    const txHash = v.txHash.toLowerCase();
    if (txHash && hashes.has(txHash))
      throw new Error("One transaction cannot appear twice in the history.");
    if (txHash) hashes.add(txHash);
    const previousHashes = v.previousHashes ?? [];
    if (
      !Array.isArray(previousHashes) ||
      previousHashes.length > 10 ||
      previousHashes.some((h) => typeof h !== "string" || !HASH.test(h))
    )
      throw new Error("Invalid replacement transaction history.");
    const nonceProofs = v.nonceProofs ?? {};
    if (
      typeof nonceProofs !== "object" ||
      Array.isArray(nonceProofs) ||
      nonceProofs === null ||
      Object.keys(nonceProofs).length > 10 ||
      Object.entries(nonceProofs).some(
        ([h, p]) =>
          !HASH.test(h) ||
          typeof p !== "string" ||
          p.length > 2000 ||
          !/^[-\w]+\.[-\w]+$/.test(p),
      )
    )
      throw Error("Invalid nonce proof history.");
    return {
      nonceProofs: Object.fromEntries(
        Object.entries(nonceProofs).map(([h, p]) => [h.toLowerCase(), p]),
      ),
      id: v.id,
      payer,
      invoice,
      txHash,
      createdAt: new Date(v.createdAt).toISOString(),
      previousHashes: [...new Set(previousHashes.map((h) => h.toLowerCase()))],
      source: v.source === "arc" ? ("arc" as const) : ("browser" as const),
    };
  });
}
export function mergeHistory(
  existing: PersonalTransfer[],
  incoming: unknown,
  payer: string,
): PersonalTransfer[] {
  const owner = address(payer);
  const input = incoming as {
    version?: number;
    chainId?: number;
    transfers?: unknown;
  };
  if (!input || input.version !== 1 || input.chainId !== 5042)
    throw new Error("Choose an AERIS Arc Mainnet history backup.");
  const added = validateHistory(input.transfers);
  if (added.some((v) => v.payer !== owner))
    throw new Error(
      "This backup belongs to another wallet. Connect that wallet first.",
    );
  const result = [...validateHistory(existing)];
  for (const item of added) {
    const match = result.find(
      (v) => v.id === item.id || (item.txHash && v.txHash === item.txHash),
    );
    if (match) {
      if (
        match.payer !== item.payer ||
        match.invoice.recipient !== item.invoice.recipient ||
        units(match.invoice.amountUsdc) !== units(item.invoice.amountUsdc) ||
        (!match.txHash &&
          invoiceFingerprint(match.invoice) !==
            invoiceFingerprint(item.invoice))
      )
        throw new Error("Backup conflicts with an existing transfer.");
      if (!match.txHash && item.txHash) match.txHash = item.txHash;
      if (match.source === "arc" && item.source !== "arc") {
        match.invoice = item.invoice;
        match.source = "browser";
      }
      match.nonceProofs = { ...item.nonceProofs, ...match.nonceProofs };
    } else result.push(item);
  }
  return validateHistory(result).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}
