#!/usr/bin/env python3
"""Read-only Codex app-server discovery; no thread, turn, or model is started."""
import argparse
import json
from pathlib import Path
import queue
import subprocess
import threading
import time


def discover(root):
    root = root.resolve()
    command = ["codex", "--strict-config", "-C", str(root), "app-server", "--stdio",
               "-c", "features.apps=false", "-c", "features.plugins=false"]
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, text=True)
    incoming = queue.Queue()

    def receive():
        for line in process.stdout:
            try:
                incoming.put(json.loads(line))
            except ValueError:
                continue
        incoming.put({"transportClosed": True})

    reader = threading.Thread(target=receive, daemon=True)
    reader.start()

    def send(method, params, request_id=None):
        message = dict(method=method, params=params)
        if request_id is not None:
            message["id"] = request_id
        process.stdin.write(json.dumps(message) + "\n")
        process.stdin.flush()

    def response(request_id):
        end = time.monotonic() + 30
        while time.monotonic() < end:
            message = incoming.get(timeout=max(0.01, end-time.monotonic()))
            if message.get("transportClosed"):
                raise RuntimeError("app-server closed before discovery completed")
            if message.get("id") == request_id:
                if "error" in message:
                    raise RuntimeError("discovery RPC failed: " + str(message["error"].get("code")))
                return message["result"]
        raise RuntimeError("discovery timeout")

    try:
        send("initialize", {"clientInfo": {"name": "dq_pilot_discovery", "version": "0.1.0"}}, 1)
        initialize = response(1)
        send("initialized", {})
        send("skills/list", {"cwds": [str(root)], "forceReload": True}, 2)
        skills = response(2)
        send("config/read", {"cwd": str(root), "includeLayers": True}, 3)
        config = response(3)
        items = [s for entry in skills.get("data", []) for s in entry.get("skills", [])
                 if s.get("name", "").startswith("dq-")]
        project_layers = []
        for layer in config.get("layers") or []:
            # Return only this known configuration block, never user credentials/MCP config.
            layer_config = layer.get("config", {})
            source = layer.get("name", {})
            if (isinstance(layer_config, dict) and "agents" in layer_config
                    and source.get("type") == "project"
                    and Path(source.get("dotCodexFolder", "")).resolve() == root / ".codex"):
                project_layers.append({"source": ".codex/config.toml", "agents": layer_config["agents"],
                                       "disabledReason": layer.get("disabledReason")})
        return {"kind": "native-discovery-no-model", "root": str(root),
                "app_server": {k: initialize[k] for k in ("platformFamily", "platformOs") if k in initialize},
                "skills": [{k: s.get(k) for k in ("name", "path", "enabled", "scope")} for s in items],
                "skill_errors": [e for entry in skills.get("data", []) for e in entry.get("errors", [])
                                 if "dq-" in str(e)],
                "agent_layers": project_layers,
                "note": "Discovery is not agent invocation or behavioral acceptance."}
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        process.stdin.close()
        process.stdout.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    result = discover(args.root)
    manifest = json.loads((args.root / ".codex/dq-team.json").read_text())
    expected = {item["name"]: str((args.root / item["path"]).resolve()) for item in manifest["skills"]}
    discovered = result["skills"]
    exact_skills = (len(discovered) == 24 and {s["name"] for s in discovered} == set(expected)
                    and all(s["enabled"] is True and s["scope"] == "repo"
                            and str(Path(s["path"]).resolve()) == expected[s["name"]] for s in discovered))
    project_config = any(layer["disabledReason"] is None
                         and layer["agents"].get("enabled") is True
                         and layer["agents"].get("max_concurrent_threads_per_session") == 3
                         for layer in result["agent_layers"])
    result["validation"] = {"exact_enabled_repo_skills": exact_skills,
                            "project_agent_layer_enabled_cap_3": project_config}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if exact_skills and project_config and not result["skill_errors"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
