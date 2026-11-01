"""Seed only an empty/dedicated loopback pilot. Never start agents or import tasks."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler

if not __debug__:
    raise RuntimeError("Optimized Python is unsupported: validation must remain enabled")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("Redirect refused")


def validate(plan):
    assert plan["dispatchEnabled"] is False
    assert plan["historicalImportEnabled"] is False
    assert plan["infrastructureMonthlyLimitUSD"] <= 200
    assert plan["maxDevelopmentSlots"] <= 2
    assert plan["upstream"]["version"] == "2026.1023.0"
    assert plan["adapterConfig"]["dangerouslyBypassApprovalsAndSandbox"] is False
    assert plan["adapterConfig"]["extraArgs"] == [
        "--sandbox", "read-only", "-c", 'approval_policy="never"',
        "-c", "sandbox_workspace_write.network_access=false",
    ]
    heartbeat = plan["runtimeConfig"]["heartbeat"]
    for key in ("enabled", "wakeOnDemand", "wakeOnAssignment", "wakeOnAutomation"):
        assert heartbeat[key] is False
    seen = set()
    for role in plan["roles"]:
        assert role["key"] not in seen and role["status"] == "paused"
        assert role["adapterType"] == "codex_local"
        assert role["reportsTo"] is None or role["reportsTo"] in seen
        seen.add(role["key"])
    assert len(seen) == 19


def env_value(value):
    # The real API normalizes strings into typed plain env bindings.
    if isinstance(value, dict):
        assert value.get("type") == "plain"
        return value.get("value")
    return value


def apply(plan, base, workspace):
    validate(plan)
    parsed = urlsplit(base)
    if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1"
            or parsed.username or parsed.password or parsed.path not in ("", "/")
            or parsed.query or parsed.fragment or not parsed.port):
        raise ValueError("Only explicit 127.0.0.1 HTTP pilot port accepted")
    workspace = Path(workspace).resolve()
    if not workspace.is_dir() or any(workspace.iterdir()):
        raise ValueError("Workspace must be an existing empty synthetic directory")
    opener = build_opener(ProxyHandler({}), NoRedirect())

    def api(method, path, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        request = Request(base.rstrip("/") + "/api" + path, data=data,
                          headers={"Content-Type": "application/json"}, method=method)
        with opener.open(request, timeout=30) as response:
            return json.load(response)

    companies = api("GET", "/companies")
    if any(c["name"] != plan["companyName"] for c in companies) or len(companies) > 1:
        raise ValueError("Not a dedicated pilot instance; refusing mutation")
    if companies:
        company = companies[0]
        if company["status"] != "paused":
            raise ValueError("Existing pilot is not paused; refusing mutation")
    else:
        company = api("POST", "/companies", {
            "name": plan["companyName"],
            "description": "Issue #100 synthetic pilot only; historical authority unchanged",
        })
        company = api("PATCH", "/companies/" + company["id"], {"status": "paused"})
    company_id = company["id"]
    existing = api("GET", f"/companies/{company_id}/agents")
    expected = {r["key"] for r in plan["roles"]}
    by_key = {}
    for agent in existing:
        key = (agent.get("metadata") or {}).get("pilotRole")
        if key not in expected or key in by_key or agent["status"] != "paused":
            raise ValueError("Unexpected, duplicate or active agent; refusing mutation")
        by_key[key] = agent
    if len(by_key) < len(plan["roles"]):
        # Board-authorized creation in this dedicated paused pilot only. Restore approval gate
        # even on partial failure; agents themselves can never create agents/skills.
        try:
            api("PATCH", f"/companies/{company_id}", {"requireBoardApprovalForNewAgents": False})
            for role in plan["roles"]:
                if role["key"] in by_key:
                    continue
                adapter = {**plan["adapterConfig"], "cwd": str(workspace),
                           "env": {"CODEX_HOME": str(workspace.parent / "uncredentialed-codex-home"),
                                   "OPENAI_API_KEY": ""}}
                payload = {
                    "name": role["name"], "role": "general", "title": role["key"],
                    "adapterType": "codex_local", "adapterConfig": adapter,
                    "runtimeConfig": plan["runtimeConfig"],
                    "permissions": {"canCreateAgents": False, "canCreateSkills": False},
                    "metadata": {"pilotRole": role["key"], "department": role["department"]},
                    "reportsTo": by_key[role["reportsTo"]]["id"] if role["reportsTo"] else None,
                    "capabilities": plan["operatingPolicy"].get(role["department"],
                                       "只处理内部合成试点；未经独立验收不得恢复业务调度"),
                }
                agent = api("POST", f"/companies/{company_id}/agents", payload)
                agent = api("PATCH", "/agents/" + agent["id"], {"status": "paused"})
                by_key[role["key"]] = agent
        finally:
            api("PATCH", f"/companies/{company_id}", {"requireBoardApprovalForNewAgents": True})
    agents = api("GET", f"/companies/{company_id}/agents")
    for agent in agents:
        assert agent["status"] == "paused"
        for key, value in plan["adapterConfig"].items():
            assert agent["adapterConfig"][key] == value
        for key, value in plan["runtimeConfig"]["heartbeat"].items():
            assert agent["runtimeConfig"]["heartbeat"][key] == value
        assert agent["permissions"]["canCreateAgents"] is False
        assert agent["permissions"]["canCreateSkills"] is False
        assert agent["adapterConfig"]["cwd"] == str(workspace)
        # API intentionally redacts every plain env value, including empty ones.
        # Verify shape here; verify actual empty credentials separately in local DB.
        assert set(agent["adapterConfig"]["env"]) == {"CODEX_HOME", "OPENAI_API_KEY"}
        for value in agent["adapterConfig"]["env"].values():
            assert env_value(value) == "***REDACTED***"
    assert len(agents) == 19
    company = api("GET", f"/companies/{company_id}")
    assert company["status"] == "paused"
    assert company["requireBoardApprovalForNewAgents"] is True
    issues = api("GET", f"/companies/{company_id}/issues")
    assert len(issues) == 0, "Unexpected tasks in pilot"
    return {"companyId": company_id, "status": "paused", "agentCount": len(agents),
            "agentIds": sorted(a["id"] for a in agents), "taskCount": len(issues),
            "modelCalls": "NOT_INVOKED", "historicalImport": False,
            "envVerification": "API_REDACTED_REQUIRES_LOCAL_DB_CHECK"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    parser.add_argument("--base-url")
    parser.add_argument("--workspace")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    plan = json.loads(Path(args.plan).read_text())
    validate(plan)
    if args.apply:
        if not args.base_url or not args.workspace:
            parser.error("--apply requires --base-url and --workspace")
        print(json.dumps(apply(plan, args.base_url, args.workspace), ensure_ascii=False, indent=2))
    else:
        print("PASS: paused plan validated; no network or state mutation")
