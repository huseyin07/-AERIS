"""Package the audited local runner without credentials or private journals."""
import json
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
files = ["scripts/circle-pay.ts", "src/payments/core.ts", "src/payments/circle-signer.ts", "src/payments/journal.ts", "src/circle/wallet-validation.ts"]
package = {"name": "aeris-circle-runner", "version": "1.0.0", "private": True, "type": "module", "scripts": {"circle:pay": "node --import tsx scripts/circle-pay.ts"}, "dependencies": {"viem": "2.57.2", "tsx": "4.23.15"}, "engines": {"node": ">=22"}}
target = root / "public/aeris-circle-runner.zip"
with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    entries = {p: (root / p).read_bytes() for p in files}
    entries["package.json"] = (json.dumps(package, indent=2) + "\n").encode()
    entries["README.md"] = (root / "docs/circle-payments.md").read_bytes()
    for path, content in sorted(entries.items()):
        info = zipfile.ZipInfo("aeris-circle-runner/" + path, (2026, 10, 8, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, content)
print(f"Packaged {len(entries)} non-secret files: {target.name}")
