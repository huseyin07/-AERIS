import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export type CircleSession = {
  userToken: string;
  encryptionKey: string;
  expiresAt: number;
};
export function sealCircleSession(session: CircleSession, key: string) {
  if (!/^[a-f\d]{64}$/i.test(key))
    throw Error("Session encryption is not configured.");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(session)),
    cipher.final(),
  ]);
  const sealed = Buffer.concat([iv, cipher.getAuthTag(), data]).toString(
    "base64url",
  );
  if (sealed.length > 3800)
    throw Error("Circle session exceeds secure cookie size.");
  return sealed;
}
export function openCircleSession(
  value: string,
  key: string,
  now = Date.now(),
): CircleSession {
  if (!/^[a-f\d]{64}$/i.test(key) || value.length > 16000)
    throw Error("Sign in to your Circle wallet.");
  const raw = Buffer.from(value, "base64url");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    raw.subarray(0, 12),
  );
  cipher.setAuthTag(raw.subarray(12, 28));
  const session = JSON.parse(
    Buffer.concat([cipher.update(raw.subarray(28)), cipher.final()]).toString(),
  ) as CircleSession;
  if (
    !session ||
    typeof session.userToken !== "string" ||
    !session.userToken.length ||
    typeof session.encryptionKey !== "string" ||
    !session.encryptionKey.length ||
    !Number.isFinite(session.expiresAt) ||
    session.expiresAt <= now
  )
    throw Error("Circle session expired. Sign in again.");
  return session;
}
export function ownArcWallet(wallets: unknown, id: string) {
  const rows = wallets as {
    id: string;
    address: string;
    blockchain: string;
    accountType: string;
    state: string;
    custodyType?: string;
  }[];
  const wallet = rows.find(
    (w) =>
      w.id === id &&
      w.blockchain === "ARC" &&
      w.accountType === "EOA" &&
      w.state === "LIVE" &&
      w.custodyType === "ENDUSER",
  );
  if (!wallet || !/^0x[\da-f]{40}$/i.test(wallet.address))
    throw Error("This is not your active Arc user-controlled wallet.");
  return wallet;
}
