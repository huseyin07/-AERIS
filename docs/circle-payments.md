# Circle invoice payments on Arc

AERIS now has an invoice workbench at `/payments` and an operator-owned Circle payment runner. This is a real signing/broadcasting implementation, not a simulated transaction. An actual mainnet settlement has not yet been demonstrated: the treasury was funded with 0.3 USDC on 8 October 2026, but the operator cancelled the live payment demonstration. Do not claim the live payment milestone complete until a matching receipt is verified.

The workbench also prioritizes due invoices against the verified balance, maximum gas allowance and reserve, and exports its decision evidence. This estimate excludes earlier local-journal reservations; the runner rechecks those before any signature.

## Business flow

1. Save an invoice: vendor address, stable invoice reference, exact USDC amount, due date and purpose.
2. Download the operator policy. Only saved vendors enter its allowlist. Defaults require approval for every payment; optional automation applies below the saved approval threshold.
3. Run the agent locally. It verifies Circle wallet identity and Arc chain/head, checks due date, allowlist, liquidity, reserve, maximum payment, maximum gas and the persistent daily budget including fees. It holds invoices that fail those checks.
4. Circle signs an EIP-1559 transaction through its EVM signing API. The runner verifies the signature's signer and exact transaction before broadcasting to Arc. No signing credentials go to AERIS's public website or Vercel.
5. The runner requires a successful canonical receipt, two block confirmations and exactly matching native USDC Transfer evidence. Paste its transaction hash into the invoice workbench for independent server-side verification against the configured Circle payer.

The workbench is public and browser-local. It is not a user-custody product, a wallet-connect interface or authority to spend the operator's funds. The local journal is the authority for invoice identity and budget reservations. Receipt verification proves the exact transfer; it does not put the offchain invoice reference onchain or prove the vendor delivered a service.

## Mac setup

On `/payments`, add an invoice, download `policy.json` and `invoice.json`, and download/extract `aeris-circle-runner.zip`. With Node.js 22 installed:

```sh
cd ~/Downloads/aeris-circle-runner
npm install
npm run circle:pay -- configure ~/Downloads/policy.json
npm run circle:pay -- pay ~/Downloads/invoice.json
```

The first command displays the policy and requires `SAVE`. The payment command is a preview: it signs nothing and broadcasts nothing. It privately prompts for the **new** mainnet API key, including `LIVE_API_KEY:`. Do not paste credentials into chat. The leaked, replaced key must not be reused.

Fund the verified treasury wallet on **Arc Mainnet 5042**, including enough USDC for payment, gas and the configured reserve. For an approved payment:

```sh
npm run circle:pay -- pay ~/Downloads/invoice.json --execute
```

The runner shows the recipient, amount, maximum fee and decision. If approval is required, type the exact `PAY INV-001` phrase shown, using your actual invoice reference. Enter the already registered Entity Secret at the hidden prompt. No credentials are saved by the runner.

With auto-pay explicitly enabled in the locally saved policy, due invoices within the approval threshold are signed after the checks without an additional approval prompt. Launching the runner is still an operator action; there is no background scheduler in this release.

## Persistence and recovery

The default state directory is `~/.aeris-payments`, outside the repository. Keep **one persistent journal and one runner** for this dedicated wallet. Using independent directories or computers bypasses the journal's shared budget/duplicate checks. External payments are outside its accounting. Do not reset or delete the journal to retry a payment.

- File locking prevents simultaneous local execution. An interrupted process can leave `execution.lock`; verify no runner remains active and inspect `journal.json` before manually removing the lock.
- Vendor address + invoice reference is a durable invoice key. Changed amount/purpose/due date under the same key is rejected.
- The journal reserves amount and maximum gas before signing. Pending reservations remain counted across UTC day boundaries. Confirmed/reverted reservations remain charged on their original day; reverted invoices require manual reconciliation.
- The unsigned transaction and nonce are fixed before signing. Signed bytes and their transaction hash are fsynced before broadcast. An ambiguous broadcast or timeout never creates a new nonce or payment.
- Re-running the same invoice reconciles the same hash or re-broadcasts identical signed bytes. Confirmed invoices are never paid again. If external activity consumes the nonce, execution stops for manual reconciliation.
- Emergency stop blocks new signing and re-broadcasting. It cannot cancel an already broadcast transaction. Receipt reconciliation remains possible.
- Fee replacement, automatic cancellation and cross-device coordination are not implemented. A transaction stuck because its fee became too low must be reviewed, not recreated under another invoice reference.

## Verification and competition evidence

`npm run test:payments` covers exact amounts, policy holds, reserved fee budgets, receipt mismatches/reverts/reorgs, persistent invoice identity, concurrency locks and signer/transaction mismatch rejection.

For the Tameion demo, show one real invoice from preparation through agent policy decision, Circle signing, Arc settlement and journal/evidence verification. Report actual payment volume and no invented customers. Local policy limits are enforced by the runner, not by a deployed smart contract. This narrower invoice workflow does not claim all autonomous treasury features in the RFBs.

References: [Tameion](https://tameion.thecanteenapp.com/), [Circle signing API](https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/sign-transaction), [Circle entity-secret encryption](https://github.com/circlefin/w3s-entity-secret-sample-code).

## Invoice workspace — 9 October 2026

Payments follows Add invoice → Review decision → Verify payment. Spending limits and runner commands expand on demand. Operator limits are retained in browser storage, including an explicit pause flag. Changes to browser settings do not modify the configured local runner: download and configure the new policy to enforce them.

Import one invoice JSON or restore a `version: 1` backup with an `invoices` array. Imports validate exact amounts, network, recipient, duplicate vendor references and stored transaction hashes. Imported receipts are always unverified until checked against Arc. A backup is portable invoice data, not a copy of the local runner journal. Never use it to reset spending history.

After a receipt passes the server's canonical Arc checks, download the invoice and settlement evidence together. A transaction hash, screenshot or imported `verified` field cannot mark an invoice settled. The liquidity plan excludes only receipts verified in the current session.
