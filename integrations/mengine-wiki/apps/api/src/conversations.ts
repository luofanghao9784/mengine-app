import {dictionaryFingerprint} from './dictionary-version.js';
import { randomUUID } from "node:crypto";
import { canUseAI, now, visibleText, type Evidence, type Proposal, type User } from "./domain.js";
import type { Store } from "./store.js";

export type Dependency = { documentId: string; version: number; policyVersion: number; dataFingerprint?:string };
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type AgentResult = {
  id: string; action: string; text: string; evidence: Evidence[];
  provider: string; fallback: string | null; proposal?: Proposal; latency: number;
  steps: { label: string; state: string }[];
};
export type Conversation = {
  id: string; tenantId: string; userId: string; createdAt: string; updatedAt: string; revision: number;
};
export type Turn = {
  id: string; question: string; result: AgentResult; createdAt: string;
  dependencies: Dependency[]; clearance: number;
};
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
export const mergeDependencies = (...groups: Dependency[][]): Dependency[] => {
  const merged = new Map<string, Dependency>();
  for (const d of groups.flat()) merged.set(`${d.documentId}:${d.version}:${d.policyVersion}:${d.dataFingerprint||""}`, d);
  return [...merged.values()];
};
const excerpt = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 8)}…（已节选）` : text;

export class Conversations {
  constructor(private store: Store) {store.db.exec('CREATE TABLE IF NOT EXISTS conversation_titles(id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,title TEXT NOT NULL)');}
  rename(u:User,id:string,title:string){this.get(u,id);if(!title.trim()||title.length>80)throw fail(400,'请输入1–80字的对话名称');this.store.db.prepare('INSERT INTO conversation_titles VALUES(?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title').run(id,title.trim());this.store.audit(u,'conversation.renamed',id,'修改个人对话名称');return this.detail(u,id);}
  create(u: User): Conversation {
    const c = { id: randomUUID(), tenantId: u.tenantId, userId: u.id, createdAt: now(), updatedAt: now(), revision: 0 };
    this.store.db.prepare("INSERT INTO conversations VALUES(?,?,?,?,?,?)").run(c.id, c.tenantId, c.userId, c.createdAt, c.updatedAt, c.revision);
    return c;
  }
  get(u: User, id: string): Conversation {
    const row = this.store.db.prepare("SELECT id, tenant_id AS tenantId, user_id AS userId, created_at AS createdAt, updated_at AS updatedAt, revision FROM conversations WHERE id=? AND tenant_id=? AND user_id=?")
      .get(id, u.tenantId, u.id) as Conversation | undefined;
    if (!row) throw fail(404, "对话不存在或无权访问");
    return row;
  }
  turns(u: User, id: string): Turn[] {
    this.get(u, id);
    return (this.store.db.prepare("SELECT data FROM conversation_turns WHERE conversation_id=? ORDER BY seq").all(id) as { data: string }[]).map(r => JSON.parse(r.data));
  }
  valid(u: User, dependencies: Dependency[], clearance: number) {
    return u.active && u.clearance >= clearance && dependencies.every(ref => {
      const d = this.store.doc(u.tenantId, ref.documentId);
      const dataset=ref.dataFingerprint?this.store.db.prepare('SELECT data FROM data_sets WHERE id=? AND tenant_id=?').get(ref.documentId,u.tenantId) as {data:string}|undefined:undefined;
      if(ref.dataFingerprint&&(!dataset||dictionaryFingerprint(this.store,u.tenantId,JSON.parse(dataset.data))!==ref.dataFingerprint))return false;
      return !!d && canUseAI(u, d) && d.version === ref.version && d.policyVersion === ref.policyVersion;
    });
  }
  // Questions can quote an earlier answer, so the entire dependent turn is hidden.
  publicTurn(u: User, t: Turn) {
    return this.valid(u, t.dependencies, t.clearance)
      ? { id: t.id, question: t.question, result: t.result, createdAt: t.createdAt, redacted: false }
      : { id: t.id, question: "", createdAt: t.createdAt, redacted: true };
  }
  detail(u: User, id: string) {
    const c = this.get(u, id);
    return { ...this.summary(u, c), turns: this.turns(u, id).map(t => this.publicTurn(u, t)) };
  }
  summary(u: User, c: Conversation) {
    const first = this.store.db.prepare("SELECT data FROM conversation_turns WHERE conversation_id=? ORDER BY seq LIMIT 1").get(c.id) as { data: string } | undefined;
    const turn: Turn | undefined = first ? JSON.parse(first.data) : undefined;
    const custom=this.store.db.prepare('SELECT title FROM conversation_titles WHERE id=?').get(c.id) as {title:string}|undefined;
    return { id: c.id, createdAt: c.createdAt, updatedAt: c.updatedAt, revision: c.revision,
      title: custom&&this.turns(u,c.id).every(t=>this.valid(u,t.dependencies,t.clearance))?visibleText(u,custom.title):turn && this.valid(u, turn.dependencies, turn.clearance) ? excerpt(turn.question.replace(/\s+/g, " "), 44) : "新的知识对话" };
  }
  list(u: User, offset: number) {
    const rows = this.store.db.prepare("SELECT id, tenant_id AS tenantId, user_id AS userId, created_at AS createdAt, updated_at AS updatedAt, revision FROM conversations WHERE tenant_id=? AND user_id=? ORDER BY updated_at DESC,id DESC LIMIT 51 OFFSET ?")
      .all(u.tenantId, u.id, offset) as Conversation[];
    return { items: rows.slice(0, 50).map(c => this.summary(u, c)), hasMore: rows.length > 50 };
  }
  append(u: User, c: Conversation, turn: Turn) {
    this.store.db.transaction(() => {
      const update = this.store.db.prepare("UPDATE conversations SET updated_at=?,revision=revision+1 WHERE id=? AND tenant_id=? AND user_id=? AND revision=?")
        .run(turn.createdAt, c.id, u.tenantId, u.id, c.revision);
      if (!update.changes) throw fail(409, "对话已变化，请重新打开后继续");
      this.store.db.prepare("INSERT INTO conversation_turns VALUES(?,?,?,?)").run(turn.id, c.id, c.revision + 1, JSON.stringify(turn));
    })();
  }
  remove(u: User, id: string) {
    this.get(u, id);
    this.store.db.prepare("DELETE FROM conversations WHERE id=? AND tenant_id=? AND user_id=?").run(id, u.tenantId, u.id);
  }
  context(u: User, turns: Turn[]) {
    const safe = turns.filter(t => this.valid(u, t.dependencies, t.clearance));
    const recent: Turn[] = [];
    let size = 0;
    // Keep complete recent pairs under a character budget; older pairs become extracts.
    for (const t of [...safe].reverse().slice(0, 6)) {
      const length = t.question.length + t.result.text.length;
      if (size + length > 12000) break;
      recent.unshift(t); size += length;
    }
    const older = safe.slice(0, safe.length - recent.length);
    const summarized: Turn[] = [];
    const extracts: string[] = [];
    let summarySize = 0;
    for (const t of [...older].reverse()) {
      const part = JSON.stringify({ question: excerpt(t.question, 200), answer: excerpt(t.result.text, 500) });
      if (summarySize + part.length + 1 > 6000) break;
      extracts.unshift(part); summarized.unshift(t); summarySize += part.length + 1;
    }
    const included = [...summarized, ...recent];
    return {
      messages: recent.flatMap(t => [
        { role: "user" as const, content: visibleText(u, t.question) },
        { role: "assistant" as const, content: visibleText(u, t.result.text) },
      ]),
      summary: visibleText(u, extracts.join("\n")),
      dependencies: mergeDependencies(...included.map(t => t.dependencies)),
      // Used to retrieve supporting sources for pronouns such as “第二级” or “继续”.
      previous: included.slice(-2),
      stats: { recentTurns: recent.length, summarizedTurns: summarized.length, omittedTurns: safe.length - included.length, redactedTurns: turns.length - safe.length },
    };
  }
}
