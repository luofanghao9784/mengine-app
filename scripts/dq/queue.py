#!/usr/bin/env python3
"""Issue #99 pilot-only durable dispatch ledger. No business tasks or shell runner.

SQLite serializes mutations across processes. Native Codex execution is bridged by
DQ through claim/heartbeat/finish; evidence is a local attestation, not GitHub auth.
"""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import time

ACTIVE = ("RUNNING", "STOPPING", "UNKNOWN")
GATES = ("qa", "security", "product")
APPLICATION_ID = 0x44515031


class QueueError(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def required_text(value, name):
    if not isinstance(value, str) or not value.strip() or len(value) > 4096:
        raise QueueError("invalid " + name)
    return value


def evidence(value):
    if not isinstance(value, dict):
        raise QueueError("evidence must be an object")
    required_text(value.get("receipt"), "receipt")
    if not re.fullmatch(r"[0-9a-f]{64}", value.get("sha256", "")):
        raise QueueError("evidence requires artifact sha256")
    return value


class Queue:
    def __init__(self, path, create=False, clock=time.time):
        self.path = Path(path).expanduser().resolve()
        if ".ai" in self.path.parts or self.path.name == "TASKS.json":
            raise QueueError("historical .ai authority is forbidden")
        self.clock = clock
        if create:
            self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            try:
                fd = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                pass
            else:
                os.close(fd)
        if not self.path.exists():
            raise QueueError("queue missing; initialize explicitly")
        self.db = sqlite3.connect(str(self.path), timeout=15, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA busy_timeout=15000")
        appid = self.db.execute("PRAGMA application_id").fetchone()[0]
        objects = self.db.execute("SELECT name FROM sqlite_master").fetchall()
        if appid != APPLICATION_ID:
            if not create or objects:
                self.db.close()
                raise QueueError("not a DQ pilot queue; refuse takeover")
            self._initialize()
        self.db.execute("PRAGMA foreign_keys=ON")

    def close(self):
        self.db.close()

    def _initialize(self):
        self.db.executescript("""
        BEGIN IMMEDIATE;
        PRAGMA application_id=1146179633;
        CREATE TABLE control(id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL,
          authorization TEXT, business_paused INTEGER NOT NULL CHECK(business_paused=1));
        INSERT INTO control VALUES(1,'PAUSED',NULL,1);
        CREATE TABLE task(id TEXT PRIMARY KEY, dedupe TEXT NOT NULL UNIQUE,
          fingerprint TEXT NOT NULL, spec TEXT NOT NULL, state TEXT NOT NULL,
          generation INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL,
          executor TEXT, source_sha TEXT, result TEXT);
        CREATE TABLE attempt(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES task(id),
          generation INTEGER NOT NULL, token TEXT NOT NULL, owner TEXT NOT NULL,
          state TEXT NOT NULL, deadline REAL NOT NULL, started REAL NOT NULL,
          ended REAL, stop_request TEXT, UNIQUE(task_id,generation));
        CREATE TABLE gate(task_id TEXT NOT NULL REFERENCES task(id), role TEXT NOT NULL,
          reviewer TEXT NOT NULL, source_sha TEXT NOT NULL, verdict TEXT NOT NULL,
          evidence TEXT NOT NULL, PRIMARY KEY(task_id,role));
        CREATE TABLE event(seq INTEGER PRIMARY KEY AUTOINCREMENT, at REAL NOT NULL,
          task_id TEXT, kind TEXT NOT NULL, detail TEXT NOT NULL);
        CREATE TRIGGER event_no_update BEFORE UPDATE ON event BEGIN
          SELECT RAISE(ABORT,'append only events'); END;
        CREATE TRIGGER event_no_delete BEFORE DELETE ON event BEGIN
          SELECT RAISE(ABORT,'append only events'); END;
        COMMIT;
        """)

    @contextlib.contextmanager
    def transaction(self):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            yield
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
        else:
            self.db.execute("COMMIT")

    def _event(self, kind, task_id=None, **detail):
        self.db.execute("INSERT INTO event(at,task_id,kind,detail) VALUES(?,?,?,?)",
                        (self.clock(), task_id, kind, canonical(detail)))

    def enrol(self, task_id, dedupe, payload, dependencies=(), scope="synthetic"):
        for name, value in (("id", task_id), ("dedupe", dedupe)):
            required_text(value, name)
        if scope not in ("synthetic", "pilot"):
            raise QueueError("business task enrolment is disabled")
        if not isinstance(payload, dict) or not isinstance(dependencies, (list, tuple)):
            raise QueueError("invalid task specification")
        if task_id in dependencies or len(set(dependencies)) != len(dependencies):
            raise QueueError("invalid dependencies")
        spec = dict(scope=scope, payload=payload, dependencies=list(dependencies))
        fingerprint = digest(spec)
        with self.transaction():
            old = self.db.execute("SELECT * FROM task WHERE id=? OR dedupe=?", (task_id, dedupe)).fetchall()
            if old:
                if len(old) != 1 or old[0]["fingerprint"] != fingerprint or old[0]["id"] != task_id or old[0]["dedupe"] != dedupe:
                    raise QueueError("dedupe conflict; existing task unchanged")
                return {"id": task_id, "duplicate": True, "state": old[0]["state"]}
            for dep in dependencies:
                if not self.db.execute("SELECT 1 FROM task WHERE id=?", (dep,)).fetchone():
                    raise QueueError("dependency must already exist: " + str(dep))
            self.db.execute("INSERT INTO task(id,dedupe,fingerprint,spec,state,created) VALUES(?,?,?,?,?,?)",
                            (task_id, dedupe, fingerprint, canonical(spec), "READY", self.clock()))
            self._event("ENROLLED", task_id, fingerprint=fingerprint)
        return {"id": task_id, "duplicate": False, "state": "READY"}

    def pilot_resume(self, authorization):
        if not isinstance(authorization, dict) or authorization.get("issue") != 99 or authorization.get("scope") != "isolated-pilot":
            raise QueueError("Issue 99 isolated-pilot authorization required")
        evidence(authorization)
        with self.transaction():
            if self.db.execute("SELECT 1 FROM task WHERE state IN ('UNKNOWN','STOPPING')").fetchone():
                raise QueueError("unresolved execution prevents resume")
            self.db.execute("UPDATE control SET mode='PILOT', authorization=? WHERE id=1", (canonical(authorization),))
            self._event("PILOT_RESUMED", authorization=authorization)
        return self.status()

    def pause(self):
        with self.transaction():
            self.db.execute("UPDATE control SET mode='PAUSED' WHERE id=1")
            self._event("PAUSED")
        return self.status()

    def _expire(self):
        expired = self.db.execute("SELECT a.* FROM attempt a JOIN task t ON t.id=a.task_id WHERE a.state IN ('RUNNING','STOPPING') AND a.deadline<=? AND ((t.state='RUNNING' AND t.generation=a.generation) OR (t.state='STOPPING' AND t.generation=a.generation+1))", (self.clock(),)).fetchall()
        for row in expired:
            self.db.execute("UPDATE task SET state='UNKNOWN',generation=generation+1 WHERE id=?", (row["task_id"],))
            self.db.execute("UPDATE attempt SET state='UNKNOWN',ended=? WHERE id=?", (self.clock(), row["id"]))
            self._event("EXECUTION_UNKNOWN", row["task_id"], attempt=row["id"], reason="lease expired; no replay")
        if expired:
            self.db.execute("UPDATE control SET mode='PAUSED' WHERE id=1")
        return len(expired)

    def recover(self):
        with self.transaction():
            count = self._expire()
            self._event("RECOVERED", expired=count)
        return {"expired": count, **self.status()}

    def claim(self, owner, lease_seconds=300, operation=None):
        required_text(owner, "owner")
        if not isinstance(lease_seconds, (int, float)) or not 1 <= lease_seconds <= 3600:
            raise QueueError("lease must be 1..3600 seconds")
        with self.transaction():
            self._expire()
            if self.db.execute("SELECT mode FROM control WHERE id=1").fetchone()[0] != "PILOT":
                return None
            occupied = self.db.execute("SELECT count(*) FROM task WHERE state IN ('RUNNING','STOPPING','UNKNOWN')").fetchone()[0]
            if occupied >= 3:
                return None
            for row in self.db.execute("SELECT * FROM task WHERE state='READY' ORDER BY created,id").fetchall():
                spec = json.loads(row["spec"])
                if operation is not None and spec["payload"].get("operation") != operation:
                    continue
                if any(self.db.execute("SELECT state FROM task WHERE id=?", (dep,)).fetchone()[0] != "DONE" for dep in spec["dependencies"]):
                    continue
                attempt, token = secrets.token_hex(16), secrets.token_hex(32)
                generation = row["generation"] + 1
                now = self.clock()
                self.db.execute("UPDATE task SET state='RUNNING',generation=?,executor=? WHERE id=?", (generation, owner, row["id"]))
                self.db.execute("INSERT INTO attempt(id,task_id,generation,token,owner,state,deadline,started) VALUES(?,?,?,?,?,'RUNNING',?,?)", (attempt, row["id"], generation, token, owner, now + lease_seconds, now))
                self._event("CLAIMED", row["id"], attempt=attempt, generation=generation, owner=owner)
                return dict(task_id=row["id"], attempt_id=attempt, generation=generation, token=token, spec=spec, deadline=now + lease_seconds)
        return None

    def _live(self, claim):
        row = self.db.execute("SELECT a.*,t.generation AS current_generation,t.state AS task_state FROM attempt a JOIN task t ON t.id=a.task_id WHERE a.id=?", (claim.get("attempt_id"),)).fetchone()
        if not row or row["token"] != claim.get("token") or row["task_id"] != claim.get("task_id") or row["generation"] != claim.get("generation") or row["generation"] != row["current_generation"] or row["state"] != "RUNNING" or row["task_state"] != "RUNNING" or row["deadline"] <= self.clock():
            raise QueueError("stale or invalid worker claim")
        return row

    def heartbeat(self, claim, lease_seconds=300):
        if not isinstance(lease_seconds, (int, float)) or not 1 <= lease_seconds <= 3600:
            raise QueueError("lease must be 1..3600 seconds")
        with self.transaction():
            row = self._live(claim)
            deadline = self.clock() + lease_seconds
            self.db.execute("UPDATE attempt SET deadline=? WHERE id=?", (deadline, row["id"]))
            self._event("HEARTBEAT", row["task_id"], attempt=row["id"], deadline=deadline)
        return {"deadline": deadline}

    def finish(self, claim, source_sha, test_evidence):
        if not isinstance(source_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", source_sha):
            raise QueueError("exact git commit SHA required")
        evidence(test_evidence)
        if test_evidence.get("exit_code") != 0 or test_evidence.get("kind") not in ("synthetic", "real"):
            raise QueueError("passing test receipt with explicit evidence kind required")
        with self.transaction():
            row = self._live(claim)
            self.db.execute("UPDATE task SET state='REVIEW',source_sha=?,result=? WHERE id=?", (source_sha, canonical(test_evidence), row["task_id"]))
            self.db.execute("UPDATE attempt SET state='REVIEW',ended=? WHERE id=?", (self.clock(), row["id"]))
            self._event("EXECUTION_FINISHED", row["task_id"], source_sha=source_sha, tests=test_evidence)
        return {"state": "REVIEW", "task_id": row["task_id"]}

    def review(self, task_id, role, reviewer, source_sha, verdict, receipt):
        if role not in GATES or verdict not in ("PASS", "FAIL"):
            raise QueueError("invalid gate or verdict")
        required_text(reviewer, "reviewer")
        evidence(receipt)
        with self.transaction():
            row = self.db.execute("SELECT * FROM task WHERE id=?", (task_id,)).fetchone()
            if not row or row["state"] != "REVIEW" or row["source_sha"] != source_sha:
                raise QueueError("gate must bind current REVIEW commit")
            if reviewer == row["executor"]:
                raise QueueError("executor cannot independently review itself")
            if self.db.execute("SELECT 1 FROM gate WHERE task_id=? AND role=?", (task_id, role)).fetchone():
                raise QueueError("gate already recorded; immutable decision")
            self.db.execute("INSERT INTO gate VALUES(?,?,?,?,?,?)", (task_id, role, reviewer, source_sha, verdict, canonical(receipt)))
            self._event("GATE_RECORDED", task_id, role=role, reviewer=reviewer, verdict=verdict, source_sha=source_sha, evidence=receipt)
            if verdict == "FAIL":
                state = "REJECTED"
            elif self.db.execute("SELECT count(*) FROM gate WHERE task_id=? AND verdict='PASS'", (task_id,)).fetchone()[0] == len(GATES):
                state = "DONE"
            else:
                state = "REVIEW"
            self.db.execute("UPDATE task SET state=? WHERE id=?", (state, task_id))
            if state == "DONE":
                self._event("ACCEPTED", task_id, source_sha=source_sha)
        return {"task_id": task_id, "state": state}

    def stop(self, task_id=None):
        with self.transaction():
            self.db.execute("UPDATE control SET mode='PAUSED' WHERE id=1")
            if task_id is not None and not self.db.execute("SELECT 1 FROM task WHERE id=?", (task_id,)).fetchone():
                raise QueueError("unknown task")
            rows = self.db.execute("SELECT * FROM task WHERE state='RUNNING'" + (" AND id=?" if task_id else ""), (task_id,) if task_id else ()).fetchall()
            requests = []
            for row in rows:
                request = secrets.token_hex(16)
                self.db.execute("UPDATE task SET state='STOPPING',generation=generation+1 WHERE id=?", (row["id"],))
                self.db.execute("UPDATE attempt SET state='STOPPING',stop_request=? WHERE task_id=? AND generation=?", (request, row["id"], row["generation"]))
                self._event("STOP_REQUESTED", row["id"], stop_request=request)
                requests.append({"task_id": row["id"], "stop_request": request})
            self._event("DISPATCH_STOPPED", scope=task_id or "all")
        return {"mode": "PAUSED", "requests": requests, "confirmed": False}

    def confirm_stopped(self, task_id, stop_request, actor, receipt):
        required_text(actor, "actor")
        evidence(receipt)
        if receipt.get("execution_terminated") is not True:
            raise QueueError("positive termination observation required")
        with self.transaction():
            row = self.db.execute("SELECT a.*,t.state AS task_state FROM attempt a JOIN task t ON t.id=a.task_id WHERE a.task_id=? AND a.stop_request=?", (task_id, stop_request)).fetchone()
            if not row or row["state"] != "STOPPING" or row["task_state"] != "STOPPING":
                raise QueueError("no matching pending stop")
            if row["deadline"] <= self.clock():
                raise QueueError("stop expired; recover to UNKNOWN, no optimistic confirmation")
            self.db.execute("UPDATE task SET state='STOPPED' WHERE id=?", (task_id,))
            self.db.execute("UPDATE attempt SET state='STOPPED',ended=? WHERE id=?", (self.clock(), row["id"]))
            self._event("STOP_CONFIRMED", task_id, actor=actor, evidence=receipt, stop_request=stop_request)
        return {"task_id": task_id, "state": "STOPPED"}

    def status(self):
        control = dict(self.db.execute("SELECT * FROM control WHERE id=1").fetchone())
        control.pop("id")
        control["business_paused"] = bool(control["business_paused"])
        control["authorization"] = json.loads(control["authorization"]) if control["authorization"] else None
        tasks = [dict(row) for row in self.db.execute("SELECT id,state,generation,executor,source_sha FROM task ORDER BY created,id")]
        return {**control, "max_execution": 3, "occupied": sum(t["state"] in ACTIVE for t in tasks), "tasks": tasks}

    def events(self):
        return [{**dict(row), "detail": json.loads(row["detail"])} for row in self.db.execute("SELECT * FROM event ORDER BY seq")]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=".local/dq-pilot/queue.sqlite")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("init", "status", "events", "pause", "recover"):
        commands.add_parser(name)
    enrol = commands.add_parser("enrol")
    enrol.add_argument("--id", required=True)
    enrol.add_argument("--dedupe", required=True)
    enrol.add_argument("--scope", choices=("synthetic", "pilot"), default="synthetic")
    enrol.add_argument("--payload", type=json.loads, required=True)
    enrol.add_argument("--dependency", action="append", default=[])
    resume = commands.add_parser("pilot-resume")
    resume.add_argument("--authorization", type=json.loads, required=True)
    claim = commands.add_parser("claim")
    claim.add_argument("--owner", required=True)
    claim.add_argument("--lease", type=float, default=300)
    heartbeat = commands.add_parser("heartbeat")
    heartbeat.add_argument("--claim", type=json.loads, required=True)
    heartbeat.add_argument("--lease", type=float, default=300)
    finish = commands.add_parser("finish")
    finish.add_argument("--claim", type=json.loads, required=True)
    finish.add_argument("--source-sha", required=True)
    finish.add_argument("--tests", type=json.loads, required=True)
    review = commands.add_parser("review")
    review.add_argument("--task", required=True)
    review.add_argument("--role", choices=GATES, required=True)
    review.add_argument("--reviewer", required=True)
    review.add_argument("--source-sha", required=True)
    review.add_argument("--verdict", choices=("PASS", "FAIL"), required=True)
    review.add_argument("--receipt", type=json.loads, required=True)
    stop = commands.add_parser("stop")
    stop.add_argument("--task")
    confirm = commands.add_parser("confirm-stopped")
    confirm.add_argument("--task", required=True)
    confirm.add_argument("--stop-request", required=True)
    confirm.add_argument("--actor", required=True)
    confirm.add_argument("--receipt", type=json.loads, required=True)
    args = parser.parse_args(argv)
    queue = None
    try:
        queue = Queue(args.db, create=args.command == "init")
        if args.command in ("init", "status"):
            result = queue.status()
        elif args.command == "enrol":
            result = queue.enrol(args.id, args.dedupe, args.payload, args.dependency, args.scope)
        elif args.command == "pilot-resume":
            result = queue.pilot_resume(args.authorization)
        elif args.command == "claim":
            result = queue.claim(args.owner, args.lease)
        elif args.command == "heartbeat":
            result = queue.heartbeat(args.claim, args.lease)
        elif args.command == "finish":
            result = queue.finish(args.claim, args.source_sha, args.tests)
        elif args.command == "review":
            result = queue.review(args.task, args.role, args.reviewer, args.source_sha, args.verdict, args.receipt)
        elif args.command == "stop":
            result = queue.stop(args.task)
        elif args.command == "confirm-stopped":
            result = queue.confirm_stopped(args.task, args.stop_request, args.actor, args.receipt)
        else:
            result = getattr(queue, args.command)()
        print(canonical(result))
        return 0
    except (QueueError, sqlite3.Error, OSError) as exc:
        print(canonical({"error": str(exc)}), file=sys.stderr)
        return 2
    finally:
        if queue:
            queue.close()


if __name__ == "__main__":
    sys.exit(main())
