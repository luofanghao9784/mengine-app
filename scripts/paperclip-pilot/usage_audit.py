"""Audit only this paused pilot. Read provider usage, never auth.json or prompts.

An audit is not an invoice. Input excludes cached input, as Paperclip expects.
No task status, historical ownership or previously settled receipt is changed.
"""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
from urllib.request import build_opener, ProxyHandler, HTTPRedirectHandler

COMPANY = "5923bae1-b181-40f6-b060-e772fef05b8e"
BASE = "http://127.0.0.1:43100/api"
KEYS = ("input_tokens", "cached_input_tokens", "cache_write_input_tokens",
        "output_tokens", "reasoning_output_tokens", "total_tokens")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def instant(value):
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(result.tzinfo is not None, "Timezone required")
    return result


def extract(rows, session_id, started_at, finished_at):
    """Require a closed single root turn and reconcile request sums to its total."""
    require(rows[0].get("type") == "session_meta" and
            rows[0]["payload"].get("id") == session_id, "Session identity mismatch")
    start, finish = instant(started_at), instant(finished_at)
    require(start <= finish, "Invalid run interval")
    window = [r for r in rows if start <= instant(r["timestamp"]) <= finish]
    records, roots, latest = {}, set(), None
    for row in window:
        if row["type"] != "token_usage_record":
            continue
        p = row["payload"]
        require(p.get("session_id") == session_id and p.get("thread_id") == session_id,
                "Foreign usage record")
        require(isinstance(p.get("response_id"), str) and p["response_id"], "Missing response ID")
        u = p["usage"]
        require(all(type(u.get(k)) is int and 0 <= u[k] <= 2_147_483_647 for k in KEYS),
                "Invalid token amount")
        require(u["cached_input_tokens"] <= u["input_tokens"] and
                u["reasoning_output_tokens"] <= u["output_tokens"] and
                u["total_tokens"] == u["input_tokens"] + u["output_tokens"], "Invalid token relation")
        identity = (p["root_turn_id"], u)
        require(p["response_id"] not in records or records[p["response_id"]] == identity,
                "Conflicting response replay")
        records[p["response_id"]] = identity
        roots.add(p["root_turn_id"])
        latest = row
    require(records and len(roots) == 1, "Missing or mixed provider turns")
    root = next(iter(roots))
    boundaries = [r for r in window if r["type"] == "event_msg" and
                  r["payload"].get("turn_id") == root]
    require(any(r["payload"].get("type") == "task_started" for r in boundaries),
            "No start boundary inside run")
    terminals = [r for r in boundaries if r["payload"].get("type") in ("task_complete", "turn_aborted")]
    require(len(terminals) == 1 and instant(terminals[0]["timestamp"]) >= instant(latest["timestamp"]),
            "Provider boundary is not closed")
    totals = {k: sum(u[k] for _, u in records.values()) for k in KEYS}
    require(all(totals[k] == latest["payload"]["turn_token_usage"].get(k) for k in KEYS),
            "Incomplete request set or inconsistent turn total")
    models = {r["payload"].get("model") for r in window if r["type"] == "turn_context" and
              r["payload"].get("root_turn_id", r["payload"].get("turn_id")) == root}
    require(len(models) == 1 and all(isinstance(m, str) and m for m in models), "Ambiguous model")
    require(totals["cache_write_input_tokens"] == 0, "Cache-write pricing not implemented")
    usage = {"inputTokens": totals["input_tokens"] - totals["cached_input_tokens"],
             "cachedInputTokens": totals["cached_input_tokens"], "outputTokens": totals["output_tokens"]}
    return {"usage": usage, "providerInputTokens": totals["input_tokens"],
            "reasoningOutputTokens": totals["reasoning_output_tokens"],
            "model": next(iter(models)), "providerResponses": len(records),
            "terminal": terminals[0]["payload"]["type"], "rootTurnId": root}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("Redirect refused")


def audit(login_home):
    opener = build_opener(ProxyHandler({}), NoRedirect())

    def get(path):
        with opener.open(BASE + path, timeout=15) as response:
            return json.load(response)

    company = get("/companies/" + COMPANY)
    require(company["name"] == "MENGINE Paperclip 隔离试点 100" and company["status"] == "paused",
            "Only the paused dedicated company is supported")
    agents = get("/companies/" + COMPANY + "/agents")
    require(len(agents) == 19 and all(a["status"] == "paused" for a in agents), "Pause all pilot agents first")
    runs = get("/companies/" + COMPANY + "/heartbeat-runs")
    require(all(r["status"] not in ("running", "queued") for r in runs), "Active provider work exists")
    session_root = (Path(login_home).resolve(strict=True) / "sessions").resolve(strict=True)
    result = []
    for summary in sorted(runs, key=lambda r: r["createdAt"]):
        run = get("/heartbeat-runs/" + summary["id"])
        require(run["companyId"] == COMPANY, "Foreign run")
        if run["startedAt"] is None:
            require(run["status"] == "cancelled" and not run["costAccountingPending"], "Unproven unstarted run")
            result.append({"runId": run["id"], "status": run["status"], "notStarted": True})
            continue
        u = run.get("usageJson") or {}
        sid = u.get("persistedSessionId") or run.get("sessionIdAfter")
        binding = "persisted_session_id"
        if not sid:
            log = get("/heartbeat-runs/" + run["id"] + "/log")["content"]
            stdout = "".join(r.get("chunk", "") for r in map(json.loads, log.splitlines()) if r.get("stream") == "stdout")
            ids = set()
            for line in stdout.splitlines():
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if event.get("type") == "thread.started":
                    ids.add(event["thread_id"])
            require(len(ids) == 1, "Cannot bind run to exactly one provider thread")
            sid = ids.pop()
            binding = "exact_run_stdout_thread_started"
        require(len(sid) == 36 and all(c in "0123456789abcdef-" for c in sid), "Invalid session ID")
        paths = list(session_root.rglob("*" + sid + "*.jsonl"))
        require(len(paths) == 1 and paths[0].resolve().is_relative_to(session_root), "Ambiguous session file")
        raw = paths[0].read_bytes()
        parsed = extract([json.loads(line) for line in raw.splitlines()], sid, run["startedAt"], run["finishedAt"])
        # A partial successful ACP receipt must not become our golden reference.
        # Only clean CLI successful runs are checked for exact adapter parity.
        parity = all(u.get(k) == v for k, v in parsed["usage"].items())
        result.append({"runId": run["id"], "agentId": run["agentId"], "status": run["status"],
                       "startedAt": run["startedAt"], "finishedAt": run["finishedAt"],
                       "sessionId": sid, "binding": binding,
                       "sourceSha256": hashlib.sha256(raw).hexdigest(),
                       "storedUsageMatches": parity, "pendingBefore": run["costAccountingPending"],
                       **parsed})
    totals = {k: sum(r.get("usage", {}).get(k, 0) for r in result)
              for k in ("inputTokens", "cachedInputTokens", "outputTokens")}
    return {"schemaVersion": 1, "companyId": COMPANY, "kind": "provider_reported_usage_not_invoice",
            "subscription": "user_ChatGPT_subscription", "incrementalMeteredApiUSD": None,
            "subscriptionInvoiceAllocationUSD": None, "totals": totals, "runs": result}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--login-home", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    report = audit(args.login_home)
    target = Path(args.output)
    target.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"runs": len(report["runs"]), "totals": report["totals"]}))
