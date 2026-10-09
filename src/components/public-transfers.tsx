"use client";

import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  PAYMENT_CHAIN,
  PAYMENT_EXPLORER,
  validateInvoice,
  type Invoice,
} from "@/payments/core";
import {
  address,
  submitTransfer,
  switchToArc,
  transferInvoice,
  validateQuote,
  walletAccount,
  type TransferQuote,
  type WalletChoice,
  type WalletProvider,
} from "@/payments/visitor-wallet";

import {
  mergeHistory,
  validateHistory,
  type PersonalTransfer as Transfer,
} from "@/payments/history";
import {
  cancelMobileWallet,
  connectMobileWallet,
  disconnectMobileWallet,
  mobileWalletLinks,
} from "@/payments/mobile-wallet";
type Evidence = {
  status: string;
  message: string;
  txHash?: string;
  blockNumber?: string;
  explorerUrl?: string;
  [key: string]: unknown;
};
const HISTORY = "aeris.personal-transfers.v1";
function readHistory(): Transfer[] {
  const values: unknown = JSON.parse(localStorage.getItem(HISTORY) ?? "[]");
  return validateHistory(values);
}
function rejected(error: unknown): boolean {
  const e = error as { code?: number; cause?: unknown };
  return e?.code === 4001 || (!!e?.cause && rejected(e.cause));
}
function errorMessage(error: unknown) {
  return rejected(error)
    ? "Request cancelled in your wallet. No new transfer was approved."
    : error instanceof Error
      ? error.message
      : "Wallet request failed. Check wallet activity.";
}
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function PublicTransfers({
  additionalWallet,
}: {
  additionalWallet?: WalletChoice;
}) {
  const [choices, setChoices] = useState<WalletChoice[]>([]);
  const [selected, setSelected] = useState<WalletChoice | null>(null);
  const [payer, setPayer] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [review, setReview] = useState<{
    invoice: Invoice;
    quote: TransferQuote;
  } | null>(null);
  const [history, setHistory] = useState<Transfer[]>([]);
  const [evidence, setEvidence] = useState<Record<string, Evidence>>({});
  const [recoveryHashes, setRecoveryHashes] = useState<Record<string, string>>(
    {},
  );
  const [error, setError] = useState("");
  const [storageOkay, setStorageOkay] = useState(true);
  const [busy, setBusy] = useState("");
  const [connections, setConnections] = useState<{
    projectId: string | null;
    circle: boolean;
  } | null>(null);
  const [pairingUri, setPairingUri] = useState("");
  const [qr, setQr] = useState("");
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyMessage, setHistoryMessage] = useState("");
  const [cursor, setCursor] = useState<{
    before: string;
    offset: number;
  } | null>(null);
  const pollCounts = useRef<Record<string, number>>({});
  const active = useRef(false);
  useEffect(() => {
    fetch("/api/payments/connections", { cache: "no-store" })
      .then((r) => r.json())
      .then(setConnections)
      .catch(() => setConnections({ projectId: null, circle: false }));
  }, []);
  useEffect(() => {
    let alive = true;
    setQr("");
    if (pairingUri)
      import("qrcode")
        .then((m) =>
          m.toDataURL(pairingUri, {
            width: 280,
            margin: 2,
            errorCorrectionLevel: "M",
          }),
        )
        .then((value) => {
          if (alive) setQr(value);
        })
        .catch(() =>
          setError("QR could not be displayed. Retry mobile connection."),
        );
    return () => {
      alive = false;
    };
  }, [pairingUri]);
  useEffect(() => {
    if (additionalWallet)
      setChoices((current) => [
        ...current.filter((c) => c.id !== additionalWallet.id),
        additionalWallet,
      ]);
  }, [additionalWallet]);
  const session = useRef(0);
  useEffect(() => {
    const add = (choice: WalletChoice) =>
      setChoices((current) =>
        current.some(
          (c) => c.provider === choice.provider || c.id === choice.id,
        )
          ? current
          : [...current.filter((c) => c.id !== "legacy"), choice].slice(0, 12),
      );
    const announce = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        detail?.provider &&
        typeof detail.provider.request === "function" &&
        typeof detail.info?.uuid === "string" &&
        typeof detail.info?.name === "string"
      )
        add({
          id: detail.info.uuid.slice(0, 80),
          name: detail.info.name.slice(0, 60),
          provider: detail.provider,
        });
    };
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const legacy = (window as Window & { ethereum?: WalletProvider }).ethereum;
    const timer = window.setTimeout(() => {
      if (legacy && typeof legacy.request === "function")
        setChoices((current) =>
          current.length
            ? current
            : [{ id: "legacy", name: "Browser wallet", provider: legacy }],
        );
    }, 250);
    try {
      setHistory(readHistory());
    } catch (e) {
      setStorageOkay(false);
      setError(errorMessage(e));
    }
    const storage = (event: StorageEvent) => {
      if (event.key === HISTORY)
        try {
          setHistory(readHistory());
        } catch {
          setStorageOkay(false);
        }
    };
    window.addEventListener("storage", storage);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("eip6963:announceProvider", announce);
      window.removeEventListener("storage", storage);
    };
  }, []);
  useEffect(() => {
    if (!selected) return;
    const invalidate = () => {
      session.current++;
      setReview(null);
      setPayer("");
      setChainId(null);
      setSelected(null);
      setError(
        "Wallet account or network changed. Connect again to review the transfer.",
      );
    };
    selected.provider.on?.("accountsChanged", invalidate);
    selected.provider.on?.("chainChanged", invalidate);
    selected.provider.on?.("disconnect", invalidate);
    return () => {
      selected.provider.removeListener?.("accountsChanged", invalidate);
      selected.provider.removeListener?.("chainChanged", invalidate);
      selected.provider.removeListener?.("disconnect", invalidate);
    };
  }, [selected]);
  useEffect(() => {
    setCursor(null);
    setHistoryMessage("");
    setHistoryBusy(false);
    if (!payer) return;
    let cancelled = false;
    async function recover() {
      setHistoryBusy(true);
      try {
        const r = await fetch(`/api/payments/history?payer=${payer}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(30000),
        });
        const data = await r.json();
        if (!r.ok) throw Error(data.message);
        if (cancelled) return;
        const values = mergeHistory(readHistory(), data, payer);
        localStorage.setItem(HISTORY, JSON.stringify(values));
        setHistory(values);
        setCursor(
          data.nextBefore
            ? { before: data.nextBefore, offset: data.nextOffset ?? 0 }
            : null,
        );
        setHistoryMessage(`Checked blocks ${data.fromBlock}–${data.toBlock}. ${data.transfers?.length ?? 0} outgoing transfers found in this range.`);
      } catch (e) {
        if (!cancelled) setHistoryMessage(errorMessage(e));
      } finally {
        if (!cancelled) setHistoryBusy(false);
      }
    }
    recover();
    return () => {
      cancelled = true;
    };
  }, [payer]);
  useEffect(() => {
    if (!payer) return;
    const candidates = history
      .filter(
        (v) =>
          v.payer === payer &&
          v.txHash &&
          (!evidence[v.id] ||
            ["pending", "confirming", "unknown"].includes(
              evidence[v.id].status,
            )) &&
          (pollCounts.current[v.id] ?? 0) < 10,
      )
      .slice(0, 3);
    if (!candidates.length) return;
    const timer = window.setTimeout(() => {
      for (const item of candidates) {
        pollCounts.current[item.id] = (pollCounts.current[item.id] ?? 0) + 1;
        void verify(item);
      }
    }, 12000);
    return () => window.clearTimeout(timer);
    // Verification uses the immutable transfer row; status changes reschedule a bounded read-only poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payer, history, evidence]);
  async function olderHistory() {
    if (!payer || !cursor || historyBusy) return;
    const owner = payer;
    const token = session.current;
    setHistoryBusy(true);
    try {
      const q = new URLSearchParams({
        payer: owner,
        before: cursor.before,
        offset: String(cursor.offset),
      });
      const r = await fetch(`/api/payments/history?${q}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.message);
      if (token !== session.current) return;
      const values = mergeHistory(readHistory(), data, owner);
      localStorage.setItem(HISTORY, JSON.stringify(values));
      setHistory(values);
      setCursor(
        data.nextBefore
          ? { before: data.nextBefore, offset: data.nextOffset ?? 0 }
          : null,
      );
      setHistoryMessage(`Loaded blocks ${data.fromBlock}–${data.toBlock}.`);
    } catch (e) {
      if (token === session.current) setHistoryMessage(errorMessage(e));
    } finally {
      if (token === session.current) setHistoryBusy(false);
    }
  }
  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !payer) return;
    const owner = payer;
    const token = session.current;
    try {
      if (file.size > 12000000)
        throw Error("History file must be smaller than 12 MB.");
      const contents = JSON.parse(await file.text());
      if (token !== session.current) return;
      const values = mergeHistory(readHistory(), contents, owner);
      localStorage.setItem(HISTORY, JSON.stringify(values));
      setHistory(values);
      setEvidence({});
      pollCounts.current = {};
      setHistoryMessage(
        "Backup restored. Receipts will be checked against Arc again.",
      );
    } catch (e) {
      if (token === session.current) setError(errorMessage(e));
    }
  }
  async function mobileConnect() {
    if (active.current || !connections?.projectId) return;
    setBusy("Open your wallet to connect…");
    try {
      const provider = await connectMobileWallet(
        connections.projectId,
        location.origin,
        setPairingUri,
      );
      await connect({ id: "walletconnect", name: "Mobile wallet", provider });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
      setPairingUri("");
    }
  }
  function edit(update: () => void) {
    setReview(null);
    setError("");
    update();
  }
  async function connect(choice: WalletChoice) {
    if (active.current) return;
    active.current = true;
    setBusy("Connecting wallet…");
    setError("");
    setReview(null);
    try {
      const account = await walletAccount(choice.provider, true);
      const chain = Number(
        await choice.provider.request({ method: "eth_chainId" }),
      );
      session.current++;
      setSelected(choice);
      setPayer(account);
      setChainId(chain);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      active.current = false;
      setBusy("");
    }
  }
  async function switchNetwork() {
    if (!selected || active.current) return;
    const choice = selected;
    active.current = true;
    setBusy("Switching to Arc…");
    setError("");
    try {
      await switchToArc(choice.provider);
      const account = await walletAccount(choice.provider);
      session.current++;
      setSelected(choice);
      setPayer(account);
      setChainId(PAYMENT_CHAIN);
      setReview(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      active.current = false;
      setBusy("");
    }
  }
  async function quote(invoice: Invoice, account: string) {
    const q = new URLSearchParams({
      payer: account,
      recipient: invoice.recipient,
      amount: invoice.amountUsdc,
    });
    const response = await fetch(`/api/payments/quote?${q}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(value.message ?? "Network check unavailable.");
    return validateQuote(value, invoice, account);
  }
  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (active.current || !selected || !payer) return;
    active.current = true;
    setBusy("Checking balance and network fee…");
    setError("");
    setReview(null);
    const token = session.current;
    try {
      if (chainId !== PAYMENT_CHAIN)
        throw new Error("Switch your wallet to Arc Mainnet first.");
      if ((await walletAccount(selected.provider)) !== payer)
        throw new Error("Connected wallet changed. Connect again.");
      const invoice = transferInvoice(recipient, amount, purpose);
      const value = await quote(invoice, payer);
      if (token === session.current) setReview({ invoice, quote: value });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      active.current = false;
      setBusy("");
    }
  }
  async function verify(item: Transfer, hash = item.txHash) {
    setEvidence((current) => ({
      ...current,
      [item.id]: {
        status: "checking",
        message: "Checking the confirmed Arc receipt…",
      },
    }));
    try {
      if (!/^0x[\da-f]{64}$/i.test(hash))
        throw new Error(
          "Paste the full transaction hash from wallet activity.",
        );
      const q = new URLSearchParams({
        payer: item.payer,
        hash,
        recipient: item.invoice.recipient,
        amount: item.invoice.amountUsdc,
      });
      if (item.txHash && hash.toLowerCase() !== item.txHash.toLowerCase())
        q.set("previous", item.txHash);
      else if (item.previousHashes?.length)
        q.set("previous", item.previousHashes.at(-1)!);
      const prior = q.get("previous");
      if (prior && item.nonceProofs?.[prior])
        q.set("proof", item.nonceProofs[prior]);
      const response = await fetch(`/api/payments/verify?${q}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      const value = await response.json();
      setEvidence((current) => ({ ...current, [item.id]: value }));
      if (typeof value.nonceProof === "string") {
        const values = readHistory().map((v) =>
          v.id === item.id
            ? {
                ...v,
                nonceProofs: Object.fromEntries(
                  Object.entries({
                    ...v.nonceProofs,
                    [hash.toLowerCase()]: value.nonceProof,
                  }).slice(-10),
                ),
              }
            : v,
        );
        localStorage.setItem(HISTORY, JSON.stringify(values));
        setHistory(values);
      }
      if (
        ["verified", "failed", "cancelled", "pending", "confirming"].includes(
          value.status,
        ) &&
        hash.toLowerCase() !== item.txHash.toLowerCase()
      ) {
        const values = readHistory().map((v) =>
          v.id === item.id
            ? {
                ...v,
                txHash: hash.toLowerCase(),
                previousHashes: v.txHash
                  ? [...(v.previousHashes ?? []), v.txHash].slice(-10)
                  : v.previousHashes,
              }
            : v,
        );
        localStorage.setItem(HISTORY, JSON.stringify(values));
        setHistory(values);
      }
    } catch (e) {
      setEvidence((current) => ({
        ...current,
        [item.id]: { status: "unverified", message: errorMessage(e) },
      }));
    }
  }
  async function send() {
    if (active.current || !selected || !review || !payer) return;
    active.current = true;
    setBusy("Rechecking transfer…");
    setError("");
    const token = session.current,
      choice = selected,
      account = payer,
      checked = review;
    let attempt: Transfer | undefined;
    const execute = async () => {
      const values = readHistory();
      if (
        values.some(
          (v) =>
            v.payer === account &&
            v.source !== "arc" &&
            (!v.txHash ||
              !["verified", "failed", "cancelled"].includes(
                evidence[v.id]?.status,
              )),
        )
      )
        throw new Error(
          "Verify or resolve your previous transfer before sending another.",
        );
      const fresh = await quote(checked.invoice, account);
      if (token !== session.current)
        throw new Error("Wallet changed during review. Connect again.");
      if (
        BigInt(fresh.gas) * BigInt(fresh.maxFeePerGas) >
        BigInt(checked.quote.gas) * BigInt(checked.quote.maxFeePerGas)
      ) {
        setReview({ invoice: checked.invoice, quote: fresh });
        throw new Error(
          "The network fee increased. Check the updated total and approve again.",
        );
      }
      if (
        (await walletAccount(choice.provider)) !== account ||
        Number(await choice.provider.request({ method: "eth_chainId" })) !==
          PAYMENT_CHAIN
      )
        throw new Error("Account or network changed. Connect again.");
      attempt = {
        id: crypto.randomUUID(),
        payer: account,
        invoice: { ...checked.invoice, reference: `TX-${Date.now()}` },
        txHash: "",
        createdAt: new Date().toISOString(),
      };
      // Persist before requesting a wallet submission. A tab reload cannot silently repeat this attempt.
      localStorage.setItem(HISTORY, JSON.stringify([attempt, ...values]));
      setHistory([attempt, ...values]);
      setReview(null);
      setBusy("Approve the transfer in your wallet…");
      try {
        const hash = await submitTransfer(
          choice.provider,
          account,
          checked.invoice,
          fresh,
        );
        attempt = { ...attempt, txHash: hash };
        const updated = readHistory().map((v) =>
          v.id === attempt!.id ? attempt! : v,
        );
        setHistory(updated);
        try {
          localStorage.setItem(HISTORY, JSON.stringify(updated));
        } catch {
          setStorageOkay(false);
          setError(
            `Transfer submitted: ${hash}. Save this hash; browser storage failed.`,
          );
        }
        setBusy("Checking settlement…");
        await verify(attempt);
      } catch (e) {
        if (rejected(e)) {
          const updated = readHistory().filter((v) => v.id !== attempt!.id);
          localStorage.setItem(HISTORY, JSON.stringify(updated));
          setHistory(updated);
        }
        throw e;
      }
    };
    try {
      if (!navigator.locks)
        throw new Error(
          "Use a current browser with Web Locks support to send transfers.",
        );
      await navigator.locks.request(
        `aeris-transfer-${account}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw new Error(
              "Another tab is preparing a transfer from this wallet.",
            );
          await execute();
        },
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      active.current = false;
      setBusy("");
    }
  }
  async function resolveCancelled(item: Transfer) {
    try {
      if (!navigator.locks)
        throw new Error("Use a current browser to reconcile this request.");
      await navigator.locks.request(
        `aeris-transfer-${item.payer}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw new Error(
              "Another tab is waiting for wallet approval. Resolve that request there first.",
            );
          if (
            !window.confirm(
              "Only continue if you checked your wallet activity and confirmed no transfer was submitted. Remove this unresolved request?",
            )
          )
            return;
          const values = readHistory();
          if (values.find((v) => v.id === item.id)?.txHash)
            throw new Error(
              "A transaction hash was recorded. Verify its receipt instead.",
            );
          const updated = values.filter((v) => v.id !== item.id);
          localStorage.setItem(HISTORY, JSON.stringify(updated));
          setHistory(updated);
        },
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const ownHistory = history.filter((v) => v.payer === payer);
  const unresolved = ownHistory.some(
    (v) =>
      v.source !== "arc" &&
      !["verified", "failed", "cancelled"].includes(evidence[v.id]?.status),
  );
  return (
    <>
      <nav className="paymentSteps" aria-label="Transfer steps">
        <a href="#connect-wallet">
          <span>1</span>Connect wallet
        </a>
        <a href="#send-transfer">
          <span>2</span>Review & send
        </a>
        <a href="#settlement-evidence">
          <span>3</span>Check receipt
        </a>
      </nav>
      <section className="buildCard" id="connect-wallet">
        <small>YOUR WALLET · ARC MAINNET</small>
        <h2>{payer ? "Wallet connected" : "Connect your wallet"}</h2>
        {payer ? (
          <>
            <p className="transferAddress">
              <a
                href={`${PAYMENT_EXPLORER}/address/${payer}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {payer} ↗
              </a>
            </p>
            <p>
              {selected?.name} ·{" "}
              {chainId === PAYMENT_CHAIN ? "Arc Mainnet" : "Different network"}
            </p>
            <div className="buildLinks">
              {chainId !== PAYMENT_CHAIN && (
                <button
                  className="buildButton"
                  disabled={!!busy}
                  onClick={switchNetwork}
                >
                  Switch to Arc Mainnet
                </button>
              )}
              <button
                className="buildButton"
                disabled={!!busy}
                onClick={() => {
                  if (selected?.id === "walletconnect")
                    void disconnectMobileWallet();
                  session.current++;
                  setSelected(null);
                  setPayer("");
                  setChainId(null);
                  setReview(null);
                }}
              >
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="buildLinks">
              {choices.map((choice) => (
                <button
                  className="buildButton"
                  key={choice.id}
                  disabled={!!busy}
                  onClick={() => connect(choice)}
                >
                  Connect {choice.name}
                </button>
              ))}
              {connections?.projectId && (
                <button
                  className="buildButton"
                  disabled={!!busy}
                  onClick={mobileConnect}
                >
                  Connect mobile wallet · QR
                </button>
              )}
              {connections?.circle && (
                <a className="buildButton" href="/payments/circle">
                  Create or open Circle wallet
                </a>
              )}
            </div>
            <p className="buildMuted">
              {choices.length
                ? "Choose your browser wallet. On mobile, open this page inside your wallet’s browser."
                : "Open this page in a wallet’s mobile browser or use a browser wallet extension, such as MetaMask or Rabby."}
            </p>
            {!choices.length && connections && !connections.projectId && !connections.circle && <div className="walletEmpty"><strong>No wallet detected in this browser.</strong><p>Install a browser wallet, or open this page from your wallet app’s built-in browser. Return here to connect.</p></div>}
          </>
        )}
        <p className="buildMuted">
          Transfers come from your wallet. You approve each one there. AERIS
          never asks for your seed phrase or private key.
        </p>
      </section>
      {pairingUri && (
        <section
          className="buildCard walletQr"
          role="region"
          aria-label="Connect mobile wallet"
        >
          <h2>Scan with your wallet</h2>
          <p>
            Open WalletConnect in your phone’s wallet and scan this QR code.
          </p>
          {qr ? (
            <Image
              unoptimized
              src={qr}
              width="280"
              height="280"
              alt="WalletConnect pairing QR code"
            />
          ) : (
            <p>Preparing QR…</p>
          )}
          <p className="buildMuted">
            This requests a connection. A transfer still requires your separate
            approval.
          </p>
          <div className="buildLinks">
            {mobileWalletLinks(pairingUri).map((link) => (
              <a className="buildButton" key={link.name} href={link.url}>
                {link.name}
              </a>
            ))}
            <button
              className="buildButton"
              onClick={() =>
                navigator.clipboard
                  .writeText(pairingUri)
                  .catch(() => setError("Could not copy pairing link."))
              }
            >
              Copy pairing link
            </button>
          </div>
          <button className="buildButton" onClick={cancelMobileWallet}>
            Cancel connection
          </button>
        </section>
      )}
      {error && (
        <p className="paymentHold paymentNotice" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className="paymentNotice" role="status">
          {busy}
        </p>
      )}
      <section className="buildCard" id="send-transfer">
        <h2>Send USDC</h2>
        {!payer && <p className="transferNext">First connect your wallet above. Then enter a recipient and amount.</p>}
        {payer && chainId !== PAYMENT_CHAIN && <p className="transferNext">Switch to Arc Mainnet above to review this transfer.</p>}
        <form className="paymentForm" onSubmit={prepare}>
          <label className="paymentWide">
            Recipient address
            <input
              required
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              value={recipient}
              disabled={!!busy}
              onChange={(e) => edit(() => setRecipient(e.target.value))}
            />
          </label>
          <label>
            Amount · USDC
            <input
              required
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              disabled={!!busy}
              onChange={(e) => edit(() => setAmount(e.target.value))}
            />
          </label>
          <label>
            Note · optional
            <input
              maxLength={160}
              placeholder="What is this transfer for?"
              value={purpose}
              disabled={!!busy}
              onChange={(e) => edit(() => setPurpose(e.target.value))}
            />
          </label>
          <button
            className="buildButton"
            disabled={
              !payer ||
              chainId !== PAYMENT_CHAIN ||
              !!busy ||
              !storageOkay ||
              unresolved
            }
          >
            Review transfer
          </button>
        </form>
        <p className="buildMuted">
          Arc Mainnet only. The recipient needs an Arc address. The network fee
          is also paid in USDC.
        </p>
        {!storageOkay && (
          <p className="paymentHold">
            Reliable browser storage is required before sending.
          </p>
        )}
        {unresolved && (
          <p className="paymentHold">
            Check the receipt or resolve your previous wallet request below
            before sending again.
          </p>
        )}
        {review && (
          <div className="transferReview">
            <h3>Check before you approve</h3>
            <dl className="buildFacts">
              <div>
                <dt>From</dt>
                <dd>{payer}</dd>
              </div>
              <div>
                <dt>To</dt>
                <dd>{review.invoice.recipient}</dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>{review.invoice.amountUsdc} USDC</dd>
              </div>
              <div>
                <dt>Maximum network fee</dt>
                <dd>{review.quote.maximumFeeUsdc} USDC</dd>
              </div>
              <div>
                <dt>Maximum total</dt>
                <dd>{review.quote.totalUsdc} USDC</dd>
              </div>
              <div>
                <dt>Balance</dt>
                <dd>{review.quote.balanceUsdc} USDC</dd>
              </div>
            </dl>
            <p className="buildMuted">
              The actual network fee may be lower. Sending opens your wallet’s
              approval screen.
            </p>
            <button
              className="buildButton transferPrimary"
              disabled={!!busy || unresolved}
              onClick={send}
            >
              Approve in wallet
            </button>
          </div>
        )}
      </section>
      <section className="buildCard" id="settlement-evidence">
        <div className="buildCardHeading">
          <h2>Your transfer receipts</h2>
          {ownHistory.length > 0 && (
            <button
              className="buildButton"
              onClick={() =>
                download("aeris-transfer-history.json", {
                  version: 1,
                  chainId: PAYMENT_CHAIN,
                  transfers: ownHistory,
                })
              }
            >
              Download history
            </button>
          )}
        </div>
        <p className="buildMuted">Check outgoing transfers and confirmed receipts for your connected wallet.</p>
        {payer && (
          <details className="historyTools paymentDetails">
            <summary><span>History & backups</span><small>Older transfers and private notes</small></summary>
            <p className="buildMuted">Arc can recover outgoing transfers on another device. Download and import a backup to carry your private notes across devices.</p>
            <div className="buildLinks"><label className="paymentImport">
              Import history backup
              <input
                aria-label="Import history backup"
                type="file"
                accept="application/json,.json"
                onChange={importBackup}
                disabled={!!busy}
              />
            </label>
            {cursor && (
              <button
                className="buildButton"
                disabled={historyBusy}
                onClick={olderHistory}
              >
                {historyBusy ? "Loading history…" : "Load older Arc history"}
              </button>
            )}
            </div>
          </details>
        )}
        {historyMessage && (
          <p className="buildMuted" role="status">
            {historyMessage}
          </p>
        )}
        {!payer ? (
          <p>
            Connect your wallet to recover its outgoing transfers and view saved
            notes.
          </p>
        ) : historyBusy && !ownHistory.length ? (
          <p role="status">Checking outgoing transfers on Arc…</p>
        ) : !ownHistory.length ? (
          <p>No outgoing transfers found in the loaded range.</p>
        ) : (
          ownHistory.map((item) => (
            <article className="paymentInvoice" key={item.id}>
              <h3>
                {item.invoice.amountUsdc} USDC →{" "}
                {item.invoice.recipient.slice(0, 8)}…
                {item.invoice.recipient.slice(-6)}
              </h3>
              <p className="transferAddress">To: {item.invoice.recipient}</p>
              <p>
                {item.invoice.purpose} ·{" "}
                {new Date(item.createdAt).toLocaleString()}
              </p>
              {item.txHash ? (
                <>
                  <a
                    className="transferAddress"
                    href={`${PAYMENT_EXPLORER}/tx/${item.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View transaction ↗
                  </a>
                  <p className="transferAddress buildMuted">{item.txHash}</p>
                </>
              ) : (
                <>
                  <p className="paymentHold">
                    Wallet request unresolved. Check your wallet activity before
                    retrying.
                  </p>
                  <label className="paymentHash">
                    Transaction hash from your wallet
                    <input
                      placeholder="0x…"
                      value={recoveryHashes[item.id] ?? ""}
                      onChange={(e) =>
                        setRecoveryHashes((current) => ({
                          ...current,
                          [item.id]: e.target.value.trim(),
                        }))
                      }
                    />
                  </label>
                </>
              )}
              <p
                role="status"
                className={
                  evidence[item.id]?.status === "verified"
                    ? "paymentVerified"
                    : "buildMuted"
                }
              >
                {evidence[item.id]?.message ??
                  (item.txHash
                    ? "Submitted · receipt not yet verified"
                    : "No transaction hash recorded")}
              </p>
              {item.txHash &&
                ["pending", "unknown"].includes(evidence[item.id]?.status) && (
                  <p className="paymentHold">
                    Manage speed-up or cancellation in your wallet. A missing
                    hash or a pending transaction is not a payment failure.
                    Never resend automatically. If your wallet replaced or
                    cancelled it, paste the new hash below. AERIS checks the
                    original sender and nonce before resolving it.
                  </p>
                )}
              {item.txHash &&
                ["pending", "unknown"].includes(evidence[item.id]?.status) && (
                  <label className="paymentHash">
                    Replacement or cancellation hash
                    <input
                      placeholder="0x…"
                      value={recoveryHashes[item.id] ?? ""}
                      onChange={(e) =>
                        setRecoveryHashes((current) => ({
                          ...current,
                          [item.id]: e.target.value.trim(),
                        }))
                      }
                    />
                    <button
                      className="buildButton"
                      disabled={!recoveryHashes[item.id]}
                      onClick={() => verify(item, recoveryHashes[item.id])}
                    >
                      Check replacement outcome
                    </button>
                  </label>
                )}
              <div className="buildLinks">
                <button
                  className="buildButton"
                  disabled={
                    evidence[item.id]?.status === "checking" ||
                    (!item.txHash && !recoveryHashes[item.id])
                  }
                  onClick={() =>
                    verify(item, item.txHash || recoveryHashes[item.id])
                  }
                >
                  Verify receipt
                </button>
                {evidence[item.id]?.status === "verified" && (
                  <button
                    className="buildButton"
                    onClick={() =>
                      download(`aeris-receipt-${item.id}.json`, {
                        version: 1,
                        transfer: item,
                        evidence: evidence[item.id],
                      })
                    }
                  >
                    Download verified receipt
                  </button>
                )}
                {!item.txHash && (
                  <button
                    className="buildButton"
                    disabled={!!busy}
                    onClick={() => resolveCancelled(item)}
                  >
                    Resolve cancelled request
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </section>
    </>
  );
}
