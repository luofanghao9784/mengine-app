"""Safety rejection tests; real API/persistence checks are separate acceptance evidence."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("seed", Path(__file__).with_name("seed.py"))
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)


class SafetyTests(unittest.TestCase):
    def setUp(self):
        self.plan = json.loads((ROOT / "config/paperclip-pilot/plan.json").read_text())

    def test_paused_plan(self):
        seed.validate(self.plan)

    def test_reject_dispatch_import_bypass_budget_and_concurrency(self):
        for key, value in [("dispatchEnabled", True), ("historicalImportEnabled", True),
                           ("infrastructureMonthlyLimitUSD", 201), ("maxDevelopmentSlots", 3)]:
            with self.subTest(key=key), self.assertRaises(AssertionError):
                seed.validate({**self.plan, key: value})
        self.plan["adapterConfig"]["dangerouslyBypassApprovalsAndSandbox"] = True
        with self.assertRaises(AssertionError):
            seed.validate(self.plan)

    def test_reject_wakeups_and_duplicate_roles(self):
        for key in ("enabled", "wakeOnDemand", "wakeOnAssignment", "wakeOnAutomation"):
            plan = copy.deepcopy(self.plan)
            plan["runtimeConfig"]["heartbeat"][key] = True
            with self.subTest(key=key), self.assertRaises(AssertionError):
                seed.validate(plan)
        self.plan["roles"][-1] = self.plan["roles"][0]
        with self.assertRaises(AssertionError):
            seed.validate(self.plan)

    def test_reject_remote_and_ambiguous_endpoint_before_network(self):
        for url in ("https://example.com", "http://localhost:3100", "http://127.0.0.1",
                    "http://127.0.0.1:3100/path", "http://user@127.0.0.1:3100",
                    "http://127.0.0.1:3100?redirect=1"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                seed.apply(self.plan, url, ".")

    def test_reject_nonempty_workspace_before_network(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "existing-task.txt").write_text("Do not overwrite")
            with self.assertRaises(ValueError):
                seed.apply(self.plan, "http://127.0.0.1:1", folder)
            self.assertEqual(Path(folder, "existing-task.txt").read_text(), "Do not overwrite")

    def test_reject_active_or_foreign_company_without_any_write(self):
        class Response:
            def __init__(self, body):
                self.body = json.dumps(body).encode()
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def read(self):
                return self.body

        for company in ({"name": "production", "status": "paused"},
                        {"name": self.plan["companyName"], "status": "active"}):
            calls = []
            class Opener:
                def open(self, request, timeout):
                    calls.append(request.method)
                    return Response([company])
            with tempfile.TemporaryDirectory() as folder, patch.object(seed, "build_opener", return_value=Opener()):
                with self.assertRaises(ValueError):
                    seed.apply(self.plan, "http://127.0.0.1:43100", folder)
            self.assertEqual(calls, ["GET"])


if __name__ == "__main__":
    unittest.main()
