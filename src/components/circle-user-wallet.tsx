"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { PublicTransfers } from "./public-transfers";
import { circleUserProvider } from "@/circle/user-provider";
import type { WalletChoice } from "@/payments/visitor-wallet";
import { PAYMENT_EXPLORER } from "@/payments/core";
type Wallet = { id: string; address: string };
type Transaction = {
  id: string;
  walletId: string;
  refId?: string;
  txHash?: string;
  state: string;
  amounts?: string[];
};
async function api(action: string, input?: unknown) {
  const r = await fetch(`/api/circle-user/${action}`, {
    method: input === undefined ? "GET" : "POST",
    headers:
      input === undefined ? undefined : { "Content-Type": "application/json" },
    body: input === undefined ? undefined : JSON.stringify(input),
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.message ?? "Circle request unavailable.");
  return data;
}
export function CircleUserWallet() {
  const [config, setConfig] = useState<{
      circle: boolean;
      circleAppId: string | null;
    } | null>(null),
    [email, setEmail] = useState(""),
    [signedIn, setSignedIn] = useState(false),
    [wallets, setWallets] = useState<Wallet[]>([]),
    [choice, setChoice] = useState<WalletChoice>(),
    [transactions, setTransactions] = useState<Transaction[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const sdk = useRef<W3SSdk | undefined>(undefined),
    pending = useRef(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/payments/connections", { cache: "no-store" })
      .then((r) => r.json())
      .then((value) => {
        if (alive) setConfig(value);
      })
      .catch(() => {
        if (alive) setMessage("Wallet setup status is unavailable.");
      });
    return () => {
      alive = false;
    };
  }, []);
  async function getSdk() {
    if (sdk.current) return sdk.current;
    if (!config?.circleAppId) throw Error("Circle wallet setup is incomplete.");
    const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
    sdk.current = new W3SSdk({ appSettings: { appId: config.circleAppId } });
    return sdk.current;
  }
  async function execute(challenge: string) {
    const session = await api("session"),
      client = await getSdk();
    client.setAuthentication({
      userToken: session.userToken,
      encryptionKey: session.encryptionKey,
    });
    await new Promise<void>((resolve, reject) =>
      client.execute(challenge, (error, result) => {
        if (error) reject(Error(error.message));
        else if (result?.status === "COMPLETE") resolve();
        else
          reject(
            Error(
              "Circle approval is not complete. Review wallet activity before retrying.",
            ),
          );
      }),
    );
  }
  async function loadActivity(walletId: string) {
    const data = await api(
      `transactions?walletId=${encodeURIComponent(walletId)}`,
    );
    const rows: Transaction[] = data.transactions ?? [];
    setTransactions(rows);
    return rows;
  }
  async function loadWallets() {
    const data = await api("wallets");
    setWallets(data.wallets ?? []);
    setSignedIn(true);
    setMessage(
      data.wallets?.length
        ? "Your Circle wallet is ready to connect below."
        : "Create your own Arc wallet. Circle will ask you to approve its setup.",
    );
  }
  async function run(fn: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Circle request failed.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function login(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const client = await getSdk();
      const deviceId = await client.getDeviceId();
      const tokens = await api("otp", { email: email.trim(), deviceId });
      client.updateConfigs(
        {
          appSettings: { appId: config!.circleAppId! },
          loginConfigs: {
            deviceToken: tokens.deviceToken,
            deviceEncryptionKey: tokens.deviceEncryptionKey,
            otpToken: tokens.otpToken,
          },
        },
        async (error, result) => {
          if (error || !result) {
            setMessage(error?.message ?? "Email sign-in incomplete.");
            return;
          }
          await run(async () => {
            await api("session", {
              userToken: result.userToken,
              encryptionKey: result.encryptionKey,
            });
            await loadWallets();
          });
        },
      );
      client.verifyOtp();
      setMessage("Enter the emailed code in Circle’s verification window.");
    });
  }
  async function initialize() {
    await run(async () => {
      const result = await api("initialize", {
        idempotencyKey: crypto.randomUUID(),
      });
      if (result.challengeId) await execute(result.challengeId);
      else if (!result.existing)
        throw Error("No wallet creation challenge returned.");
      await loadWallets();
    });
  }
  async function selectWallet(wallet: Wallet) {
    await run(async () => {
      await loadActivity(wallet.id);
      const provider = circleUserProvider(
        wallet.address,
        wallet.id,
        api,
        execute,
        () => loadActivity(wallet.id),
      );
      setChoice({
        id: `circle-${wallet.id}`,
        name: "Your Circle wallet",
        provider,
      });
    });
  }
  async function manage(tx: Transaction, action: "accelerate" | "cancel") {
    if (
      !window.confirm(
        `${action === "cancel" ? "Request cancellation" : "Speed up"} of this transaction? This requires your Circle approval and may charge an additional network fee. A completed payment cannot be undone.`,
      )
    )
      return;
    await run(async () => {
      const result = await api(action, {
        walletId: tx.walletId,
        transactionId: tx.id,
      });
      if (!result.challengeId)
        throw Error("No Circle approval challenge returned.");
      await execute(result.challengeId);
      await loadActivity(tx.walletId);
      setMessage(
        "Request approved. Refresh activity until Circle confirms its outcome.",
      );
    });
  }
  async function logout() {
    await run(async () => {
      await api("logout", {});
      sdk.current = undefined;
      setChoice(undefined);
      setWallets([]);
      setTransactions([]);
      setSignedIn(false);
      setEmail("");
    });
  }
  return (
    <>
      <section className="buildCard">
        <small>CIRCLE · YOUR OWN WALLET</small>
        <h2>Email sign-in</h2>
        <p>
          This creates or opens your own user-controlled Arc wallet. Each
          payment requires your approval in Circle’s secure window.
        </p>
        {!config ? (
          <p>Checking availability…</p>
        ) : !config.circle ? (
          <div className="walletEmpty">
            <strong>Email wallets are not available yet.</strong><p>
            Connect your existing wallet to send USDC on Arc.</p><a className="buildButton" href="/payments">Use my wallet →</a>
          </div>
        ) : !signedIn ? (
          <>
            <form className="paymentForm" onSubmit={login}>
              <label>
                Email
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
              </label>
              <button className="buildButton" disabled={busy}>
                Send sign-in code
              </button>
            </form>
            <button
              className="buildButton"
              disabled={busy}
              onClick={() => run(loadWallets)}
            >
              Restore signed-in session
            </button>
          </>
        ) : (
          <>
            <div className="buildLinks">
              {!wallets.length && (
                <button
                  className="buildButton"
                  disabled={busy}
                  onClick={initialize}
                >
                  Create my Arc wallet
                </button>
              )}
              {wallets.map((wallet) => (
                <button
                  className="buildButton transferAddress"
                  key={wallet.id}
                  disabled={busy}
                  onClick={() => selectWallet(wallet)}
                >
                  Use {wallet.address}
                </button>
              ))}
              <button className="buildButton" disabled={busy} onClick={logout}>
                Sign out
              </button>
            </div>
          </>
        )}
        {message && (
          <p role="status" className="paymentNotice">
            {message}
          </p>
        )}
        <p className="buildMuted">
          Session credentials are not included in history backups. Signing out
          closes access on this browser.
        </p>
      </section>
      {choice && <PublicTransfers key={choice.id} additionalWallet={choice} />}
      {choice && (
        <section className="buildCard">
          <div className="buildCardHeading">
            <h2>Circle activity</h2>
            <button
              className="buildButton"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await loadActivity(choice.id.slice(7));
                })
              }
            >
              Refresh activity
            </button>
          </div>
          <p className="buildMuted">
            Recent Circle requests and replacement/cancellation states. A
            completed Circle request still needs its Arc receipt verified above.
          </p>
          {!transactions.length ? (
            <p>No recent requests.</p>
          ) : (
            transactions.map((tx) => (
              <article className="paymentInvoice" key={tx.id}>
                <p>{tx.state}</p>
                <p className="transferAddress">Request {tx.refId ?? tx.id}</p>
                {tx.txHash && (
                  <p className="transferAddress">
                    <a
                      href={`${PAYMENT_EXPLORER}/tx/${tx.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {tx.txHash} ↗
                    </a>
                  </p>
                )}
                {["INITIATED", "QUEUED", "PENDING", "SENT"].includes(
                  tx.state,
                ) && (
                  <div className="buildLinks">
                    <button
                      className="buildButton"
                      disabled={busy}
                      onClick={() => manage(tx, "accelerate")}
                    >
                      Speed up · approve in Circle
                    </button>
                    <button
                      className="buildButton"
                      disabled={busy}
                      onClick={() => manage(tx, "cancel")}
                    >
                      Cancel · approve in Circle
                    </button>
                  </div>
                )}
              </article>
            ))
          )}
        </section>
      )}
    </>
  );
}
