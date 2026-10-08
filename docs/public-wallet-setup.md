# Public wallet rollout

`/payments` is for each visitor's own Arc wallet. `/payments/operator` is the separate Circle treasury runner. `/payments/circle` implements email login and per-user Circle wallets, but stays unavailable until deployment configuration is complete. No live transfer was executed for this release.

## Mobile QR connection

Create an AERIS project in the [Reown dashboard](https://dashboard.reown.com/), allow `https://aeris-two-eosin.vercel.app`, and save its 32-character Project ID as `WALLETCONNECT_PROJECT_ID` in Vercel Production. This ID is public, not the Circle API key. Redeploy. The mobile QR button appears only when the ID validates. WalletConnect uses Arc chain 5042, a custom pairing QR, explicit network selection and separate wallet transfer approval. Mobile wallet browsers remain usable without this configuration.

## Circle email wallets

1. In Circle Console, select Mainnet → Wallets → User Controlled → Configurator. Copy the application ID into Vercel Production `CIRCLE_USER_APP_ID`.
2. Configure production SMTP email delivery in Circle's email-authentication settings. Verify actual inbox delivery. A sandbox inbox does not make login available to public users.
3. Keep `CIRCLE_API_KEY` server-only. `CIRCLE_USER_SESSION_KEY` is a server-only 32-byte encryption key already provisioned for this project; never expose it in the browser or share it in chat.
4. Configure production abuse protection for `POST /api/circle-user/otp`, including a distributed per-IP rate limit at the hosting firewall. The route's in-memory limit is a supplemental per-instance guard, not a distributed limiter. Add monitoring for OTP delivery failures.
5. Once app ID, email delivery and abuse controls are configured, set `CIRCLE_USER_EMAIL_READY=true` and redeploy. Until then both the UI and API refuse onboarding.
6. Verify email login, existing-session restoration, user-owned wallet selection, new-user initialization and adding Arc to an already initialized user. Verify that foreign-wallet requests are rejected. A transfer acceptance test remains explicitly excluded by the owner's instruction; this release cannot claim an observed live user-controlled payment.

Sessions are encrypted, authenticated, expiring, Secure/HttpOnly/SameSite=Strict cookies. The browser SDK necessarily receives the user's short-lived authentication material in memory to run Circle's hosted approval; it is not placed in local storage, history backups or logs. No developer Entity Secret is used for this path. Server wallet lookups are scoped to the logged-in Circle user; the treasury is excluded. Session lifetime is 50 minutes; sign in again afterwards.

## History and pending transactions

On connection, the app reads direct outgoing ERC-20 USDC transfers from Arc in 4,096-block pages, at most 40 candidate transactions per response. Loading older pages is explicit; there is no full-history indexer or private-note cloud database. Download/import backups restores private notes, limited to 500 validated records / 12 MB. Imported status fields are discarded. Receipts are rechecked against the chain.

Browser requests are saved before approval and never silently resubmitted. Pending, confirming and unknown outcomes receive bounded read-only polling. Speed-up/cancellation is performed in the connected wallet; Circle wallets additionally expose user-approved challenges. A replacement or cancellation hash must match the original sender and nonce. When an exact pending transfer is observed, the server signs a seven-day nonce proof that can travel in the backup. This allows safe replacement checking if RPC has dropped the original hash. Without a valid proof or retrievable original, the app cannot prove replacement and does not release the request. Confirmed failed/cancelled outcomes can release the saved intent; an unknown transaction cannot.

## Release evidence

Automated tests cover backup conflict/owner checks, untrusted status stripping, encrypted-session tampering and expiry, Circle wallet ownership, exact transfer construction and no retry after user rejection. A successful build or unit test does not prove a live financial settlement. Genuine Circle receipts and business usage must be supplied from an actually authorized payment and real user feedback, never fabricated for an application.

Release verification: Next.js 15.5.27, production build and 131 tests passed. `npm audit --omit=dev` reports zero production advisories at this check. Build-tool pattern-matching advisories remain in the legacy Tailwind/ESLint dependency chain; the available registry version of braces is still affected. These are not represented as fixed by the production audit.
