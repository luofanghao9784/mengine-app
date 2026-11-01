"""Behavior tests use only temporary SQLite databases and synthetic evidence."""
import hashlib
import importlib.util
import json
import multiprocessing
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
QUEUE_PATH = ROOT / "scripts/dq/queue.py"
spec = importlib.util.spec_from_file_location("dq_queue_tests", QUEUE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
Queue, QueueError = module.Queue, module.QueueError
SOURCE_SHA = "a" * 40  # Synthetic commit fixture, never reported as a real commit.
RECEIPT = {"receipt": "synthetic:test-fixture", "sha256": hashlib.sha256(b"test fixture").hexdigest(), "kind": "synthetic", "exit_code": 0}
AUTH = {**RECEIPT, "issue": 99, "scope": "isolated-pilot"}


def compete(path, barrier, output, index):
    q = Queue(path)
    barrier.wait()
    output.put(q.claim("worker-" + str(index)))
    q.close()


def claim_then_wait(path, pipe):
    q = Queue(path)
    pipe.send(q.claim("crash-worker", 1))
    time.sleep(30)


def race_stop_claim(path, barrier, output, operation):
    q = Queue(path)
    barrier.wait()
    if operation == "stop":
        output.put((operation, q.stop()))
    else:
        output.put((operation, q.claim("racing-worker")))
    q.close()


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "pilot.sqlite")
        self.now = [1000.0]
        self.q = Queue(self.path, create=True, clock=lambda: self.now[0])

    def tearDown(self):
        self.q.close()
        self.temp.cleanup()

    def enrol(self, name="one", dependencies=(), payload=None):
        return self.q.enrol(name, "dedupe-" + name, payload or {"purpose": "fixture"}, dependencies)

    def resume(self):
        self.q.pilot_resume(AUTH)

    def finished(self, claim):
        return self.q.finish(claim, SOURCE_SHA, RECEIPT)

    def accept(self, task="one"):
        for role in module.GATES:
            result = self.q.review(task, role, role + "-reviewer", SOURCE_SHA, "PASS", RECEIPT)
        return result

    def test_default_pause_business_hold_and_no_history_import(self):
        self.enrol()
        self.assertTrue(self.q.status()["business_paused"])
        self.assertIsNone(self.q.claim("worker"))
        with self.assertRaises(QueueError):
            self.q.enrol("business", "business", {}, scope="business")
        with self.assertRaises(QueueError):
            self.q.pilot_resume({**AUTH, "issue": 98})
        with self.assertRaises(QueueError):
            Queue(Path(self.temp.name) / ".ai/TASKS.json", create=True)
        self.assertFalse((Path(self.temp.name) / ".ai").exists())
        self.resume()
        self.assertTrue(self.q.status()["business_paused"])

    def test_foreign_database_cannot_be_initialized(self):
        path = str(Path(self.temp.name) / "foreign.sqlite")
        db = sqlite3.connect(path)
        db.execute("CREATE TABLE valuable(x)")
        db.close()
        before = Path(path).read_bytes()
        with self.assertRaises(QueueError):
            Queue(path, create=True)
        self.assertEqual(before, Path(path).read_bytes())

    def test_dedupe_is_idempotent_and_conflict_does_not_mutate(self):
        self.enrol()
        self.assertTrue(self.enrol()["duplicate"])
        before = self.q.events()
        with self.assertRaises(QueueError):
            self.enrol(payload={"changed": True})
        with self.assertRaises(QueueError):
            self.q.enrol("other-id", "dedupe-one", {"purpose": "fixture"})
        self.assertEqual(before, self.q.events())
        self.assertEqual(1, len(self.q.status()["tasks"]))

    def test_dependencies_wait_for_all_three_independent_gates(self):
        self.enrol()
        self.enrol("two", ["one"])
        self.resume()
        first = self.q.claim("executor")
        self.assertEqual("one", first["task_id"])
        self.finished(first)
        self.assertIsNone(self.q.claim("other"))
        with self.assertRaises(QueueError):
            self.q.review("one", "qa", "executor", SOURCE_SHA, "PASS", RECEIPT)
        with self.assertRaises(QueueError):
            self.q.review("one", "qa", "reviewer", "b" * 40, "PASS", RECEIPT)
        self.assertEqual("DONE", self.accept()["state"])
        second = self.q.claim("other")
        self.assertEqual("two", second["task_id"])

    def test_test_failure_and_review_failure_never_accept(self):
        self.enrol()
        self.resume()
        claim = self.q.claim("executor")
        with self.assertRaises(QueueError):
            self.q.finish(claim, SOURCE_SHA, {**RECEIPT, "exit_code": 1})
        with self.assertRaises(QueueError):
            self.q.finish(claim, "HEAD", RECEIPT)
        self.finished(claim)
        self.assertEqual("REJECTED", self.q.review("one", "security", "security-reviewer", SOURCE_SHA, "FAIL", RECEIPT)["state"])
        with self.assertRaises(QueueError):
            self.q.review("one", "qa", "reviewer", SOURCE_SHA, "PASS", RECEIPT)
        self.assertIsNone(self.q.claim("another"))

    def test_lease_timeout_fences_late_results_and_unknown_is_not_replayed(self):
        self.enrol()
        self.resume()
        claim = self.q.claim("executor", 10)
        self.now[0] += 11
        result = self.q.recover()
        self.assertEqual(1, result["expired"])
        self.assertEqual("UNKNOWN", result["tasks"][0]["state"])
        self.assertEqual(1, result["occupied"])
        self.assertEqual("PAUSED", result["mode"])
        with self.assertRaises(QueueError):
            self.finished(claim)
        with self.assertRaises(QueueError):
            self.q.heartbeat(claim)
        with self.assertRaises(QueueError):
            self.resume()
        self.assertTrue(self.enrol()["duplicate"])
        self.assertIsNone(self.q.claim("retry"))

    def test_stop_requires_positive_matching_observation_and_fences_worker(self):
        self.enrol()
        self.resume()
        claim = self.q.claim("executor")
        request = self.q.stop()["requests"][0]
        self.assertEqual(1, self.q.status()["occupied"])
        self.assertEqual("STOPPING", self.q.status()["tasks"][0]["state"])
        with self.assertRaises(QueueError):
            self.finished(claim)
        with self.assertRaises(QueueError):
            self.q.confirm_stopped("one", request["stop_request"], "DQ", RECEIPT)
        with self.assertRaises(QueueError):
            self.q.confirm_stopped("one", "wrong", "DQ", {**RECEIPT, "execution_terminated": True})
        self.q.confirm_stopped("one", request["stop_request"], "DQ", {**RECEIPT, "execution_terminated": True})
        self.assertEqual("STOPPED", self.q.status()["tasks"][0]["state"])
        self.assertEqual(0, self.q.status()["occupied"])
        self.assertEqual("PAUSED", self.q.status()["mode"])

    def test_stopping_lease_expiry_recovers_unknown_without_releasing_slot(self):
        self.enrol()
        self.resume()
        self.q.claim("executor", 10)
        request = self.q.stop()["requests"][0]
        self.now[0] += 11
        with self.assertRaises(QueueError):
            self.q.confirm_stopped("one", request["stop_request"], "DQ", {**RECEIPT, "execution_terminated": True})
        self.assertEqual(1, self.q.recover()["expired"])
        self.assertEqual("UNKNOWN", self.q.status()["tasks"][0]["state"])
        self.assertEqual(1, self.q.status()["occupied"])

    def test_append_only_events_and_no_token_disclosure(self):
        self.enrol()
        self.resume()
        claim = self.q.claim("executor")
        with self.assertRaises(sqlite3.IntegrityError):
            self.q.db.execute("DELETE FROM event")
        self.assertNotIn(claim["token"], json.dumps(self.q.events()))
        self.assertNotIn(claim["token"], json.dumps(self.q.status()))

    def test_true_process_contention_caps_claims_at_three(self):
        # Use actual wall clock in all processes, not the fixture clock.
        self.q.clock = time.time
        for i in range(12):
            self.enrol("task-%02d" % i)
        self.resume()
        ctx = multiprocessing.get_context("spawn")
        barrier = ctx.Barrier(8)
        output = ctx.Queue()
        processes = [ctx.Process(target=compete, args=(self.path, barrier, output, i)) for i in range(8)]
        for process in processes:
            process.start()
        results = [output.get(timeout=20) for _ in processes]
        for process in processes:
            process.join(20)
            self.assertEqual(0, process.exitcode)
        claimed = [item for item in results if item]
        self.assertEqual(3, len(claimed))
        self.assertEqual(3, len({item["task_id"] for item in claimed}))
        self.assertEqual(3, self.q.status()["occupied"])

    def test_killed_worker_reopen_does_not_replay_before_or_after_expiry(self):
        self.q.clock = time.time
        self.enrol()
        self.resume()
        ctx = multiprocessing.get_context("spawn")
        parent, child = ctx.Pipe()
        process = ctx.Process(target=claim_then_wait, args=(self.path, child))
        process.start()
        self.assertTrue(parent.poll(10))
        claim = parent.recv()
        os.kill(process.pid, signal.SIGKILL)
        process.join(10)
        self.assertEqual(-signal.SIGKILL, process.exitcode)
        restarted = Queue(self.path)
        try:
            self.assertIsNone(restarted.claim("restart-worker"))
            time.sleep(1.1)
            self.assertEqual(1, restarted.recover()["expired"])
            self.assertIsNone(restarted.claim("restart-worker"))
            with self.assertRaises(QueueError):
                restarted.finish(claim, SOURCE_SHA, RECEIPT)
            self.assertEqual("UNKNOWN", restarted.status()["tasks"][0]["state"])
        finally:
            restarted.close()

    def test_stop_claim_race_finishes_paused_with_no_unfenced_execution(self):
        self.q.clock = time.time
        self.enrol()
        self.resume()
        ctx = multiprocessing.get_context("spawn")
        barrier, output = ctx.Barrier(2), ctx.Queue()
        processes = [ctx.Process(target=race_stop_claim, args=(self.path, barrier, output, op)) for op in ("claim", "stop")]
        for process in processes:
            process.start()
        outcomes = dict(output.get(timeout=20) for _ in processes)
        for process in processes:
            process.join(10)
            self.assertEqual(0, process.exitcode)
        self.assertEqual("PAUSED", self.q.status()["mode"])
        claim = outcomes["claim"]
        if claim:
            self.assertEqual("STOPPING", self.q.status()["tasks"][0]["state"])
            with self.assertRaises(QueueError):
                self.finished(claim)
        else:
            self.assertEqual("READY", self.q.status()["tasks"][0]["state"])

    def test_cli_restart_and_bounded_auto_continuation(self):
        self.q.clock = time.time
        payload = {"operation": "sha256", "text": "MENGINE", "expected": hashlib.sha256(b"MENGINE").hexdigest()}
        self.enrol("one", payload=payload)
        self.enrol("two", ["one"], payload=payload)
        self.resume()
        command = [sys.executable, str(ROOT / "scripts/dq/run_pilot.py"), "--db", self.path, "--source-sha", SOURCE_SHA, "--evidence-dir", str(Path(self.temp.name) / "evidence"), "--limit", "2"]
        result = subprocess.run(command, capture_output=True, text=True, timeout=20)
        self.assertEqual(0, result.returncode, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(2, report["completed"])
        self.assertEqual("synthetic", report["kind"])
        self.assertTrue(report["status"]["business_paused"])
        self.assertEqual(["DONE", "DONE"], [item["state"] for item in report["status"]["tasks"]])
        for event in self.q.events():
            if event["kind"] == "EXECUTION_FINISHED":
                receipt = event["detail"]["tests"]
                self.assertEqual(receipt["sha256"], hashlib.sha256(Path(receipt["receipt"]).read_bytes()).hexdigest())
        second = subprocess.run(command, capture_output=True, text=True, timeout=20)
        self.assertEqual(0, json.loads(second.stdout)["completed"])


if __name__ == "__main__":
    unittest.main()
