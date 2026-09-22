export type Connection = "connecting" | "live" | "stale" | "unavailable";
export function connectionAfterFailure(verifiedTransferCount: number): Connection {
  return verifiedTransferCount > 0 ? "stale" : "unavailable";
}
