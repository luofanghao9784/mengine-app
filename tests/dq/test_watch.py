"""Real durable review/continuation behavior with a deterministic native stand-in."""
import hashlib
import importlib.util
import multiprocessing
from pathlib import Path
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("dq_watch_tests", ROOT / "scripts/dq/watch_native.py")
watcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watcher)
SHA = "a" * 40
RECEIPT = {"receipt": "synthetic:watch-test", "sha256": hashlib.sha256(b"fixture").hexdigest(),
           "kind": "synthetic", "exit_code": 0}
AUTH = {**RECEIPT, "issue": 99, "scope": "isolated-pilot"}


def approve_from_separate_process(path):
    queue = watcher.native.Queue(path)
    deadline = time.monotonic() + 5
    try:
        while time.monotonic() < deadline:
            if queue.status()["tasks"][0]["state"] == "REVIEW":
                # Force a real idle window before the dependency becomes Ready.
                time.sleep(0.15)
                for role in ("qa", "security", "product"):
                    queue.review("first", role, "synthetic-reviewer-"+role, SHA, "PASS", RECEIPT)
                return
            time.sleep(0.02)
        raise RuntimeError("review task never became REVIEW")
    finally:
        queue.close()


class WatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "queue.sqlite"
        self.queue = watcher.native.Queue(self.path, create=True)

    def tearDown(self):
        self.queue.close()
        self.temp.cleanup()

    def execute_fixture(self, queue, *args, **kwargs):
        claim = queue.claim("synthetic-native-stand-in", operation="review-dq-pilot")
        results = []
        if claim:
            queue.finish(claim, SHA, RECEIPT)
            results.append({"task_id": claim["task_id"], "state": "REVIEW"})
        return {"results": results}

    def test_explicit_start_and_default_paused_do_not_call_model(self):
        with self.assertRaises(watcher.native.QueueError):
            watcher.watch(self.queue, ROOT, SHA, ROOT / ".local")
        calls = []
        result = watcher.watch(self.queue, ROOT, SHA, ROOT / ".local", duration=2,
                               execute=True, runner=lambda *a, **k: calls.append(1))
        self.assertEqual([], calls)
        self.assertEqual("PAUSED", result["status"]["mode"])

    def test_independent_review_then_next_task_without_restart(self):
        payload = {"operation": "review-dq-pilot"}
        self.queue.enrol("first", "first", payload, scope="pilot")
        self.queue.enrol("second", "second", payload, dependencies=["first"], scope="pilot")
        self.queue.pilot_resume(AUTH)
        process = multiprocessing.get_context("spawn").Process(target=approve_from_separate_process,
                                                                args=(str(self.path),))
        process.start()
        try:
            result = watcher.watch(self.queue, ROOT, SHA, ROOT / ".local", duration=6,
                                   limit=2, poll_seconds=0.05, execute=True, runner=self.execute_fixture)
            process.join(timeout=3)
            self.assertEqual(0, process.exitcode)
            self.assertEqual(["first", "second"], [x["task_id"] for x in result["results"]])
            self.assertEqual(["DONE", "REVIEW"], [x["state"] for x in result["status"]["tasks"]])
            self.assertEqual("PAUSED", result["status"]["mode"])
            self.assertEqual(3, self.queue.db.execute("SELECT count(*) FROM gate").fetchone()[0])
        finally:
            if process.is_alive():
                process.terminate()
                process.join(timeout=3)

    def test_empty_window_closes_paused_and_does_not_create_work(self):
        self.queue.pilot_resume(AUTH)
        result = watcher.watch(self.queue, ROOT, SHA, ROOT / ".local", duration=0.1,
                               execute=True, runner=self.execute_fixture)
        self.assertEqual([], result["results"])
        self.assertEqual("PAUSED", result["status"]["mode"])
        self.assertTrue(result["status"]["business_paused"])


if __name__ == "__main__":
    unittest.main()
