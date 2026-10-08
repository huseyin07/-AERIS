import {mkdir, open, readFile, rename, rm} from "node:fs/promises";
import {join} from "node:path";
import type {Hex} from "viem";
import {invoiceFingerprint, invoiceKey, units, type Invoice} from "./core.ts";

export type PaymentRecord = {invoice: Invoice; fingerprint: string; payer: string; createdAt: string; state: "prepared" | "signed" | "confirmed" | "reverted"; reservedUsdcUnits: string; unsigned: Hex; signed?: Hex; txHash?: Hex; evidence?: {txHash: Hex; blockNumber: string; logIndex: number; gasCostNativeUnits: string; explorerUrl: string}};
export type Journal = {version: 1; records: PaymentRecord[]};
export async function withJournalLock<T>(directory: string, task: () => Promise<T>): Promise<T> {
  await mkdir(directory, {recursive: true, mode: 0o700});
  const lock = join(directory, "execution.lock");
  let handle;
  try {handle = await open(lock, "wx", 0o600);} catch {throw new Error("Another payment runner is active, or an interrupted run left a lock. Inspect the journal before removing execution.lock.");}
  try {await handle.writeFile(String(process.pid)); await handle.sync(); return await task();}
  finally {await handle.close(); await rm(lock);}
}
export async function readJournal(directory: string): Promise<Journal> {
  try {
    const raw = JSON.parse(await readFile(join(directory, "journal.json"), "utf8"));
    if (raw.version !== 1 || !Array.isArray(raw.records)) throw new Error();
    for (const record of raw.records) {
      if (!record || record.fingerprint !== invoiceFingerprint(record.invoice) || !["prepared", "signed", "confirmed", "reverted"].includes(record.state)
        || !/^\d+$/.test(record.reservedUsdcUnits) || !/^0x[\da-f]+$/i.test(record.unsigned) || !Number.isFinite(Date.parse(record.createdAt))) throw new Error();
    }
    return raw;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {version: 1, records: []};
    throw new Error("Payment journal is invalid. Execution stopped; do not reset it to retry a payment.");
  }
}
export async function saveJournal(directory: string, journal: Journal) {
  const tmp = join(directory, "journal.tmp");
  const handle = await open(tmp, "w", 0o600);
  try {await handle.writeFile(JSON.stringify(journal, null, 2)); await handle.sync();} finally {await handle.close();}
  await rename(tmp, join(directory, "journal.json"));
  const parent = await open(directory, "r"); try {await parent.sync();} finally {await parent.close();}
}
export function existingInvoice(journal: Journal, invoice: Invoice) {
  const record = journal.records.find(r => invoiceKey(r.invoice) === invoiceKey(invoice));
  if (record && record.fingerprint !== invoiceFingerprint(invoice)) throw new Error("This vendor/invoice reference already exists with different details. Execution stopped.");
  return record;
}
export function reservedToday(journal: Journal, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  return journal.records.reduce((sum, r) => sum + (r.createdAt.slice(0, 10) === day || r.state === "prepared" || r.state === "signed" ? BigInt(r.reservedUsdcUnits) : 0n), 0n);
}
export function reservation(invoice: Invoice, gasNative: bigint) {return units(invoice.amountUsdc) + (gasNative + 999_999_999_999n) / 1_000_000_000_000n;}
