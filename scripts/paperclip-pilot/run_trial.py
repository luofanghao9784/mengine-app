"""Bounded two-task native Paperclip trial. Does not dispatch historical tasks."""
import argparse
import json
from pathlib import Path
import time
import uuid
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler

if not __debug__:
    raise RuntimeError("Optimized Python is unsupported: authorization guards must remain enabled")

COMPANY = "5923bae1-b181-40f6-b060-e772fef05b8e"
BASE = "http://127.0.0.1:43100/api"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("Redirect refused")


opener = build_opener(ProxyHandler({}), NoRedirect())


def api(method, path, body=None):
    request = Request(BASE + path, method=method,
                      data=None if body is None else json.dumps(body).encode(),
                      headers={"Content-Type": "application/json"})
    with opener.open(request, timeout=20) as response:
        return json.load(response)


PROMPT = """You are executing ONLY this explicitly authorized synthetic Paperclip pilot.
Do not access any historical MENGINE task, business repository, production, GitHub,
payment, customer data, purchase, external URL or secret file. Do not use git.
Your shell may access only this synthetic cwd and the loopback Paperclip API through
the configured proxy. Never echo auth headers, tokens, or environment variable values.
Use Python stdlib urllib.request for API calls (or curl). API base is PAPERCLIP_API_URL;
append /api only if absent. Bearer auth comes from PAPERCLIP_API_KEY. Send
X-Paperclip-Run-Id from PAPERCLIP_RUN_ID on every write. TASK ID is PAPERCLIP_TASK_ID.
Fetch GET /api/issues/<taskId>. If no task ID, title does not start [PILOT-100],
or task is assigned to someone else, stop without claiming anything.
Only the two [PILOT-100] tasks are authorized. Read their description and follow
the executor/reviewer branch below. No delegation or new task creation.
{role_instructions}
Use /Library/Developer/CommandLineTools/usr/bin/python3 -B to run tests.
Before returning, always PATCH this issue with a concise evidence comment in the
same call as the status transition. Do not claim acceptance merely from your own
summary or exit code. Never change company or agent configuration or budgets.
"""

CODER = """You are the coder. If status is todo/in_progress and you are the assignee,
checkout via POST /api/issues/<id>/checkout with agentId=PAPERCLIP_AGENT_ID and
expectedStatuses=["todo","in_progress"]. Implement only budget.py and
test_budget.py in cwd, according to this issue's description. Add meaningful
boundary tests. Run all unit tests. If they pass, PATCH status=done with a comment
describing files, test command and actual result. Paperclip will route it to QA;
do not bypass review or reassign it yourself. If blocked, PATCH status=blocked
with the concrete reason. Do not work on the blocked successor early.
"""

REVIEWER = """You are independent QA with a read-only filesystem profile. Do not edit
source or tests. For an assigned in_review issue, do not change it to in_progress
merely to checkout. Read code and tests; run the full suite with -B; run additional
inline boundary probes against the actual module. Check booleans, negatives,
empty input, exact and exceeded limits, and for the second task tax rounding and
reserves. Check no external I/O or side effects. If correct, PATCH status=done
with your independent evidence comment in the same request. If incorrect,
PATCH status=in_progress with a concrete changes-requested comment. Do not approve
without executing checks. Do not edit code or create tasks.
"""

TASK_A = """Implement budget.py with evaluate_budget(items, limit_cents=20000).
items must be a dict of nonempty string labels to nonnegative integer cents;
bools are invalid integers. Reject malformed inputs with ValueError.
limit_cents must be a nonnegative integer, not bool. Return a dict with exactly
subtotal_cents=sum(items.values()), tax_cents=0, reserve_cents=0,
total_cents=subtotal_cents, remaining_cents=limit_cents-total_cents,
within_limit=(total_cents<=limit_cents). Empty items are valid. Do not use floats.
No external I/O, CLI side effects or dependencies. Create test_budget.py with
meaningful valid/invalid, zero, exact-cap and exceeded-cap tests.
This is a real low-risk infrastructure tool trial linked to GitHub Issue #100.
Independent QA must approve it before the successor is eligible.
"""

TASK_B = """Extend the approved budget.py evaluate_budget signature with keyword-only
tax_basis_points=0 and reserve_cents=0. Both must be nonnegative integers, not bool.
Compute tax_cents=(subtotal_cents*tax_basis_points+9999)//10000 (round up to cents).
Compute total_cents=subtotal_cents+tax_cents+reserve_cents; remaining and within_limit
use this total. Keep the exact six output keys from the first task; preserve all
default-call behavior and all prior tests. Add boundary tests for one-cent rounding,
zero subtotal, invalid tax/reserve, and tax+reserve causing the $200 cap to fail.
Do not buy resources, call providers, read real costs, or change other files.
Complete only after running all tests; independent QA must execute checks too.
"""


def run(args):
    workspace = Path(args.workspace).resolve(strict=True)
    login = Path(args.login_home).resolve(strict=True)
    command = Path(args.codex).resolve(strict=True)
    assert workspace.name == "paperclip-development-100"
    assert (workspace / ".git").is_dir()
    assert (login / "auth.json").is_file(), "Finish isolated subscription login first"
    assert all((login / (profile + ".config.toml")).is_file()
               for profile in ("pilot-coder", "pilot-reviewer"))
    company = api("GET", "/companies/" + COMPANY)
    assert company["name"] == "MENGINE Paperclip 隔离试点 100" and company["status"] == "paused"
    agents = api("GET", f"/companies/{COMPANY}/agents")
    assert len(agents) == 19 and all(a["status"] == "paused" for a in agents)
    existing = api("GET", f"/companies/{COMPANY}/issues")
    prior = None
    baseline_runs = api("GET", f"/companies/{COMPANY}/heartbeat-runs")
    if args.resume_from:
        prior = json.loads(Path(args.resume_from).read_text())
        assert prior["companyId"] == COMPANY and len(prior["tasks"]) == 2
        assert {t["id"] for t in existing} == {t["id"] for t in prior["tasks"]}
        assert all(t["title"].startswith("[PILOT-100]") for t in existing)
        assert not any(r["status"] in ("running", "queued") for r in baseline_runs), "Reconcile active runs first"
        assert all(t["status"] in ("blocked", "todo", "in_progress", "in_review", "done") for t in existing)
    elif args.preserved_receipt:
        preserved = json.loads(Path(args.preserved_receipt).read_text())
        assert preserved["companyId"] == COMPANY
        assert {t["id"] for t in existing} == {t["id"] for t in preserved["tasks"]}
        assert all(t["status"] == "cancelled" and t["title"].startswith("[PILOT-100]") for t in existing)
        assert not any(r["status"] in ("running", "queued") for r in baseline_runs)
    else:
        assert not existing, "Refuse to overwrite/retry existing trial tasks; reconcile them first"
    by_role = {(a.get("metadata") or {}).get("pilotRole"): a for a in agents}
    actors = {"coder": by_role["backend"], "reviewer": by_role["qa"]}
    originals = {key: {"adapterConfig": {**a["adapterConfig"], "engine": "cli", "env": {
        "CODEX_HOME": str(workspace.parent / "uncredentialed-codex-home"), "OPENAI_API_KEY": ""}},
        "runtimeConfig": a["runtimeConfig"], "budgetMonthlyCents": a["budgetMonthlyCents"]}
        for key, a in actors.items()}
    receipt = {"companyId": COMPANY, "status": "INCOMPLETE", "tasks": [], "observations": [],
               "historicalTasksImported": False, "cloudOrProductionWrites": False,
               "modelAuth": "USER_AUTHORIZED_ISOLATED_CHATGPT_SUBSCRIPTION",
               "engine": "cli", "priorRunIds": [r["id"] for r in baseline_runs],
               "preservedPriorTaskIds": [t["id"] for t in existing] if not prior else [],
               "runObservationStopThreshold": 8, "hardAdmissionCapVerified": False,
               "perRunTimeoutSeconds": 180}
    output = Path(args.receipt).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    def save():
        output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")

    try:
        for key, actor in actors.items():
            profile = "pilot-coder" if key == "coder" else "pilot-reviewer"
            api("PATCH", "/agents/" + actor["id"], {
                "status": "paused", "replaceAdapterConfig": True,
                "adapterConfig": {"engine": "cli", "command": str(command), "cwd": str(workspace),
                    "dangerouslyBypassApprovalsAndSandbox": False,
                    "extraArgs": ["--profile", profile], "timeoutSec": 180, "graceSec": 10,
                    "env": {"CODEX_HOME": str(login), "OPENAI_API_KEY": ""},
                    "promptTemplate": PROMPT.format(role_instructions=CODER if key == "coder" else REVIEWER)},
                "runtimeConfig": {"heartbeat": {"enabled": False, "intervalSec": 0,
                    "wakeOnDemand": True, "maxConcurrentRuns": 1}},
                # Subscription usage is bounded by this watchdog, not an invented
                # dollar threshold on Paperclip's estimated token accounting.
                "budgetMonthlyCents": 0})
        first = None
        if prior:
            receipt["tasks"] = prior["tasks"]
            first = api("GET", "/issues/" + receipt["tasks"][0]["id"])
            assert first.get("executionBlocker") is None, "Resolve the exact execution hold with evidence before retrying"
            assert first["status"] in ("blocked", "todo", "in_progress", "in_review")
            if first["status"] != "in_review":
                api("PATCH", "/issues/" + first["id"], {"status": "todo",
                    "comment": "Operator reconciled prior terminal runs; explicitly selected CLI engine with independently verified restricted permissions. Retrying only this synthetic task; prior outcomes remain recorded."})
        for title, description in ([] if prior else [("[PILOT-100] A 整数成本门禁", TASK_A),
                                   ("[PILOT-100] B 税费与预留成本接续", TASK_B)]):
            policy = {"mode": "normal", "commentRequired": True, "maxReviewRounds": 2,
                "stages": [{"id": str(uuid.uuid4()), "type": "review", "approvalsNeeded": 1,
                    "participants": [{"id": str(uuid.uuid4()), "type": "agent",
                                      "agentId": actors["reviewer"]["id"]}]}]}
            body = {"title": title, "description": description, "status": "todo",
                    "priority": "medium", "assigneeAgentId": actors["coder"]["id"],
                    "executionPolicy": policy}
            if first:
                body["blockedByIssueIds"] = [first["id"]]
            task = api("POST", f"/companies/{COMPANY}/issues", body)
            if first is None:
                first = task
            receipt["tasks"].append({"id": task["id"], "identifier": task["identifier"], "title": title})
            save()
        for actor in actors.values():
            api("PATCH", "/agents/" + actor["id"], {"status": "idle"})
        api("PATCH", "/companies/" + COMPANY, {"status": "active"})
        initial_actor = actors["reviewer"] if first["status"] == "in_review" else actors["coder"]
        start = api("POST", "/agents/" + initial_actor["id"] + "/heartbeat/invoke", {
            "reason": "authorized_bounded_pilot_100", "payload": {"issueId": first["id"]},
            "forceFreshSession": True,
            "idempotencyKey": "pilot-100-bounded-cli-" + str(uuid.uuid4())})
        receipt["initialRunId"] = start.get("id")
        save()
        if not start.get("id"):
            receipt["status"] = "WAKE_REJECTED_REQUIRES_OPERATOR_RECONCILIATION"
            return
        deadline = time.monotonic() + 720
        previous = None
        while time.monotonic() < deadline:
            tasks = [api("GET", "/issues/" + item["id"]) for item in receipt["tasks"]]
            runs = api("GET", f"/companies/{COMPANY}/heartbeat-runs")
            state = {"tasks": [{"id": t["id"], "status": t["status"],
                      "assigneeAgentId": t.get("assigneeAgentId"),
                      "executionState": t.get("executionState")} for t in tasks],
                     "runs": [{k: r.get(k) for k in ("id", "agentId", "status", "errorCode")}
                              for r in runs]}
            if state != previous:
                receipt["observations"].append({"at": time.time(), **state})
                save()
                print(json.dumps({"taskStatuses": [t["status"] for t in tasks],
                                  "runStatuses": [r["status"] for r in runs]}), flush=True)
                previous = state
            if all(t["status"] == "done" for t in tasks) and not any(
                    r["status"] in ("running", "queued") for r in runs):
                receipt["status"] = "TASKS_REVIEWED_DONE_PENDING_OPERATOR_VERIFICATION"
                break
            if len(runs) >= len(baseline_runs) + 8 or any(t["status"] == "blocked" for t in tasks):
                receipt["status"] = "STOPPED_FOR_RECONCILIATION"
                break
            if runs and all(r["status"] in ("failed", "cancelled", "succeeded", "timed_out") for r in runs):
                if any(r["status"] in ("failed", "timed_out") for r in runs):
                    receipt["status"] = "RUN_FAILED_REQUIRES_RECONCILIATION"
                    break
            time.sleep(3)
        else:
            receipt["status"] = "WATCHDOG_EXPIRED_REQUIRES_RECONCILIATION"
    finally:
        # Stop admission before pausing actors. Preserve task/run history and costs.
        api("PATCH", "/companies/" + COMPANY, {"status": "paused"})
        cleanup = []
        for key, actor in actors.items():
            try:
                api("POST", "/agents/" + actor["id"] + "/pause", {})
                api("PATCH", "/agents/" + actor["id"], {
                    **originals[key], "replaceAdapterConfig": True, "status": "paused"})
                cleanup.append({"agentId": actor["id"], "pausedAndCredentialsDetached": True})
            except Exception as error:
                cleanup.append({"agentId": actor["id"], "cleanupErrorType": type(error).__name__})
        receipt["cleanup"] = cleanup
        save()
        print("Trial stopped; company paused; see receipt for actual outcomes.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--codex", required=True)
    parser.add_argument("--login-home", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--receipt", required=True)
    parser.add_argument("--resume-from", help="Explicitly reconciled receipt for these same two synthetic tasks")
    parser.add_argument("--preserved-receipt", help="Previously cancelled synthetic tasks to preserve while creating a fresh scoped pair")
    args = parser.parse_args()
    if args.resume_from and args.preserved_receipt:
        parser.error("Choose one explicit reconciliation mode")
    run(args)
