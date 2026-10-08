import test from "node:test";
import assert from "node:assert/strict";
import { mergeHistory, validateHistory } from "../src/payments/history.ts";
import { transferInvoice } from "../src/payments/visitor-wallet.ts";
import {
  sealCircleSession,
  openCircleSession,
  ownArcWallet,
} from "../src/circle/user-session.ts";
import { circleUserProvider } from "../src/circle/user-provider.ts";
import { paymentData, PAYMENT_TOKEN } from "../src/payments/core.ts";
const payer = "0x" + "1".repeat(40),
  recipient = "0x" + "2".repeat(40),
  hash = "0x" + "ab".repeat(32);
const row = () => ({
  id: "intent-1",
  payer,
  invoice: transferInvoice(recipient, "0.1", "Private vendor note"),
  txHash: hash,
  createdAt: "2026-10-08T00:00:00Z",
});
test("cross-device import preserves notes and strips untrusted payment evidence or secrets", () => {
  const imported = {
    ...row(),
    verified: true,
    evidence: { status: "verified" },
    userToken: "secret",
  };
  const values = mergeHistory(
    [],
    { version: 1, chainId: 5042, transfers: [imported] },
    payer,
  );
  assert.equal(values[0].invoice.purpose, "Private vendor note");
  assert.equal(values[0].verified, undefined);
  assert.equal(values[0].userToken, undefined);
  assert.equal(values[0].evidence, undefined);
  assert.throws(
    () =>
      mergeHistory(
        [],
        { version: 1, chainId: 5042, transfers: [row()] },
        recipient,
      ),
    /another wallet/,
  );
  assert.throws(
    () =>
      mergeHistory([], { version: 1, chainId: 1, transfers: [row()] }, payer),
    /Mainnet/,
  );
});
test("chain recovery merges a hash without replacing original note or creating a duplicate", () => {
  const recovered = {
    ...row(),
    id: "arc-" + hash.slice(2),
    source: "arc",
    invoice: {
      ...row().invoice,
      amountUsdc: "0.10",
      purpose: "Recovered from Arc",
      reference: "ARC-123",
    },
  };
  const values = mergeHistory(
    [row()],
    { version: 1, chainId: 5042, transfers: [recovered] },
    payer,
  );
  assert.equal(values.length, 1);
  assert.equal(values[0].invoice.purpose, "Private vendor note");
  const restored = mergeHistory(
    [recovered],
    { version: 1, chainId: 5042, transfers: [row()] },
    payer,
  );
  assert.equal(restored[0].invoice.purpose, "Private vendor note");
  assert.throws(
    () =>
      mergeHistory(
        [row()],
        {
          version: 1,
          chainId: 5042,
          transfers: [
            {
              ...recovered,
              invoice: { ...recovered.invoice, amountUsdc: "0.2" },
            },
          ],
        },
        payer,
      ),
    /conflicts/,
  );
  assert.throws(
    () => validateHistory([row(), { ...row(), id: "another" }]),
    /twice/,
  );
  assert.throws(
    () => validateHistory([{ ...row(), previousHashes: ["bad"] }]),
    /replacement/,
  );
});
test("Circle session cookies cannot be read with another key, tampered with or replayed after expiry", () => {
  const key = "ab".repeat(32),
    s = {
      userToken: "private-token",
      encryptionKey: "private-key",
      expiresAt: 2000,
    };
  const sealed = sealCircleSession(s, key);
  assert.ok(!sealed.includes(s.userToken));
  assert.deepEqual(openCircleSession(sealed, key, 1000), s);
  assert.throws(() => openCircleSession(sealed, "bc".repeat(32), 1000));
  assert.throws(() => openCircleSession(sealed, key, 2000), /expired/);
  const bytes = Buffer.from(sealed, "base64url");
  bytes[30] ^= 1;
  assert.throws(() =>
    openCircleSession(bytes.toString("base64url"), key, 1000),
  );
});
test("Circle wallet access is limited to the logged-in user active end-user Arc EOA", () => {
  const wallet = {
    id: "own",
    address: payer,
    blockchain: "ARC",
    accountType: "EOA",
    state: "LIVE",
    custodyType: "ENDUSER",
  };
  assert.equal(ownArcWallet([wallet], "own").address, payer);
  for (const patch of [
    { id: "foreign" },
    { blockchain: "ETH" },
    { custodyType: "DEVELOPER" },
    { state: "FROZEN" },
    { accountType: "SCA" },
  ])
    assert.throws(() => ownArcWallet([{ ...wallet, ...patch }], "own"));
});
test("Circle adapter creates one exact transfer challenge and only polls after user approval", async () => {
  const invoice = transferInvoice(recipient, "0.1", "send");
  let posts = 0,
    approvals = 0,
    reads = 0,
    reference;
  const provider = circleUserProvider(
    payer,
    "wallet-id",
    async (action, input) => {
      posts++;
      assert.equal(action, "transfer");
      assert.equal(input.invoice.recipient, recipient);
      assert.equal(input.invoice.amountUsdc, "0.1");
      assert.equal(input.maximumFeeUsdc, "0.001");
      reference = input.idempotencyKey;
      return { challengeId: "challenge" };
    },
    async (c) => {
      assert.equal(c, "challenge");
      approvals++;
    },
    async () => {
      reads++;
      return [{ id: "t", refId: reference, txHash: hash }];
    },
  );
  const tx = {
    from: payer,
    to: PAYMENT_TOKEN,
    data: paymentData(invoice),
    value: "0x0",
    chainId: "0x13b2",
    gas: "0xc350",
    maxFeePerGas: "0x4a817c800",
  };
  assert.equal(
    await provider.request({ method: "eth_sendTransaction", params: [tx] }),
    hash,
  );
  assert.equal(posts, 1);
  assert.equal(approvals, 1);
  assert.equal(reads, 1);
  for (const patch of [
    { from: recipient },
    { to: recipient },
    { chainId: "0x1" },
    { value: "0x1" },
  ])
    await assert.rejects(
      provider.request({
        method: "eth_sendTransaction",
        params: [{ ...tx, ...patch }],
      }),
    );
  assert.equal(posts, 1);
});
test("Circle challenge cancellation never leads to a second submit or receipt fabrication", async () => {
  let posts = 0,
    reads = 0;
  const provider = circleUserProvider(
    payer,
    "wallet-id",
    async () => {
      posts++;
      return { challengeId: "c" };
    },
    async () => {
      throw Error("User did not approve");
    },
    async () => {
      reads++;
      return [];
    },
  );
  await assert.rejects(
    provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: payer,
          to: PAYMENT_TOKEN,
          data: paymentData(transferInvoice(recipient, "0.1", "test")),
          value: "0x0",
          chainId: "0x13b2",
          gas: "0xc350",
          maxFeePerGas: "0x4a817c800",
        },
      ],
    }),
    /did not approve/,
  );
  assert.equal(posts, 1);
  assert.equal(reads, 0);
});

import { signNonceProof, readNonceProof } from "../src/payments/nonce-proof.ts";
test("a dropped original hash is resolved only with a signed, exact, unexpired nonce observation", () => {
  const key = "ab".repeat(32),
    invoice = row().invoice,
    proof = signNonceProof(hash, payer, invoice, 17, key, 1000);
  assert.equal(readNonceProof(proof, hash, payer, invoice, key, 2000), 17);
  assert.equal(
    readNonceProof(proof, hash, recipient, invoice, key, 2000),
    undefined,
  );
  assert.equal(
    readNonceProof(
      proof,
      hash,
      payer,
      { ...invoice, amountUsdc: "0.2" },
      key,
      2000,
    ),
    undefined,
  );
  assert.equal(
    readNonceProof(proof + "x", hash, payer, invoice, key, 2000),
    undefined,
  );
  assert.equal(
    readNonceProof(proof, hash, payer, invoice, key, 1000 + 7 * 86400000),
    undefined,
  );
});
