import {readFile, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join, resolve} from "node:path";
import {createInterface} from "node:readline/promises";
import {createPublicClient, defineChain, erc20Abi, formatUnits, http, keccak256, serializeTransaction, type Hex} from "viem";
import {decidePayment, invoiceFingerprint, PAYMENT_CHAIN, PAYMENT_RPC, PAYMENT_TOKEN, paymentData, units, validateInvoice, validatePolicy, verifyPaymentEvidence, type PaymentPolicy} from "../src/payments/core.ts";
import {signWithCircle, validateSignedPayment, validateUnsignedInvoice, verifySigner} from "../src/payments/circle-signer.ts";
import {existingInvoice, readJournal, reservation, reservedToday, saveJournal, withJournalLock, type PaymentRecord} from "../src/payments/journal.ts";

const directory = resolve(process.env.AERIS_PAYMENT_DIRECTORY ?? join(homedir(), ".aeris-payments"));
const policyPath = join(directory, "policy.json");
const [command, filename] = process.argv.slice(2);
const execute = process.argv.includes("--execute");
async function question(prompt: string) {
  if (!process.stdin.isTTY) throw new Error("Operator confirmation requires an interactive terminal.");
  const rl = createInterface({input: process.stdin, output: process.stdout});
  try {return await rl.question(prompt);} finally {rl.close();}
}
async function hidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error("Enter credentials in your local terminal, or supply them through a private environment.");
  process.stdout.write(prompt);
  return new Promise((resolveValue, reject) => {
    let value = "";
    const finish = (error?: Error) => {process.stdin.off("data", onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write("\n"); error ? reject(error) : resolveValue(value.trim());};
    const onData = (chunk: Buffer) => {for (const char of chunk.toString()) {
      if (char === "\u0003") {finish(new Error("Cancelled.")); return;}
      if (char === "\r" || char === "\n") {finish(); return;}
      if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
      else if (char >= " " && char <= "~") value += char;
    }};
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on("data", onData);
  });
}
const chain = defineChain({id: PAYMENT_CHAIN, name: "Arc Mainnet", nativeCurrency: {name: "USDC", symbol: "USDC", decimals: 18}, rpcUrls: {default: {http: [PAYMENT_RPC]}}});
const rpc = createPublicClient({chain, transport: http(PAYMENT_RPC, {timeout: 12_000, retryCount: 0})});
async function freshHead() {
  const [chainId, head] = await Promise.all([rpc.getChainId(), rpc.getBlock()]);
  const age = Date.now() - Number(head.timestamp) * 1000;
  if (chainId !== PAYMENT_CHAIN || head.number === null || age > 120_000 || age < -30_000) throw new Error("Arc chain/head is wrong or stale. Payment held.");
  return head;
}
async function settle(record: PaymentRecord, policy: PaymentPolicy) {
  validateUnsignedInvoice(record.unsigned, record.invoice);
  if (!record.signed || !record.txHash || keccak256(record.signed) !== record.txHash) throw new Error("Signed journal record is invalid. Stop and inspect it.");
  await validateSignedPayment(record.signed, record.unsigned, policy.payer);
  let receipt;
  try {receipt = await rpc.getTransactionReceipt({hash: record.txHash});} catch { /* Missing receipt is not success. */ }
  if (!receipt) {
    if (policy.emergencyStop || !policy.allowedRecipients.includes(record.invoice.recipient) || units(record.invoice.amountUsdc) > units(policy.maxPaymentUsdc)) throw new Error("Current policy blocks resubmission. Existing receipt lookup found no settlement; no signed bytes were broadcast.");
    // Always replay the identical signed bytes. Never create a replacement payment after an ambiguous response.
    try {await rpc.sendRawTransaction({serializedTransaction: record.signed});} catch { /* Already known or ambiguous: reconcile the same hash. */ }
    try {receipt = await rpc.waitForTransactionReceipt({hash: record.txHash, confirmations: 2, timeout: 45_000, pollingInterval: 1500});}
    catch {throw new Error(`Settlement is pending or unavailable. Retry the SAME invoice; do not reset the journal. Hash: ${record.txHash}`);}
  }
  if (receipt.status === "reverted") {record.state = "reverted"; throw new Error("The transaction reverted. Invoice remains unpaid; its reservation is retained for operator review.");}
  const [head, block, tx] = await Promise.all([freshHead(), rpc.getBlock({blockNumber: receipt.blockNumber}), rpc.getTransaction({hash: record.txHash})]);
  record.evidence = verifyPaymentEvidence(record.invoice, policy.payer, receipt, tx, head.number!, block.hash!);
  record.state = "confirmed";
  return record.evidence;
}
async function main() {
  if (!filename || !["configure", "pay"].includes(command)) {console.log("Setup: npm run circle:pay -- configure policy.json\nPreview: npm run circle:pay -- pay invoice.json\nExecute/resume: npm run circle:pay -- pay invoice.json --execute"); return;}
  if (command === "configure") {
    const policy = validatePolicy(JSON.parse(await readFile(resolve(filename), "utf8")));
    console.log(JSON.stringify(policy, null, 2));
    if (await question("Save this spending policy on this computer? Type SAVE: ") !== "SAVE") throw new Error("Cancelled.");
    await withJournalLock(directory, async () => {
      const journal = await readJournal(directory);
      if (journal.records.some(r => r.payer !== policy.payer)) throw new Error("This journal belongs to another payer. Use a separate payment directory.");
      await writeFile(policyPath, JSON.stringify(policy, null, 2), {mode: 0o600});
    });
    console.log(`Policy saved. Durable payment journal: ${directory}. Use one runner directory for this wallet.`); return;
  }
  const invoice = validateInvoice(JSON.parse(await readFile(resolve(filename), "utf8")));
  let policy: PaymentPolicy;
  try {policy = validatePolicy(JSON.parse(await readFile(policyPath, "utf8")));} catch {throw new Error("Configure the operator policy first. No payment was signed.");}
  const apiKey = process.env.CIRCLE_API_KEY || await hidden("Circle mainnet API key (input hidden): ");
  await verifySigner(apiKey, policy);
  console.log(`Circle EVM wallet verified · Arc Mainnet ${PAYMENT_CHAIN}`);
  await withJournalLock(directory, async () => {
    const journal = await readJournal(directory);
    if (journal.records.some(r => r.payer !== policy.payer)) throw new Error("Payer does not match the durable journal.");
    let record = existingInvoice(journal, invoice);
    if (record?.state === "confirmed") {console.log(`Already paid. ${record.evidence?.explorerUrl}`); return;}
    if (record?.state === "reverted") throw new Error("This invoice has a reverted transaction. Manual reconciliation is required; retries cannot create another payment.");
    if (record?.state === "signed") {
      console.log(`Existing signed payment: ${record.txHash}`);
      if (!execute) {console.log("Use --execute to reconcile/resubmit these identical bytes."); return;}
      try {await settle(record, policy);} finally {await saveJournal(directory, journal);}
      console.log(`SETTLEMENT VERIFIED: ${record.evidence?.explorerUrl}`); return;
    }
    if (journal.records.some(r => r !== record && ["prepared", "signed"].includes(r.state))) throw new Error("Another invoice is unresolved. Reconcile it before preparing a new nonce.");
    const head = await freshHead();
    const [balance, nativeBalance, pendingNonce, latestNonce] = await Promise.all([
      rpc.readContract({address: PAYMENT_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [policy.payer], blockNumber: head.number!}),
      rpc.getBalance({address: policy.payer, blockNumber: head.number!}), rpc.getTransactionCount({address: policy.payer, blockTag: "pending"}), rpc.getTransactionCount({address: policy.payer, blockTag: "latest"}),
    ]);
    if (pendingNonce !== latestNonce) throw new Error("Wallet has an untracked pending nonce. Reconcile external activity first.");
    const prepared = record ? validateUnsignedInvoice(record.unsigned, invoice) : await rpc.prepareTransactionRequest({account: policy.payer, to: PAYMENT_TOKEN, data: paymentData(invoice), value: 0n, chain: chain, type: "eip1559"});
    if (prepared.nonce !== latestNonce || prepared.chainId !== PAYMENT_CHAIN || prepared.gas === undefined || prepared.maxFeePerGas === undefined || prepared.maxPriorityFeePerGas === undefined) throw new Error("Nonce changed or transaction preparation is incomplete. Do not reset the journal to retry.");
    const gasNative = prepared.gas * prepared.maxFeePerGas;
    const gasUnits = (gasNative + 999_999_999_999n) / 1_000_000_000_000n;
    const reserved = reservedToday(journal) - (record ? BigInt(record.reservedUsdcUnits) : 0n);
    const decision = decidePayment(invoice, policy, balance, reserved, gasUnits);
    console.log(`Invoice ${invoice.reference}: ${invoice.purpose}\nFrom: ${policy.payer}\nTo: ${invoice.recipient}\nAmount: ${invoice.amountUsdc} USDC\nMaximum gas: ${formatUnits(gasNative, 18)} USDC\nAgent decision: ${decision.action.toUpperCase()} · ${decision.reason}`);
    if (decision.action !== "pay") throw new Error("Payment held. No transaction was signed.");
    if (nativeBalance < units(invoice.amountUsdc) * 1_000_000_000_000n + gasNative + units(policy.reserveUsdc, true) * 1_000_000_000_000n) throw new Error("Native USDC balance cannot cover amount, fees and reserve.");
    if (!execute) {console.log(`Preview only · approval ${decision.requiresApproval ? "required" : "inside saved automation policy"}. No signature or broadcast.`); return;}
    if (decision.requiresApproval && await question(`Approve ${invoice.amountUsdc} USDC to ${invoice.recipient}? Type PAY ${invoice.reference}: `) !== `PAY ${invoice.reference}`) throw new Error("Cancelled.");
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET || await hidden("Registered Entity Secret (input hidden): ");
    if (!record) {
      const unsigned = serializeTransaction({chainId: PAYMENT_CHAIN, type: "eip1559", nonce: prepared.nonce, gas: prepared.gas, maxFeePerGas: prepared.maxFeePerGas, maxPriorityFeePerGas: prepared.maxPriorityFeePerGas, to: PAYMENT_TOKEN, value: 0n, data: paymentData(invoice)});
      record = {invoice, fingerprint: invoiceFingerprint(invoice), payer: policy.payer, createdAt: new Date().toISOString(), state: "prepared", reservedUsdcUnits: reservation(invoice, gasNative).toString(), unsigned};
      journal.records.push(record); await saveJournal(directory, journal);
    }
    record.signed = await signWithCircle(apiKey, entitySecret, policy, record.unsigned, `AERIS invoice ${invoice.reference}: ${invoice.purpose}`);
    record.txHash = keccak256(record.signed); record.state = "signed";
    await saveJournal(directory, journal); // Save recoverable signed bytes BEFORE broadcasting.
    try {await settle(record, policy);} finally {await saveJournal(directory, journal);}
    console.log(`SETTLEMENT VERIFIED: ${record.evidence?.explorerUrl}`);
  });
}
main().catch(error => {
  // viem/provider errors may contain request details. Expose only our bounded errors.
  const message = error instanceof Error && !error.name.includes("Rpc") && error.name === "Error" ? error.message : "Provider operation failed. Inspect the saved journal and retry the same invoice; no new payment will be created.";
  console.error(message); process.exitCode = 1;
}).finally(() => {delete process.env.CIRCLE_API_KEY; delete process.env.CIRCLE_ENTITY_SECRET;});
