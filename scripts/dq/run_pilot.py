#!/usr/bin/env python3
"""Bounded synthetic continuation driver; does not run Codex or arbitrary commands.

Use only newly enrolled synthetic sha256 tasks. The three gate actors below are
simulated mechanisms, never independent human/model acceptance evidence.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

_spec = importlib.util.spec_from_file_location("dq_pilot_queue", Path(__file__).with_name("queue.py"))
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
Queue, QueueError, canonical = _module.Queue, _module.QueueError, _module.canonical


def run(queue, source_sha, evidence_dir, limit=24):
    if not isinstance(limit, int) or not 1 <= limit <= 100:
        raise QueueError("bounded limit must be 1..100")
    output = Path(evidence_dir).resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    results = []
    for _ in range(limit):
        claim = queue.claim("synthetic-executor", lease_seconds=60)
        if not claim:
            break
        spec = claim["spec"]
        payload = spec["payload"]
        if spec["scope"] != "synthetic" or payload.get("operation") != "sha256" or not isinstance(payload.get("text"), str) or len(payload["text"]) > 65536:
            request = queue.stop(claim["task_id"])["requests"][0]
            receipt = {"receipt": "synthetic-driver:unsupported-operation-no-execution", "sha256": hashlib.sha256(b"unsupported").hexdigest(), "execution_terminated": True, "kind": "synthetic"}
            queue.confirm_stopped(claim["task_id"], request["stop_request"], "synthetic-driver", receipt)
            results.append({"task_id": claim["task_id"], "state": "STOPPED", "reason": "unsupported synthetic task"})
            break
        actual = hashlib.sha256(payload["text"].encode()).hexdigest()
        artifact = {"kind": "synthetic", "task_id": claim["task_id"], "attempt_id": claim["attempt_id"], "source_sha": source_sha, "actual": actual, "expected": payload.get("expected"), "exit_code": 0, "note": "Deterministic mechanism fixture; no model/QA/human approval."}
        path = output / (claim["attempt_id"] + ".json")
        raw = (canonical(artifact) + "\n").encode()
        with path.open("xb") as stream:
            stream.write(raw)
        receipt = {"receipt": str(path), "sha256": hashlib.sha256(raw).hexdigest(), "exit_code": 0, "kind": "synthetic"}
        queue.finish(claim, source_sha, receipt)
        state = None
        for role in ("qa", "security", "product"):
            verdict = "PASS" if actual == payload.get("expected") else "FAIL"
            state = queue.review(claim["task_id"], role, "synthetic-" + role, source_sha, verdict, receipt)
            if state["state"] == "REJECTED":
                break
        results.append(state)
        if state["state"] != "DONE":
            queue.pause()
            break
    return {"kind": "synthetic", "completed": sum(item["state"] == "DONE" for item in results), "results": results, "status": queue.status(), "limit": limit}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--evidence-dir", required=True)
    parser.add_argument("--limit", type=int, default=24)
    args = parser.parse_args()
    queue = None
    try:
        queue = Queue(args.db)
        print(canonical(run(queue, args.source_sha, args.evidence_dir, args.limit)))
        return 0
    except (QueueError, OSError) as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 2
    finally:
        if queue:
            queue.close()


if __name__ == "__main__":
    sys.exit(main())
