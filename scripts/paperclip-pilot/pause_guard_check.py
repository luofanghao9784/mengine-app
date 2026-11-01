"""Observe a synthetic task across native sweeps while the company is paused."""
import importlib.util
import json
from pathlib import Path
import time

if not __debug__:
    raise RuntimeError("Optimized Python is unsupported: validation must remain enabled")

spec = importlib.util.spec_from_file_location("trial", Path(__file__).with_name("run_trial.py"))
trial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trial)
api, company = trial.api, trial.COMPANY
assert api("GET", "/companies/" + company)["status"] == "paused"
agents = api("GET", f"/companies/{company}/agents")
assert len(agents) == 19 and all(a["status"] == "paused" for a in agents)
assert not api("GET", f"/companies/{company}/live-runs")
before = api("GET", f"/companies/{company}/heartbeat-runs")
coder = next(a for a in agents if (a.get("metadata") or {}).get("pilotRole") == "backend")
task = api("POST", f"/companies/{company}/issues", {
    "title": "[PILOT-100] Paused-company recovery canary (never execute)",
    "description": "Synthetic pause guard only. Do not execute or change this task while the company is paused.",
    "status": "todo", "assigneeAgentId": coder["id"], "priority": "low"})
try:
    initial = api("GET", "/issues/" + task["id"])
    time.sleep(25)
    final = api("GET", "/issues/" + task["id"])
    after = api("GET", f"/companies/{company}/heartbeat-runs")
    assert api("GET", "/companies/" + company)["status"] == "paused"
    assert final["status"] == initial["status"] == "todo"
    assert final["updatedAt"] == initial["updatedAt"]
    assert {r["id"] for r in before} == {r["id"] for r in after}
    print(json.dumps({"status": "PASS", "observationSeconds": 25,
                      "schedulerIntervalMs": 10000, "companyPaused": True,
                      "taskUnchangedAcrossSweeps": True, "newRuns": 0,
                      "syntheticCanaryIssueId": task["id"]}, indent=2))
finally:
    api("PATCH", "/issues/" + task["id"], {"status": "cancelled",
        "comment": "Operator closed this synthetic pause canary after observation. It was never authorized to execute; preserve the audit record."})
