#!/usr/bin/env python3
"""Explicit bounded native pilot supervisor; waits across independent review gates.

No background installation or business resume. While this process is running,
new eligible pilot work is selected without asking the user to send 'continue'.
"""
import argparse
import importlib.util
from pathlib import Path
import sys
import time

spec = importlib.util.spec_from_file_location("dq_watch_native", Path(__file__).with_name("run_native.py"))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


def watch(queue, root, source_sha, evidence_dir, duration=300, limit=24, timeout=180,
          poll_seconds=0.5, execute=False, runner=None):
    if execute is not True:
        raise native.QueueError("watch requires explicit --execute")
    if not 0 < duration <= 3600 or not 1 <= limit <= 24 or not 0.05 <= poll_seconds <= 5:
        raise native.QueueError("bounded duration 0..3600, limit 1..24, poll 0.05..5 required")
    if not 1 <= timeout <= 3000:
        raise native.QueueError("task timeout must be 1..3000")
    runner = runner or native.run
    deadline = time.monotonic() + duration
    results = []
    reason = "window-ended"
    while time.monotonic() < deadline:
        state = queue.recover()
        if state["mode"] != "PILOT":
            reason = "paused-or-unresolved"
            break
        if len(results) >= limit:
            reason = "task-limit"
            break
        remaining = deadline - time.monotonic()
        if remaining < 1:
            break
        attempt = runner(queue, root, source_sha, evidence_dir, limit=1,
                         timeout=min(timeout, remaining), execute=True)
        results.extend(attempt["results"])
        if any(item["state"] != "REVIEW" for item in attempt["results"]):
            reason = "execution-needs-reconciliation"
            break
        # Empty Ready set may mean a reviewer is still working. Stay alive in
        # the authorized window, never mark those gates on the runner's behalf.
        if not attempt["results"]:
            time.sleep(min(poll_seconds, max(0, deadline-time.monotonic())))
    queue.pause()
    return {"kind": "bounded-native-watch", "reason": reason, "results": results,
            "status": queue.status(), "window_seconds": duration,
            "note": "Window closes to PAUSED. Independent review gates are never synthesized."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True)
    parser.add_argument("--worktree", required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--evidence-dir", required=True)
    parser.add_argument("--duration", type=float, default=300)
    parser.add_argument("--limit", type=int, default=24)
    parser.add_argument("--timeout", type=float, default=180)
    parser.add_argument("--poll-seconds", type=float, default=0.5)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    queue = None
    try:
        queue = native.Queue(args.db)
        result = watch(queue, args.worktree, args.source_sha, args.evidence_dir,
                       args.duration, args.limit, args.timeout, args.poll_seconds, args.execute)
        print(native.canonical(result))
        return 3 if any(item["state"] != "REVIEW" for item in result["results"]) else 0
    except KeyboardInterrupt:
        if queue:
            queue.stop()
        return 130
    except (native.QueueError, OSError, ValueError) as exc:
        if queue:
            queue.pause()
        print(native.canonical({"error": str(exc)}), file=sys.stderr)
        return 2
    finally:
        if queue:
            queue.close()


if __name__ == "__main__":
    sys.exit(main())
