"""Foreground-only loopback pilot, with isolated state and no host model credentials."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("--runtime", required=True, help="Installed paperclipai executable")
parser.add_argument("--state", required=True, help="New dedicated pilot state directory")
parser.add_argument("--port", type=int, default=43100)
args = parser.parse_args()
runtime = Path(args.runtime).resolve(strict=True)
package = json.loads((runtime.parent.parent / "package.json").read_text())
if package.get("name") != "paperclipai" or package.get("version") != "2026.1023.0":
    parser.error("Only the reviewed paperclipai 2026.1023.0 runtime is accepted")
state = Path(args.state).resolve()
if not 1024 <= args.port <= 65535:
    parser.error("Use an unprivileged local port")
state.mkdir(mode=0o700, parents=True, exist_ok=True)
marker = state / ".mengine-paperclip-pilot-100"
if not marker.exists() and any(state.iterdir()):
    parser.error("Refusing an existing non-pilot state directory")
marker.touch(mode=0o600)
with socket.socket() as sock:
    sock.bind(("127.0.0.1", args.port))
env = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "LANG") if key in os.environ}
env.update({
    "PAPERCLIP_HOME": str(state), "PAPERCLIP_INSTANCE_ID": "default",
    "CODEX_HOME": str(state / "uncredentialed-codex-home"),
    "OPENAI_API_KEY": "", "ANTHROPIC_API_KEY": "",
    "HEARTBEAT_SCHEDULER_ENABLED": "false", "PAPERCLIP_NO_BROWSER": "true",
    "PAPERCLIP_ANNOUNCEMENTS_ENABLED": "false",
    "PAPERCLIP_TELEMETRY_DISABLED": "1", "DO_NOT_TRACK": "1",
    "PORT": str(args.port), "HOST": "127.0.0.1",
})
(state / "uncredentialed-codex-home").mkdir(mode=0o700, exist_ok=True)
config = state / "instances/default/config.json"
command = [str(runtime), "run", "--data-dir", str(state), "--no-repair"] if config.exists() else [
    str(runtime), "onboard", "--data-dir", str(state), "--bind", "loopback",
    "--yes", "--no-install-service",
]
try:
    raise SystemExit(subprocess.call(command, env=env))
except KeyboardInterrupt:
    raise SystemExit(130)
