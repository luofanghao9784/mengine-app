import { migrateAccess } from "./access-migration.js";
import Database from "better-sqlite3";
import {
  randomUUID,
  createHash,
  scryptSync,
  timingSafeEqual,
  randomBytes,
} from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { now, type User, type Doc, type Proposal, type FlowEventName } from "./domain.js";
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, hash: string) {
  const [salt, key] = hash.split(":");
  try {
    return timingSafeEqual(
      Buffer.from(key, "hex"),
      scryptSync(password, salt, 64),
    );
  } catch {
    return false;
  }
}
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export class Store {
  db: Database.Database;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.pragma("journal_mode=WAL");
    this.db.pragma("foreign_keys=ON");
    this.db.exec(`
 CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,sha TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(tenant_id,sha));
 CREATE INDEX IF NOT EXISTS docs_tenant ON documents(tenant_id);
 CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,seq INTEGER NOT NULL,data TEXT NOT NULL,prev_hash TEXT NOT NULL,hash TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS audit_tenant ON audit(tenant_id,seq);
 CREATE TABLE IF NOT EXISTS agent_runs(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS doc_versions(document_id TEXT NOT NULL,version INTEGER NOT NULL,tenant_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(document_id,version));
 CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS conversations_owner ON conversations(tenant_id,user_id,updated_at DESC);
 CREATE TABLE IF NOT EXISTS conversation_turns(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,seq INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(conversation_id,seq));
 CREATE TABLE IF NOT EXISTS document_flow_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT NOT NULL,document_id TEXT NOT NULL,event TEXT NOT NULL,status TEXT NOT NULL,at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS flow_document ON document_flow_events(tenant_id,document_id,seq DESC);
 CREATE TABLE IF NOT EXISTS governance_ai_reports(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,document_id TEXT NOT NULL,user_id TEXT NOT NULL,created_at TEXT NOT NULL,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS governance_ai_owner ON governance_ai_reports(tenant_id,document_id,user_id,created_at DESC);
 CREATE TABLE IF NOT EXISTS wiki_intelligence_reports(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,created_at TEXT NOT NULL,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS wiki_intelligence_owner ON wiki_intelligence_reports(tenant_id,user_id,created_at DESC);
 CREATE TABLE IF NOT EXISTS wiki_knowledge(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,source_id TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(tenant_id,source_id));
 CREATE TABLE IF NOT EXISTS wiki_learning_failures(tenant_id TEXT NOT NULL,source_id TEXT NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(tenant_id,source_id));
 CREATE TABLE IF NOT EXISTS wiki_auto_graphs(tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(tenant_id,user_id));
 CREATE TABLE IF NOT EXISTS departments(tenant_id TEXT NOT NULL,name TEXT NOT NULL,PRIMARY KEY(tenant_id,name));
 INSERT OR IGNORE INTO departments(tenant_id,name) SELECT tenant_id,json_extract(data,'$.department') FROM users;
 INSERT OR IGNORE INTO departments(tenant_id,name) SELECT tenant_id,json_extract(data,'$.department') FROM documents;
 CREATE TABLE IF NOT EXISTS harness_runs(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS data_sets(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS data_rows(id TEXT PRIMARY KEY,dataset_id TEXT NOT NULL REFERENCES data_sets(id),tenant_id TEXT NOT NULL,status TEXT NOT NULL,updated_at TEXT NOT NULL,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS data_rows_scope ON data_rows(tenant_id,dataset_id,status);
 CREATE TABLE IF NOT EXISTS data_batches(seq INTEGER PRIMARY KEY AUTOINCREMENT,dataset_id TEXT NOT NULL REFERENCES data_sets(id),tenant_id TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS data_row_versions(dataset_id TEXT NOT NULL,tenant_id TEXT NOT NULL,row_id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(dataset_id,row_id,version));
 CREATE TABLE IF NOT EXISTS database_connections(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS data_dictionary(dataset_id TEXT PRIMARY KEY REFERENCES data_sets(id),tenant_id TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS dictionary_jobs(dataset_id TEXT PRIMARY KEY REFERENCES data_sets(id),tenant_id TEXT NOT NULL,actor_id TEXT NOT NULL,state TEXT NOT NULL,updated_at TEXT NOT NULL,error TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS database_sync_jobs(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS database_sync_history(seq INTEGER PRIMARY KEY AUTOINCREMENT,dataset_id TEXT NOT NULL,tenant_id TEXT NOT NULL,at TEXT NOT NULL,data TEXT NOT NULL);
 PRAGMA user_version=10;`);
    const jobColumns = (this.db.prepare('PRAGMA table_info(dictionary_jobs)').all() as {name:string}[]).map(c=>c.name);
    if(!jobColumns.includes('attempts'))this.db.exec('ALTER TABLE dictionary_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
    if(!jobColumns.includes('next_at'))this.db.exec("ALTER TABLE dictionary_jobs ADD COLUMN next_at TEXT NOT NULL DEFAULT ''");
    migrateAccess(this);
  }
  departments(tenant: string): string[] {
    return (this.db.prepare("SELECT name FROM departments WHERE tenant_id=? AND active=1 ORDER BY name").all(tenant) as { name: string }[]).map(r => r.name);
  }
  ensureDepartment(tenant: string, name: string) {
    this.db.prepare("INSERT OR IGNORE INTO departments(tenant_id,name,id,active) VALUES(?,?,?,1)").run(tenant, name, randomUUID());
  }
  departmentId(tenant: string, name: string): string | undefined {
    return (this.db.prepare("SELECT id FROM departments WHERE tenant_id=? AND name=? AND active=1").get(tenant,name) as {id:string}|undefined)?.id;
  }
  tenant(id: string) {
    return this.db.prepare("SELECT id,name FROM tenants WHERE id=?").get(id) as
      { id: string; name: string } | undefined;
  }
  user(id: string): User | undefined {
    const r = this.db.prepare("SELECT data FROM users WHERE id=?").get(id) as
      { data: string } | undefined;
    return r ? JSON.parse(r.data) : undefined;
  }
  login(email: string, password: string) {
    const row = this.db
      .prepare("SELECT password_hash,data FROM users WHERE email=?")
      .get(email.toLowerCase()) as
      { password_hash: string; data: string } | undefined;
    return row && verifyPassword(password, row.password_hash)
      ? (JSON.parse(row.data) as User)
      : null;
  }
  users(tenant: string): User[] {
    return (
      this.db
        .prepare("SELECT data FROM users WHERE tenant_id=?")
        .all(tenant) as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  addUser(u: User, password: string) {
    this.ensureDepartment(u.tenantId, u.department);
    u.departmentId = this.departmentId(u.tenantId,u.department);
    if(u.role === "admin")u.clearance=3;
    this.db
      .prepare("INSERT INTO users VALUES(?,?,?,?,?)")
      .run(
        u.id,
        u.tenantId,
        u.email.toLowerCase(),
        passwordHash(password),
        JSON.stringify(u),
      );
  }
  saveUser(u: User) {
    u.departmentId = this.departmentId(u.tenantId,u.department);
    if(u.role === "admin")u.clearance=3;
    const prior=this.user(u.id);
    if(prior?.active && prior.role === "admin" && (!u.active || u.role !== "admin") && this.users(u.tenantId).filter(x=>x.active && x.role === "admin").length <= 1)throw Object.assign(Error("不能停用或降级最后一位企业管理员"),{statusCode:409});
    this.db
      .prepare("UPDATE users SET data=? WHERE id=? AND tenant_id=?")
      .run(JSON.stringify(u), u.id, u.tenantId);
    this.db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
  }
  documents(tenant: string): Doc[] {
    return (
      this.db
        .prepare("SELECT data FROM documents WHERE tenant_id=?")
        .all(tenant) as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  doc(tenant: string, id: string): Doc | undefined {
    const r = this.db
      .prepare("SELECT data FROM documents WHERE id=? AND tenant_id=?")
      .get(id, tenant) as { data: string } | undefined;
    return r ? JSON.parse(r.data) : undefined;
  }
  saveDoc(d: Doc, event?: FlowEventName) {
    this.db.transaction(() => {
      const previous = this.doc(d.tenantId, d.id);
      this.ensureDepartment(d.tenantId, d.department);
      d.departmentId = this.departmentId(d.tenantId,d.department);
      d.grants=d.grants.map(g=>g.subjectType === "department" ? {...g,subjectId:this.departmentId(d.tenantId,g.subjectId)||g.subjectId} : g);
      this.db
        .prepare("INSERT INTO documents VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data")
        .run(d.id, d.tenantId, d.sha, JSON.stringify(d));
      const transitions: Record<Doc["status"], FlowEventName> = {
        queued: "received", processing: "parsing", ready: "published",
        quarantined: "quarantined", failed: "failed", archived: "archived",
      };
      const recorded = event || (!previous || previous.status !== d.status ? transitions[d.status] : null);
      if (recorded) this.db.prepare("INSERT INTO document_flow_events(tenant_id,document_id,event,status,at) VALUES(?,?,?,?,?)")
        .run(d.tenantId, d.id, recorded, d.status, now());
    })();
  }
  recordFlow(d: Doc, event: FlowEventName) {
    this.db.prepare("INSERT INTO document_flow_events(tenant_id,document_id,event,status,at) VALUES(?,?,?,?,?)").run(d.tenantId,d.id,event,d.status,now());
  }
  flowEvents(tenantId: string, documentId: string) {
    return this.db.prepare("SELECT seq,event,status,at FROM document_flow_events WHERE tenant_id=? AND document_id=? ORDER BY seq DESC LIMIT 8")
      .all(tenantId, documentId) as { seq: number; event: FlowEventName; status: Doc["status"]; at: string }[];
  }
  flowMilestones(tenantId: string, documentId: string) {
    // Keep one confirmed record per event in the latest ingestion/retry cycle.
    // Unlike the recent-activity list this remains accurate after many edits.
    return this.db.prepare(`SELECT seq,event,status,at FROM document_flow_events WHERE seq IN (
      SELECT MAX(seq) FROM document_flow_events WHERE tenant_id=? AND document_id=?
      AND seq >= COALESCE((SELECT MAX(seq) FROM document_flow_events
        WHERE tenant_id=? AND document_id=? AND event IN ('received','retry')),0)
      GROUP BY event) ORDER BY seq DESC`)
      .all(tenantId, documentId, tenantId, documentId) as ReturnType<Store["flowEvents"]>;
  }
  version(d: Doc) {
    this.db
      .prepare("INSERT OR IGNORE INTO doc_versions VALUES(?,?,?,?)")
      .run(d.id, d.version, d.tenantId, JSON.stringify(d));
  }
  proposal(p: Proposal) {
    this.db
      .prepare(
        "INSERT INTO proposals VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(p.id, p.tenantId, JSON.stringify(p));
  }
  proposals(tenant: string): Proposal[] {
    return (
      this.db
        .prepare("SELECT data FROM proposals WHERE tenant_id=? ORDER BY rowid DESC")
        .all(tenant) as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  audit(u: User, action: string, target: string, detail: string) {
    this.db.transaction(() => {
      const last = this.db
        .prepare(
          "SELECT hash,seq FROM audit WHERE tenant_id=? ORDER BY seq DESC LIMIT 1",
        )
        .get(u.tenantId) as { hash: string; seq: number } | undefined;
      const id = randomUUID();
      const data = JSON.stringify({
        id,
        actor: u.name,
        actorId: u.id,
        role: u.role,
        action,
        target,
        detail,
        at: now(),
      });
      const prev = last?.hash || "GENESIS";
      this.db
        .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?)")
        .run(
          id,
          u.tenantId,
          (last?.seq || 0) + 1,
          data,
          prev,
          digest(prev + data),
        );
    })();
  }
  audits(tenant: string) {
    return (
      this.db
        .prepare(
          "SELECT data,hash,prev_hash FROM audit WHERE tenant_id=? ORDER BY seq DESC LIMIT 200",
        )
        .all(tenant) as { data: string; hash: string; prev_hash: string }[]
    ).map((r) => ({
      ...JSON.parse(r.data),
      hash: r.hash,
      prevHash: r.prev_hash,
    }));
  }
  auditValid(tenant: string) {
    let prev = "GENESIS";
    for (const row of this.db
      .prepare(
        "SELECT data,hash,prev_hash FROM audit WHERE tenant_id=? ORDER BY seq",
      )
      .all(tenant) as { data: string; hash: string; prev_hash: string }[]) {
      if (row.prev_hash !== prev || digest(prev + row.data) !== row.hash)
        return false;
      prev = row.hash;
    }
    return true;
  }
  close() {
    this.db.close();
  }
}
