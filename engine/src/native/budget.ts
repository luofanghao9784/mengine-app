import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

/** Amounts are integer micro-yuan. This is a resource policy, not a retail tariff. */
export const LONG_TASK_POLICY = Object.freeze({
  softMs: 15 * 60_000, hardMs: 30 * 60_000,
  softMicros: 2_000_000, hardMicros: 5_000_000, dailyMicros: 20_000_000,
  timezone: 'Asia/Shanghai',
});
export class BudgetError extends Error {
  constructor(readonly code: string) { super(code); }
}
export interface Price {
  /** Exact verified provider/model tariff version, stored with every reservation. */
  version: string;
  input: number; output: number; cacheRead: number; cacheWrite: number;
  /** True only when reasoning is already included in outputTokens. */
  reasoningIncluded: boolean;
}
export interface Usage { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number }
export interface BudgetScope { tenant: string; user: string; task: string }
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
const key = (scope: BudgetScope) => {
  if (![scope.tenant, scope.user, scope.task].every(v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v)))
    throw new BudgetError('INVALID_BUDGET_SCOPE');
  return createHash('sha256').update(JSON.stringify([scope.tenant, scope.user, scope.task])).digest('hex');
};
function priceValid(price: Price) {
  if (!price.version || price.version.length > 128 || ![price.input, price.output, price.cacheRead, price.cacheWrite].every(integer)
      || !price.reasoningIncluded) throw new BudgetError('MODEL_PRICE_UNVERIFIED');
}
export function usageCost(usage: Usage, price: Price) {
  priceValid(price);
  const values = [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens ?? 0, usage.cacheWriteTokens ?? 0, usage.reasoningTokens ?? 0];
  if (!values.every(integer) || values.some(v => v > 10_000_000) || values[4]! > values[1]!)
    throw new BudgetError('MODEL_USAGE_INVALID');
  const total = BigInt(values[0]!) * BigInt(price.input) + BigInt(values[1]!) * BigInt(price.output)
    + BigInt(values[2]!) * BigInt(price.cacheRead) + BigInt(values[3]!) * BigInt(price.cacheWrite);
  const result = Number((total + 999_999n) / 1_000_000n);
  if (!integer(result)) throw new BudgetError('MODEL_USAGE_INVALID');
  return result;
}
function day(now: number) { return new Intl.DateTimeFormat('en-CA', { timeZone: LONG_TASK_POLICY.timezone,
  year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }

/** Shared host-side ledger. Never mount this DB inside an agent's writable/readable workspace.
 * BEGIN IMMEDIATE serializes reservations across processes and all descendant agents.
 * Unknown usage retains its full reservation; restarting never frees uncertain spend.
 */
export class LongTaskBudget {
  private db: DatabaseSync;
  constructor(path: string, private now: () => number = Date.now) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS dh_budget_tasks (
        id TEXT PRIMARY KEY, tenant TEXT NOT NULL, user TEXT NOT NULL, task TEXT NOT NULL,
        started_ms INTEGER NOT NULL, blocked TEXT);
      CREATE TABLE IF NOT EXISTS dh_budget_calls (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES dh_budget_tasks(id),
        tenant TEXT NOT NULL, user TEXT NOT NULL, day TEXT NOT NULL,
        reservation INTEGER NOT NULL CHECK(reservation>=0), actual INTEGER,
        price TEXT NOT NULL, usage TEXT, state TEXT NOT NULL CHECK(state IN ('RESERVED','SETTLED','UNKNOWN')));
      CREATE INDEX IF NOT EXISTS dh_budget_daily ON dh_budget_calls(tenant,user,day);`);
  }
  close() { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private totals(scope: BudgetScope, id: string, now: number) {
    const task = this.db.prepare(`SELECT coalesce(sum(coalesce(actual,reservation)),0) AS value FROM dh_budget_calls WHERE task_id=?`).get(id)!;
    // Outstanding requests from yesterday still occupy today's available budget.
    const daily = this.db.prepare(`SELECT coalesce(sum(coalesce(actual,reservation)),0) AS value FROM dh_budget_calls
      WHERE tenant=? AND user=? AND (day=? OR state IN ('RESERVED','UNKNOWN'))`).get(scope.tenant, scope.user, day(now))!;
    return { task: Number(task.value), daily: Number(daily.value) };
  }
  reserve(scope: BudgetScope, callId: string, maxInputTokens: number, maxOutputTokens: number, price: Price) {
    const id = key(scope); priceValid(price);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(callId) || !integer(maxInputTokens) || !integer(maxOutputTokens)
        || maxInputTokens > 10_000_000 || maxOutputTokens < 1 || maxOutputTokens > 1_000_000)
      throw new BudgetError('INVALID_RESERVATION');
    const reservation = usageCost({ inputTokens: maxInputTokens, outputTokens: maxOutputTokens },
      { ...price, input: Math.max(price.input, price.cacheRead, price.cacheWrite) });
    return this.transaction(() => {
      const now = this.now();
      this.db.prepare('INSERT OR IGNORE INTO dh_budget_tasks(id,tenant,user,task,started_ms) VALUES(?,?,?,?,?)')
        .run(id, scope.tenant, scope.user, scope.task, now);
      const task = this.db.prepare('SELECT * FROM dh_budget_tasks WHERE id=?').get(id)!;
      // A repeated dispatch id is never permission to call the provider twice.
      if (this.db.prepare('SELECT id FROM dh_budget_calls WHERE id=?').get(callId)) throw new BudgetError('MODEL_CALL_ALREADY_RESERVED');
      if (task.blocked) throw new BudgetError(String(task.blocked));
      if (now < Number(task.started_ms) || now - Number(task.started_ms) >= LONG_TASK_POLICY.hardMs)
        throw new BudgetError('TASK_TIME_BUDGET');
      const totals = this.totals(scope, id, now);
      if (totals.task + reservation > LONG_TASK_POLICY.hardMicros) throw new BudgetError('TASK_COST_BUDGET');
      if (totals.daily + reservation > LONG_TASK_POLICY.dailyMicros) throw new BudgetError('DAILY_COST_BUDGET');
      this.db.prepare(`INSERT INTO dh_budget_calls(id,task_id,tenant,user,day,reservation,price,state) VALUES(?,?,?,?,?,?,?,'RESERVED')`)
        .run(callId, id, scope.tenant, scope.user, day(now), reservation, JSON.stringify(price));
      return { reservedMicros: reservation, remainingMs: LONG_TASK_POLICY.hardMs - (now - Number(task.started_ms)),
        softLimit: now - Number(task.started_ms) >= LONG_TASK_POLICY.softMs || totals.task + reservation >= LONG_TASK_POLICY.softMicros };
    });
  }
  settle(scope: BudgetScope, callId: string, usage: Usage | null) {
    const id = key(scope);
    return this.transaction(() => {
      const call = this.db.prepare('SELECT * FROM dh_budget_calls WHERE id=? AND task_id=?').get(callId, id);
      if (!call) throw new BudgetError('BUDGET_ACCESS_DENIED');
      const normalized = usage === null ? null : JSON.stringify({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens ?? 0, cacheWriteTokens: usage.cacheWriteTokens ?? 0, reasoningTokens: usage.reasoningTokens ?? 0 });
      if (call.state === 'SETTLED') {
        if (call.usage !== normalized) throw new BudgetError('BUDGET_RECEIPT_CONFLICT');
        return;
      }
      const actual = usage === null ? null : usageCost(usage, JSON.parse(String(call.price)) as Price);
      this.db.prepare('UPDATE dh_budget_calls SET actual=?,usage=?,state=? WHERE id=?')
        .run(actual, normalized, usage === null ? 'UNKNOWN' : 'SETTLED', callId);
      if (actual !== null && actual > Number(call.reservation)) {
        // Preserve the real bill; freeze further execution instead of silently clipping it.
        this.db.prepare("UPDATE dh_budget_tasks SET blocked='MODEL_RESERVATION_EXCEEDED' WHERE id=?").run(id);
      }
    });
  }
  snapshot(scope: BudgetScope) {
    const id = key(scope), now = this.now();
    return this.transaction(() => {
      const task = this.db.prepare('SELECT * FROM dh_budget_tasks WHERE id=?').get(id);
      return { ...this.totals(scope, id, now), startedMs: task ? Number(task.started_ms) : null,
        blocked: task?.blocked ?? null, day: day(now), policy: LONG_TASK_POLICY };
    });
  }
}
