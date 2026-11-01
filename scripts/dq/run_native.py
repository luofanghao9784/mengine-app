#!/usr/bin/env python3
"""Explicit, bounded, read-only Codex pilot review bridge. Never marks gates PASS.

Requires an Issue #99-enabled pilot queue and --execute. No service installation,
business task, arbitrary command, deployment, or automatic UNKNOWN replay.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

_spec = importlib.util.spec_from_file_location("dq_native_queue", Path(__file__).with_name("queue.py"))
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
Queue, QueueError, canonical = _module.Queue, _module.QueueError, _module.canonical

SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["pass", "findings", "skills_loaded", "evidence_note"],
    "properties": {
        "pass": {"type": "boolean"},
        "findings": {"type": "array", "items": {"type": "string"}},
        "skills_loaded": {"type": "array", "items": {"type": "string"}},
        "evidence_note": {"type": "string"},
    },
}


def private_write(path, raw):
    fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(raw)


def validate_workspace(root):
    root = Path(root).resolve()
    if not (root / ".git").is_file():
        raise QueueError("native pilot requires an isolated Git worktree (.git file)")
    # --ignore-user-config excludes user MCP. Reject project MCP inheritance too.
    config = root / ".codex/config.toml"
    if config.exists() and re.search(r"mcp_servers|mcpServer", config.read_text()):
        raise QueueError("project MCP configuration is unsupported by read-only pilot")
    return root


def build_command(codex, root, schema_path, last_message):
    return [codex, "exec", "--ignore-user-config", "--strict-config", "--sandbox", "read-only",
            "--model", "gpt-6.1-sol", "-c", 'model_reasoning_effort="medium"',
            "-c", "features.apps=false", "-c", "features.plugins=false",
            "-c", "features.memories=false", "-c", 'approval_policy="never"',
            # Three queue slots, each with one execution child: no 3x3 fanout.
            "-c", "agents.max_concurrent_threads_per_session=1",
            "-C", str(root), "--json", "--output-schema", str(schema_path),
            "-o", str(last_message), "-"]


def make_prompt(root, payload):
    root = Path(root).resolve()
    if payload.get("operation") != "review-dq-pilot":
        raise QueueError("only review-dq-pilot operation is supported")
    role = payload.get("role")
    skills = payload.get("skills")
    if not isinstance(role, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", role):
        raise QueueError("invalid native role")
    manifest = json.loads((root / ".codex/dq-team.json").read_text())
    candidates = [item for item in manifest["roles"] if item.get("name") == role or Path(item.get("path", "")).stem == role]
    if len(candidates) != 1:
        raise QueueError("configured native role not found or ambiguous")
    role_entry = candidates[0]
    agent = (root / role_entry["path"]).resolve()
    if not agent.is_file() or not agent.is_relative_to(root / ".codex/agents"):
        raise QueueError("configured native role file missing or outside worktree")
    # TOML file stems use hyphens; Codex dispatches the actual name field.
    configured_name = re.search(r'^name\s*=\s*"([a-z][a-z0-9_-]{0,63})"\s*$', agent.read_text(), re.MULTILINE)
    if not configured_name:
        raise QueueError("configured native name is missing or unsupported")
    role = configured_name.group(1)
    if role != role_entry.get("name"):
        raise QueueError("manifest and native role name disagree")
    if not isinstance(skills, list) or not 1 <= len(skills) <= 24 or len(set(skills)) != len(skills):
        raise QueueError("1..24 unique pilot skills required")
    paths = []
    for skill in skills:
        if not isinstance(skill, str) or not re.fullmatch(r"dq-[a-z0-9-]+", skill):
            raise QueueError("invalid pilot skill")
        path = root / ".agents/skills" / skill / "SKILL.md"
        if not path.is_file() or not path.resolve().is_relative_to(root):
            raise QueueError("pilot skill missing or outside worktree")
        paths.append(str(path))
    return """Issue #99 isolated-pilot authorization applies ONLY to read-only team/skill/scheduler review.
Business development remains PAUSED. Do not enrol or replay historical tasks, run business services,
write files, access production, use external connectors, install anything, or use Git mutation.
Use exactly ONE native subagent with configured role %s. Ask that subagent to load these skill files:
%s
Apply each skill to the concrete pilot queue/native driver and its synthetic tests under scripts/dq and tests/dq.
Read source and existing evidence; report at least one concrete decision or finding per skill in evidence_note.
Do not create findings merely to satisfy a count. An unavailable/misloaded skill must be reported.
Return JSON matching the provided schema. Model self-report is not independent acceptance;
actual native collaboration tool events are separately inspected. Do not claim human/CI approval.
""" % (role, "\n".join(paths))


def observed_collaboration(log_path):
    """Only explicit observable native collaboration tool items, not prose self-report."""
    found = []
    for line in Path(log_path).read_text(errors="replace").splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        item = event.get("item", {})
        child_ids = item.get("receiver_thread_ids", item.get("receiver_agent_ids", [])) if isinstance(item, dict) else []
        if event.get("type") == "item.completed" and isinstance(item, dict) and item.get("type") in ("collab_tool_call", "collaboration_tool_call") and item.get("tool") == "spawn_agent" and item.get("status") == "completed" and isinstance(child_ids, list) and child_ids and all(isinstance(child, str) and child for child in child_ids):
            found.append(item)
    return found


def native_started(log_path):
    """Any observable native start means local CLI exit cannot prove remote stop."""
    if not Path(log_path).exists():
        return False
    for line in Path(log_path).read_text(errors="replace").splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if isinstance(event, dict) and (event.get("type") in ("thread.started", "turn.started") or event.get("type", "").startswith("item.")):
            return True
    return False


def native_lifecycle(log_path):
    """Track explicit child terminal observations and root turn completion."""
    spawned, terminal = set(), set()
    turn_completed = False
    for line in Path(log_path).read_text(errors="replace").splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        if event.get("type") == "turn.started":
            turn_completed = False
        elif event.get("type") == "turn.completed":
            turn_completed = True
        item = event.get("item", {})
        if event.get("type") != "item.completed" or not isinstance(item, dict) or item.get("type") not in ("collab_tool_call", "collaboration_tool_call") or item.get("status") != "completed":
            continue
        ids = item.get("receiver_thread_ids", item.get("receiver_agent_ids", []))
        if item.get("tool") == "spawn_agent" and isinstance(ids, list):
            spawned.update(child for child in ids if isinstance(child, str) and child)
        if item.get("tool") in ("followup_task", "send_input", "resume_agent") and isinstance(ids, list):
            # Reusing a child thread starts a new execution; old completion is stale.
            terminal.difference_update(ids)
        states = item.get("agents_states", {})
        if isinstance(states, dict):
            for child, state in states.items():
                if isinstance(state, dict) and state.get("status") in ("completed", "errored", "shutdown"):
                    terminal.add(child)
                else:
                    terminal.discard(child)
    return {"turn_completed": turn_completed, "spawned_child_ids": sorted(spawned), "terminal_child_ids": sorted(terminal), "all_observed_children_terminal": spawned.issubset(terminal)}


def verify_source(root, source_sha):
    """Bind evidence to a clean, non-main actual worktree HEAD."""
    def git(*args):
        result = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, timeout=10)
        if result.returncode:
            raise QueueError("cannot verify isolated source: " + result.stderr.strip())
        return result.stdout.strip()
    if git("rev-parse", "--show-toplevel") != str(root):
        raise QueueError("worktree source root mismatch")
    if git("branch", "--show-current") in ("main", "master", ""):
        raise QueueError("native pilot requires a named non-main task branch")
    if git("rev-parse", "HEAD") != source_sha:
        raise QueueError("source SHA does not match worktree HEAD")
    if git("status", "--porcelain", "--untracked-files=all"):
        raise QueueError("native evidence requires clean committed source")


def terminate_group(process):
    """Confirm leader exit and disappearance of its local process group.

    This cannot attest termination of remote hosted work or detached sessions.
    """
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            return False
    # A leader can exit before its children. Kill and observe the entire group.
    try:
        os.killpg(process.pid, 0)
    except ProcessLookupError:
        return True
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        return True
    deadline = time.monotonic() + 1
    while time.monotonic() < deadline:
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            return True
        time.sleep(0.05)
    return False


def run(queue, root, source_sha, evidence_dir, codex="codex", limit=1, timeout=180, execute=False):
    if execute is not True:
        raise QueueError("native execution requires explicit --execute")
    root = validate_workspace(root)
    if not re.fullmatch(r"[0-9a-f]{40}", source_sha):
        raise QueueError("exact source SHA required")
    verify_source(root, source_sha)
    if not isinstance(limit, int) or not 1 <= limit <= 24 or not 1 <= timeout <= 3000:
        raise QueueError("limit 1..24 and timeout 1..3000 required")
    output = Path(evidence_dir).resolve()
    if output == root or not output.is_relative_to(root / ".local"):
        raise QueueError("native evidence must be inside this worktree .local")
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    results = []
    for _ in range(limit):
        claim = queue.claim("native-review-driver", lease_seconds=timeout + 30, operation="review-dq-pilot")
        if not claim:
            break
        attempt_dir = output / claim["attempt_id"]
        attempt_dir.mkdir(mode=0o700)
        schema_path = attempt_dir / "output-schema.json"
        private_write(schema_path, (canonical(SCHEMA) + "\n").encode())
        stdout_path, stderr_path = attempt_dir / "events.jsonl", attempt_dir / "stderr.txt"
        last_message = attempt_dir / "last-message.json"
        process = None
        reason = None
        try:
            prompt = make_prompt(root, claim["spec"]["payload"])
            private_write(attempt_dir / "prompt.txt", prompt.encode())
            # Never shell=True and no payload-derived executable/flags.
            stdout_fd = os.open(str(stdout_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            stderr_fd = os.open(str(stderr_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(stdout_fd, "wb") as stdout, os.fdopen(stderr_fd, "wb") as stderr:
                process = subprocess.Popen(build_command(codex, root, schema_path, last_message), stdin=subprocess.PIPE, stdout=stdout, stderr=stderr, cwd=root, start_new_session=True)
                process.stdin.write(prompt.encode())
                process.stdin.close()
                deadline = time.monotonic() + timeout
                while process.poll() is None:
                    if time.monotonic() >= deadline:
                        reason = "timeout"
                        break
                    if stdout_path.stat().st_size + stderr_path.stat().st_size > 16 * 1024 * 1024:
                        reason = "output-limit"
                        break
                    # A DQ stop from another process fences this native execution.
                    task = next(t for t in queue.status()["tasks"] if t["id"] == claim["task_id"])
                    if task["state"] != "RUNNING":
                        reason = "stop-observed"
                        break
                    time.sleep(0.05)
                if reason is None and process.wait() != 0:
                    reason = "codex-nonzero"
            if reason is None:
                result = json.loads(last_message.read_text())
                if not isinstance(result, dict) or not isinstance(result.get("pass"), bool) or not isinstance(result.get("findings"), list) or not isinstance(result.get("skills_loaded"), list) or not isinstance(result.get("evidence_note"), str):
                    raise QueueError("invalid native structured result")
                observed = observed_collaboration(stdout_path)
                lifecycle = native_lifecycle(stdout_path)
                if not lifecycle["turn_completed"] or not lifecycle["all_observed_children_terminal"]:
                    raise QueueError("native root/child terminal observation missing")
                report = {"kind": "real", "category": "native-review-execution", "source_sha": source_sha, "task_id": claim["task_id"], "attempt_id": claim["attempt_id"], "exit_code": 0, "model_output": result, "native_spawn_events": len(observed), "native_subagent_observed": bool(observed), "lifecycle": lifecycle, "human_approval": False, "ci_approval": False}
                receipt_path = attempt_dir / "execution-receipt.json"
                raw = (canonical(report) + "\n").encode()
                private_write(receipt_path, raw)
                queue.finish(claim, source_sha, {"receipt": str(receipt_path), "sha256": hashlib.sha256(raw).hexdigest(), "exit_code": 0, "kind": "real", "category": "native-review-execution"})
                results.append({"task_id": claim["task_id"], "state": "REVIEW", "native_subagent_observed": bool(observed), "receipt": str(receipt_path)})
                continue
        except KeyboardInterrupt:
            reason = "interrupted"
        except (OSError, ValueError, QueueError) as exc:
            reason = "execution-error:" + str(exc)
        # Every unsuccessful attempt pauses dispatch and requires positive exit observation.
        stopped = queue.stop(claim["task_id"])
        local_confirmed = process is None or terminate_group(process)
        remote_started = native_started(stdout_path)
        confirmed = process is None
        raw = (canonical({"reason": reason, "local_process_terminated": local_confirmed, "native_start_observed": remote_started, "native_execution_terminated": confirmed, "execution_terminated": confirmed, "pid": process.pid if process else None, "exit_code": process.returncode if process else None, "kind": "real", "note": "Only Popen failure proves never-started. Local process exit or missing events cannot prove hosted execution stopped."}) + "\n").encode()
        stop_path = attempt_dir / "stop-receipt.json"
        private_write(stop_path, raw)
        pending = stopped["requests"]
        if not pending:
            row = queue.db.execute("SELECT stop_request FROM attempt WHERE id=? AND state='STOPPING'", (claim["attempt_id"],)).fetchone()
            pending = [{"stop_request": row[0]}] if row else []
        if confirmed and pending:
            queue.confirm_stopped(claim["task_id"], pending[0]["stop_request"], "native-driver-wait", {"receipt": str(stop_path), "sha256": hashlib.sha256(raw).hexdigest(), "execution_terminated": True})
        else:
            # Do not fabricate an immediate UNKNOWN before lease; occupied until recover.
            queue.recover()
        results.append({"task_id": claim["task_id"], "reason": reason, "termination_confirmed": confirmed, "state": next(t["state"] for t in queue.status()["tasks"] if t["id"] == claim["task_id"])})
        break
    return {"kind": "real-native-driver", "results": results, "status": queue.status(), "note": "Execution receipts only; QA/security/product and external PR gates remain separate."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True)
    parser.add_argument("--worktree", required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--evidence-dir", required=True)
    parser.add_argument("--limit", type=int, default=1)
    parser.add_argument("--timeout", type=float, default=180)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    queue = None
    try:
        queue = Queue(args.db)
        report = run(queue, args.worktree, args.source_sha, args.evidence_dir, limit=args.limit, timeout=args.timeout, execute=args.execute)
        report["execution_attempted"] = bool(report["results"])
        report["execution_succeeded"] = bool(report["results"]) and all(item["state"] == "REVIEW" for item in report["results"])
        print(canonical(report))
        return 3 if any(item["state"] != "REVIEW" for item in report["results"]) else 0
    except (QueueError, OSError, ValueError) as exc:
        print(canonical({"error": str(exc)}), file=sys.stderr)
        return 2
    finally:
        if queue:
            queue.close()


if __name__ == "__main__":
    sys.exit(main())
