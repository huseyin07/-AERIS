// Read-only checks of the exact deployment supplied by the operator.
const target = process.argv[2];
if (!target) throw new Error("Usage: npm run verify:release -- https://deployment.example [--require-circle]");
const base = new URL(target);
if (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1") throw new Error("Use HTTPS for deployed sites.");
const requireCircle = process.argv.includes("--require-circle");
async function fetchPath(path) {
  const response = await fetch(new URL(path, base), {signal: AbortSignal.timeout(30_000), redirect: "error", headers: {"Cache-Control": "no-cache"}});
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
}
const results = await Promise.allSettled([
  (async () => {
    const page = await (await fetchPath("/")).text();
    if (!page.includes("AERIS")) throw new Error("Dashboard identity missing");
    return "Dashboard reachable";
  })(),
  (async () => {
    const page = await (await fetchPath("/about")).text();
    if (!page.includes("Product &amp; evidence") && !page.includes("PRODUCT &amp; EVIDENCE")) throw new Error("Product evidence page missing");
    return "Product evidence page reachable";
  })(),
  (async () => {
    const page = await (await fetchPath("/payments")).text();
    if (!page.includes("Your wallet. Your transfer.") || !page.includes("Connect your wallet")) throw new Error("Public transfer workspace missing");
    const operator = await (await fetchPath("/payments/operator")).text();
    if (!operator.includes("Agent liquidity plan")) throw new Error("Circle operator tools missing");
    const archive = new Uint8Array(await (await fetchPath("/aeris-circle-runner.zip")).arrayBuffer());
    if (archive.length < 1000 || archive[0] !== 80 || archive[1] !== 75) throw new Error("Circle runner download is invalid");
    return "Public transfers, Circle operator tools and runner download reachable";
  })(),
  (async () => {
    const data = await (await fetchPath("/api/activity")).json();
    if (data.chainId !== 5042 || data.status !== "ok" || data.windowCovered !== true || data.headStale !== false || data.headFutureSkewed !== false) throw new Error("Arc observation is unhealthy or incomplete");
    if (!Number.isFinite(data.fetchedAt) || Math.abs(Date.now() - data.fetchedAt) > 120_000) throw new Error("Observation response is stale");
    if (!Number.isFinite(data.headAgeMs) || data.headAgeMs > 120_000 || data.headAgeMs < -30_000) throw new Error("Arc head is not current");
    if (!Array.isArray(data.events) || !Array.isArray(data.transfers)) throw new Error("Activity evidence missing");
    return `Arc 5042 healthy · block ${data.latestBlock} · ${data.transfers.length} observed transfers`;
  })(),
  (async () => {
    const data = await (await fetchPath("/api/agent-wallet")).json();
    if (data.chainId !== 5042 || data.execution !== "disabled") throw new Error("Unexpected wallet network or execution status");
    if (data.status === "not-configured" && !requireCircle) return "Circle setup pending · required before claiming live Circle integration";
    if (data.status !== "verified" || !/^0x[\da-f]{40}$/i.test(data.address ?? "") || !/^\d+(\.\d+)?$/.test(data.balanceUsdc ?? "") || !/^\d+$/.test(data.blockNumber ?? "")) throw new Error("Circle wallet has no verified balance evidence");
    if (!Number.isFinite(data.checkedAt) || Math.abs(Date.now() - data.checkedAt) > 120_000) throw new Error("Circle wallet evidence is stale");
    return `Circle wallet verified at Arc block ${data.blockNumber}`;
  })(),
]);
let failed = false;
for (const result of results) {
  if (result.status === "fulfilled") console.log(`PASS ${result.value}`);
  else {failed = true; console.error(`FAIL ${result.reason.message}`);}
}
process.exitCode = failed ? 1 : 0;
