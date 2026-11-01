"""Native bridge contract tests use a fake CLI, never paid/model calls."""
import hashlib
import contextlib
import io
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("dq_native_tests", ROOT / "scripts/dq/run_native.py")
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
SHA = "a" * 40
AUTH = {"issue": 99, "scope": "isolated-pilot", "receipt": "synthetic:test-authorization", "sha256": hashlib.sha256(b"fixture").hexdigest()}


class NativeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / ".git").write_text("gitdir: synthetic-fixture\n")
        (self.root / ".codex/agents").mkdir(parents=True)
        (self.root / ".codex/config.toml").write_text("[agents]\nmax_concurrent_threads_per_session=3\n")
        (self.root / ".codex/agents/qa.toml").write_text('name="qa"\n')
        (self.root / ".codex/dq-team.json").write_text(json.dumps({"roles": [{"name": "qa", "path": ".codex/agents/qa.toml"}]}))
        (self.root / ".agents/skills/dq-quality").mkdir(parents=True)
        (self.root / ".agents/skills/dq-quality/SKILL.md").write_text("synthetic test skill")
        self.q = native.Queue(self.root / ".local/queue.sqlite", create=True)
        self.payload = {"operation": "review-dq-pilot", "role": "qa", "skills": ["dq-quality"]}

    def tearDown(self):
        self.q.close()
        self.temp.cleanup()

    def enrol(self):
        self.q.enrol("native", "native", self.payload, scope="pilot")

    def fake_cli(self, body):
        path = self.root / "fake-codex"
        path.write_text("#!/usr/bin/env python3\nimport sys,json,time,signal\n" + body)
        path.chmod(0o700)
        return str(path)

    def run_native(self, codex, **kwargs):
        with mock.patch.object(native, "verify_source"):
            return native.run(self.q, self.root, SHA, self.root / ".local/evidence", codex=codex, **kwargs)

    def test_explicit_execution_gate_and_default_pause(self):
        self.enrol()
        with self.assertRaises(native.QueueError):
            self.run_native("does-not-exist")
        result = self.run_native("does-not-exist", execute=True)
        self.assertEqual([], result["results"])
        self.assertEqual("PAUSED", result["status"]["mode"])

    def test_command_fixes_readonly_provider_model_and_cap(self):
        command = native.build_command("codex", self.root, "schema", "result")
        self.assertIn("--ignore-user-config", command)
        self.assertIn("--strict-config", command)
        self.assertEqual("read-only", command[command.index("--sandbox") + 1])
        self.assertIn("features.apps=false", command)
        self.assertIn("features.plugins=false", command)
        self.assertIn("agents.max_concurrent_threads_per_session=1", command)
        self.assertNotIn("--dangerously-bypass-approvals-and-sandbox", command)

    def test_main_checkout_mcp_and_path_escape_rejected(self):
        (self.root / ".git").unlink()
        (self.root / ".git").mkdir()
        with self.assertRaises(native.QueueError):
            native.validate_workspace(self.root)
        (self.root / ".git").rmdir()
        (self.root / ".git").touch()
        (self.root / ".codex/config.toml").write_text('[mcp_servers.x]\nurl="https://example.invalid"\n')
        with self.assertRaises(native.QueueError):
            native.validate_workspace(self.root)
        with self.assertRaises(native.QueueError):
            native.make_prompt(self.root, {**self.payload, "skills": ["../../secret"]})

    def test_success_is_only_review_and_requires_observed_spawn(self):
        self.enrol()
        self.q.pilot_resume(AUTH)
        fake = self.fake_cli("sys.stdin.read()\np=sys.argv[sys.argv.index('-o')+1]\nopen(p,'w').write(json.dumps({'pass':True,'findings':[],'skills_loaded':['dq-quality'],'evidence_note':'fixture'}))\nprint(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':'I spawned a subagent'}}))\nprint(json.dumps({'type':'turn.completed'}))\n")
        result = self.run_native(fake, execute=True)
        self.assertEqual("REVIEW", result["results"][0]["state"])
        self.assertFalse(result["results"][0]["native_subagent_observed"])
        self.assertTrue(result["status"]["business_paused"])
        self.assertEqual(0, self.q.db.execute("SELECT count(*) FROM gate").fetchone()[0])
        receipt = json.loads(Path(result["results"][0]["receipt"]).read_text())
        self.assertFalse(receipt["human_approval"])
        self.assertFalse(receipt["ci_approval"])

    def test_collaboration_evidence_uses_tool_items_only(self):
        path = self.root / "events.jsonl"
        path.write_text(json.dumps({"type": "item.completed", "item": {"type": "collab_tool_call", "tool": "spawn_agent", "status": "completed", "receiver_thread_ids": ["fixture-child"]}}) + "\n")
        self.assertEqual(1, len(native.observed_collaboration(path)))
        for status in ("failed", "in_progress"):
            path.write_text(json.dumps({"type": "item.completed", "item": {"type": "collab_tool_call", "tool": "spawn_agent", "status": status, "receiver_thread_ids": ["fixture-child"]}}) + "\n")
            self.assertEqual([], native.observed_collaboration(path))

    def test_child_lifecycle_requires_bound_terminal_observation(self):
        path = self.root / "lifecycle.jsonl"
        spawn = {"type": "item.completed", "item": {"type": "collab_tool_call", "tool": "spawn_agent", "status": "completed", "receiver_thread_ids": ["child-one"]}}
        path.write_text(json.dumps(spawn) + "\n" + json.dumps({"type": "turn.completed"}) + "\n")
        self.assertFalse(native.native_lifecycle(path)["all_observed_children_terminal"])
        wait = {"type": "item.completed", "item": {"type": "collab_tool_call", "tool": "wait", "status": "completed", "agents_states": {"child-one": {"status": "completed"}}}}
        with path.open("a") as stream:
            stream.write(json.dumps(wait) + "\n")
        self.assertTrue(native.native_lifecycle(path)["all_observed_children_terminal"])

    def test_child_restart_invalidates_old_terminal_until_new_completion(self):
        path = self.root / "restarted-child.jsonl"
        def event(tool, states=None):
            return {"type": "item.completed", "item": {"type": "collab_tool_call", "tool": tool, "status": "completed", "receiver_thread_ids": ["child-one"], "agents_states": states or {}}}
        events = [event("spawn_agent"), event("wait", {"child-one": {"status": "completed"}}), event("followup_task")]
        path.write_text("\n".join(json.dumps(item) for item in events) + "\n")
        self.assertFalse(native.native_lifecycle(path)["all_observed_children_terminal"])
        with path.open("a") as stream:
            stream.write(json.dumps(event("wait", {"child-one": {"status": "completed"}})) + "\n")
        self.assertTrue(native.native_lifecycle(path)["all_observed_children_terminal"])
        with path.open("a") as stream:
            stream.write(json.dumps(event("wait", {"child-one": {"status": "running"}})) + "\n")
        self.assertFalse(native.native_lifecycle(path)["all_observed_children_terminal"])

    def test_cli_exit_distinguishes_failure_review_and_no_execution(self):
        argv = ["run_native.py", "--db", "fixture", "--worktree", str(self.root), "--source-sha", SHA, "--evidence-dir", str(self.root / ".local/evidence"), "--execute"]
        for states, expected_exit, attempted, succeeded in ((["STOPPING"], 3, True, False), (["STOPPED"], 3, True, False), (["REVIEW"], 0, True, True), ([], 0, False, False)):
            output = io.StringIO()
            report = {"results": [{"state": state} for state in states], "status": {"mode": "PAUSED"}}
            with mock.patch.object(native.sys, "argv", argv), mock.patch.object(native, "Queue"), mock.patch.object(native, "run", return_value=report), contextlib.redirect_stdout(output):
                self.assertEqual(expected_exit, native.main())
            result = json.loads(output.getvalue())
            self.assertEqual(attempted, result["execution_attempted"])
            self.assertEqual(succeeded, result["execution_succeeded"])

    def test_role_dispatch_uses_toml_name_not_file_stem(self):
        (self.root / ".codex/agents/dq-qa.toml").write_text('name = "dq_qa"\n')
        (self.root / ".codex/dq-team.json").write_text(json.dumps({"roles": [{"name": "dq_qa", "path": ".codex/agents/dq-qa.toml"}]}))
        prompt = native.make_prompt(self.root, {**self.payload, "role": "dq-qa"})
        self.assertIn("configured role dq_qa", prompt)
        self.assertIn("configured role dq_qa", native.make_prompt(self.root, {**self.payload, "role": "dq_qa"}))

    def test_actual_repository_role_config_integrates(self):
        manifest = json.loads((ROOT / ".codex/dq-team.json").read_text())
        role = next(item for item in manifest["roles"] if item["name"] == "dq_qa")
        prompt = native.make_prompt(ROOT, {"operation": "review-dq-pilot", "role": role["name"], "skills": role["skills"]})
        self.assertIn("configured role dq_qa", prompt)

    def test_source_verification_rejects_main_wrong_sha_and_dirty(self):
        def result(text):
            return type("Result", (), {"returncode": 0, "stdout": text, "stderr": ""})()
        for output in ((str(self.root), "main"), (str(self.root), "feat/pilot", "b" * 40), (str(self.root), "feat/pilot", SHA, " M scripts/dq/run_native.py")):
            with mock.patch.object(native.subprocess, "run", side_effect=[result(value) for value in output]):
                with self.assertRaises(native.QueueError):
                    native.verify_source(self.root, SHA)

    def test_timeout_after_native_started_never_confirms_remote_stop(self):
        self.enrol()
        self.q.pilot_resume(AUTH)
        fake = self.fake_cli("sys.stdin.read()\nprint(json.dumps({'type':'thread.started','thread_id':'fixture'}),flush=True)\ntime.sleep(30)\n")
        result = self.run_native(fake, execute=True, timeout=1)
        self.assertEqual("STOPPING", result["results"][0]["state"])
        self.assertFalse(result["results"][0]["termination_confirmed"])
        self.assertEqual(1, result["status"]["occupied"])
        self.assertEqual([], [event for event in self.q.events() if event["kind"] == "STOP_CONFIRMED"])

    def test_timeout_terminates_local_process_without_remote_stop_claim(self):
        self.enrol()
        self.q.pilot_resume(AUTH)
        fake = self.fake_cli("sys.stdin.read()\ntime.sleep(30)\n")
        result = self.run_native(fake, execute=True, timeout=1)
        item = result["results"][0]
        self.assertEqual("timeout", item["reason"])
        self.assertFalse(item["termination_confirmed"])
        self.assertEqual("STOPPING", item["state"])
        self.assertEqual("PAUSED", result["status"]["mode"])
        receipt = json.loads(next((self.root / ".local/evidence").glob("*/stop-receipt.json")).read_text())
        self.assertIsNotNone(receipt["exit_code"])
        self.assertTrue(receipt["local_process_terminated"])
        self.assertFalse(receipt["native_execution_terminated"])

    def test_nonzero_and_launch_failure_pause_without_done(self):
        self.enrol()
        self.q.pilot_resume(AUTH)
        fake = self.fake_cli("sys.stdin.read()\nsys.exit(7)\n")
        result = self.run_native(fake, execute=True)
        self.assertEqual("codex-nonzero", result["results"][0]["reason"])
        self.assertEqual("STOPPING", result["results"][0]["state"])
        self.assertEqual(0, self.q.db.execute("SELECT count(*) FROM gate").fetchone()[0])

    def test_popen_failure_is_confirmed_never_started(self):
        self.enrol()
        self.q.pilot_resume(AUTH)
        result = self.run_native(str(self.root / "missing-executable"), execute=True)
        self.assertEqual("STOPPED", result["results"][0]["state"])
        self.assertTrue(result["results"][0]["termination_confirmed"])


if __name__ == "__main__":
    unittest.main()
