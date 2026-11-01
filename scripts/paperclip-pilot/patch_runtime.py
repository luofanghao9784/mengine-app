"""Check/apply/revert only the hash-pinned local Paperclip recovery patch."""
import argparse
import hashlib
import json
from pathlib import Path
import socket
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("--runtime", required=True)
action = parser.add_mutually_exclusive_group()
action.add_argument("--apply", action="store_true")
action.add_argument("--revert", action="store_true")
args = parser.parse_args()
runtime = Path(args.runtime).resolve(strict=True)
package = json.loads((runtime / "node_modules/paperclipai/package.json").read_text())
if package.get("version") != "2026.1023.0":
    parser.error("Unsupported runtime version")
patches = Path(__file__).resolve().parents[2] / "config/paperclip-pilot/patches"
manifest = json.loads((patches / "manifest.json").read_text())
records = [r for r in manifest["files"] if "/dist/" in r["file"]]
package_root = runtime / "node_modules/@paperclipai"
states = []
for record in records:
    target = (package_root / record["file"]).resolve(strict=True)
    if not target.is_relative_to(package_root.resolve()):
        parser.error("Patch target escaped runtime")
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    if digest == record["beforeSha256"]:
        states.append("original")
    elif digest == record["afterSha256"]:
        states.append("patched")
    else:
        parser.error("Unknown runtime content; refusing to overwrite it")
if len(set(states)) != 1:
    parser.error("Mixed patch state; manual reconciliation required")
current = states[0]
if not args.apply and not args.revert:
    print("Verified recovery module state:", current)
    raise SystemExit(0)
desired = "original" if args.revert else "patched"
if current == desired:
    print("Already in requested state:", desired)
    raise SystemExit(0)
with socket.socket() as sock:
    sock.settimeout(1)
    if sock.connect_ex(("127.0.0.1", 43100)) == 0:
        parser.error("Stop the dedicated pilot before changing its runtime")
command = ["/usr/bin/patch", "--batch", "-p1", "-i", str(patches / "runtime.patch")]
command.append("--reverse" if args.revert else "--forward")
subprocess.run(command, cwd=package_root, check=True)
for record in records:
    digest = hashlib.sha256((package_root / record["file"]).read_bytes()).hexdigest()
    expected = record["beforeSha256"] if args.revert else record["afterSha256"]
    if digest != expected:
        raise RuntimeError("Patch verification failed; do not start the runtime")
print("Verified requested recovery module state:", desired)
