#!/usr/bin/env python3
"""Validate this project's deliberately small TOML/YAML subset without dependencies.

This checks file structure and the roster, not Codex loading or agent competence.
Run native Codex acceptance separately; see pilot-cases.json.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def unique(values, label):
    require(len(values) == len(set(values)), "duplicate " + label)


def confined(root, value):
    path = (root / value).resolve()
    require(root == path or root in path.parents, "path escapes root: " + value)
    return path


def agent_fields(path):
    # Generated TOML uses only three top-level basic strings, whose encoding is
    # also valid JSON. Reject everything outside this supported subset.
    fields = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.fullmatch(r"([a-z_]+) = (\".*\")", line)
        require(match is not None, "unsupported agent TOML: " + str(path))
        key, encoded = match.groups()
        require(key not in fields, "duplicate agent field: " + key)
        fields[key] = json.loads(encoded)
    require(set(fields) == {"name", "description", "developer_instructions"},
            "unexpected/missing fields: " + str(path))
    require(all(isinstance(v, str) and v.strip() for v in fields.values()),
            "empty agent fields: " + str(path))
    return fields


def skill_fields(path):
    text = path.read_text()
    parts = text.split("---\n", 2)
    require(len(parts) == 3 and not parts[0], "missing frontmatter: " + str(path))
    fields = {}
    for line in parts[1].splitlines():
        key, separator, value = line.partition(": ")
        require(separator and key not in fields, "invalid/duplicate YAML field")
        require(key in {"name", "description"}, "unsupported YAML field: " + key)
        fields[key] = json.loads(value) if value.startswith('"') else value
    require(set(fields) == {"name", "description"}, "missing skill field")
    require(re.fullmatch(r"dq-[a-z0-9]+(?:-[a-z0-9]+)*", fields["name"])
            and len(fields["name"]) < 64, "invalid skill name")
    require(fields["description"].strip() and parts[2].strip(), "empty skill")
    require(not re.search(r"\bTODO\b|\[TODO|PLACEHOLDER", text), "unfinished skill")
    return fields, parts[2]


def validate(root):
    root = root.resolve()
    roster = json.loads((root / ".codex/dq-team.json").read_text())
    require(roster["schema_version"] == 1 and roster["coordinator"] == "DQ",
            "invalid coordinator/schema")
    require(roster["default_mode"] == "PAUSED" and roster["scope"] == "isolated-pilot-only",
            "pilot/pause scope changed")
    require(roster["max_execution_concurrency"] == 3, "concurrency must be 3")
    roles, skills = roster["roles"], roster["skills"]
    require(len(roles) == 15 and len(skills) == 24, "expected 15 roles / 24 skills")
    unique([r["name"] for r in roles], "role")
    unique([s["name"] for s in skills], "skill")
    unique([r["path"] for r in roles] + [s["path"] for s in skills], "path")
    role_names = {r["name"] for r in roles}
    skill_names = {s["name"] for s in skills}
    mapped = [s for role in roles for s in role["skills"]]
    unique(mapped, "role skill mapping")
    require(set(mapped) == skill_names, "unmapped skill")
    hashes = {}
    bodies = []
    for role in roles:
        path = confined(root, role["path"])
        require(path.parent == root / ".codex/agents", "invalid agent directory")
        require(agent_fields(path)["name"] == role["name"], "agent name differs")
        for skill in role["skills"]:
            require(any(s["name"] == skill and s["role"] == role["name"] for s in skills),
                    "skill owner differs")
        hashes[role["path"]] = hashlib.sha256(path.read_bytes()).hexdigest()
    for skill in skills:
        require(skill["role"] in role_names, "unknown skill role")
        path = confined(root, skill["path"])
        require(path == root / ".agents/skills" / skill["name"] / "SKILL.md",
                "invalid skill directory")
        fields, body = skill_fields(path)
        require(fields["name"] == skill["name"], "skill name differs")
        bodies.append(body)
        hashes[skill["path"]] = hashlib.sha256(path.read_bytes()).hexdigest()
    unique(bodies, "skill instructions")
    require({str(p.relative_to(root)) for p in (root / ".codex/agents").glob("*.toml")}
            == {r["path"] for r in roles}, "unlisted agent file")
    require({p.parent.name for p in (root / ".agents/skills").glob("dq-*/SKILL.md")}
            == skill_names, "unlisted dq skill")
    config = [line.strip() for line in (root / ".codex/config.toml").read_text().splitlines()
              if line.strip() and not line.lstrip().startswith("#")]
    require(config == ["[agents]", "enabled = true", "max_concurrent_threads_per_session = 3"],
            "unexpected project config; update validator deliberately")
    cases = json.loads((root / "scripts/dq-team/pilot-cases.json").read_text())["cases"]
    require(len(cases) == 24, "expected 24 pilot cases")
    unique([c["id"] for c in cases], "case id")
    unique([c["skill"] for c in cases], "case skill")
    require({c["skill"] for c in cases} == skill_names, "missing pilot case")
    for case in cases:
        require(any(s["name"] == case["skill"] and s["role"] == case["role"] for s in skills),
                "pilot case role differs")
        require(case["task"].strip() and case["acceptance"], "missing task/rubric")
        require(case["status"] == "NOT_RUN", "fixtures cannot claim execution")
    return {"status": "PASS", "roles": 15, "skills": 24, "pilot_cases": 24,
            "validation": "restricted-format-and-manifest-only", "sha256": hashes,
            "native_loading": "NOT_VERIFIED", "behavioral_acceptance": "NOT_VERIFIED"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    try:
        print(json.dumps(validate(args.root), ensure_ascii=False, indent=2))
    except (ValueError, KeyError, OSError, TypeError) as error:
        parser.exit(1, "FAIL: " + str(error) + "\n")
