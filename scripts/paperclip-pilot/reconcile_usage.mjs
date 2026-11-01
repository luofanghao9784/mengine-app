// Explicit local operator tool. Dry-run is the default; no scheduling or model calls.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const value = flag => { const i = args.indexOf(flag); if (i < 0 || !args[i + 1]) throw Error(`Required ${flag}`); return args[i + 1]; };
const apply = args.includes('--apply');
const runtime = fs.realpathSync(value('--runtime'));
const state = fs.realpathSync(value('--state'));
const auditPath = path.resolve(value('--audit'));
const output = path.resolve(value('--output'));
const report = JSON.parse(fs.readFileSync(auditPath));
const companyId = '5923bae1-b181-40f6-b060-e772fef05b8e';
const ensure = (ok, why) => { if (!ok) throw Error(why); };
ensure(report.companyId === companyId, 'Foreign company');
ensure(JSON.parse(fs.readFileSync(path.join(runtime, 'node_modules/paperclipai/package.json'))).version === '2026.1023.0', 'Unsupported runtime');
ensure(process.env.PAPERCLIP_PILOT_DB_PASSWORD, 'Private DB password environment binding required');
// Recompute from local source before any write. Neither auth files nor source transcripts are exported.
const freshPath = `${output}.fresh-audit.json`;
const child = spawnSync('python3', [path.join(path.dirname(fileURLToPath(import.meta.url)), 'usage_audit.py'),
  '--login-home', value('--login-home'), '--output', freshPath], { encoding: 'utf8' });
ensure(child.status === 0, 'Source audit failed; no repair attempted');
const fresh = JSON.parse(fs.readFileSync(freshPath));
fs.unlinkSync(freshPath);
ensure(JSON.stringify(report.runs.map(r => [r.runId, r.sourceSha256, r.usage])) ===
  JSON.stringify(fresh.runs.map(r => [r.runId, r.sourceSha256, r.usage])), 'Source changed since audit');
process.env.PAPERCLIP_HOME = state;
const root = path.join(runtime, 'node_modules/@paperclipai');
const load = relative => import(pathToFileURL(path.join(root, relative)).href);
const { createDb, closeRegisteredClients, costEvents, heartbeatRuns, companies, agents, issues, runUsageReceipts } = await load('db/dist/index.js');
const require = createRequire(path.join(runtime, 'package.json'));
const { eq } = require('drizzle-orm');
const { persistUsageReceipt } = await load('server/dist/services/usage-receipts.js');
const { accountRunCost } = await load('server/dist/services/run-cost-accounting.js');
const { costService } = await load('server/dist/services/costs.js');
const url = `postgres://paperclip:${encodeURIComponent(process.env.PAPERCLIP_PILOT_DB_PASSWORD)}@127.0.0.1:54329/paperclip`;
const db = createDb(url, { maxConnections: 1, applicationName: 'paperclip-pilot-100-usage-reconciliation' });
const tokenKeys = ['inputTokens', 'cachedInputTokens', 'outputTokens'];
const taskSnapshot = rows => JSON.stringify(rows.map(r => ({ id: r.id, status: r.status,
  assigneeAgentId: r.assigneeAgentId, executionRunId: r.executionRunId, updatedAt: r.updatedAt })).sort((a, b) => a.id.localeCompare(b.id)));
try {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  ensure(company?.name === 'MENGINE Paperclip 隔离试点 100' && company.status === 'paused', 'Dedicated paused company required');
  const actorRows = await db.select().from(agents).where(eq(agents.companyId, companyId));
  ensure(actorRows.length === 19 && actorRows.every(a => a.status === 'paused'), 'Actors must remain paused');
  const runRows = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId));
  ensure(runRows.length === report.runs.length && runRows.every(r => !['running', 'queued'].includes(r.status)), 'Run population changed');
  const tasksBefore = taskSnapshot(await db.select().from(issues).where(eq(issues.companyId, companyId)));
  const receiptsBefore = (await db.select().from(runUsageReceipts).where(eq(runUsageReceipts.companyId, companyId))).length;
  const eventsBefore = await db.select().from(costEvents).where(eq(costEvents.companyId, companyId));
  const planned = [];
  for (const proof of report.runs.filter(r => !r.notStarted)) {
    const run = runRows.find(r => r.id === proof.runId);
    ensure(run && run.agentId === proof.agentId && run.status === proof.status, 'Run binding changed');
    const u = run.usageJson ?? {};
    ensure(['subscription', 'subscription_included'].includes(u.billingType), 'Cannot infer subscription billing');
    ensure(u.accountingCaptureFailed !== true, 'Failed capture requires a separate investigation');
    const events = eventsBefore.filter(e => e.heartbeatRunId === run.id);
    const booked = Object.fromEntries(tokenKeys.map(k => [k, events.reduce((sum, e) => sum + Number(e[k] ?? 0), 0)]));
    const delta = Object.fromEntries(tokenKeys.map(k => [k, proof.usage[k] - booked[k]]));
    ensure(tokenKeys.every(k => delta[k] >= 0), 'Existing ledger exceeds source; refusing destructive adjustment');
    if (run.costAccountingPending) {
      ensure(!run.costAccountedAt && events.length === 0 && u.accountingReceiptSourceId, 'Ambiguous unsettled run');
      planned.push({ runId: run.id, action: 'native_receipt_and_finalize', usage: proof.usage });
      if (apply) {
        if (u.accountingReceiptReady !== true || !tokenKeys.every(k => u[k] === proof.usage[k])) {
          await persistUsageReceipt(db, {
            schema: 'paperclip/accounting-receipt/v1', id: randomUUID(), companyId, runId: run.id,
            sourceId: u.accountingReceiptSourceId, sequence: Number(u.accountingReceiptSequence ?? 0) + 1,
            receivedAt: new Date().toISOString(), adapterType: 'codex_local',
            receipt: { usage: proof.usage, usageBasis: 'per_run', provider: 'openai', biller: 'chatgpt',
              model: proof.model, billingType: 'subscription_included', costUsd: null,
              costStatus: 'unpriced', complete: true,
              pricingProvenance: { source: 'operator', version: 'pilot-provider-usage-v1',
                evidence: `Closed ${proof.terminal}; provider request sums equal turn total; source SHA256 ${proof.sourceSha256}. Subscription allocation is not an invoice.` } },
          });
        }
        ensure(await accountRunCost(db, run.id), 'Native accounting did not acknowledge recovered receipt');
      }
    } else if (tokenKeys.some(k => delta[k] > 0)) {
      ensure(run.costAccountedAt && events.length > 0, 'Missing settlement authority');
      planned.push({ runId: run.id, action: 'append_usage_delta_preserve_settled_receipt', usage: delta });
      if (apply) await costService(db).createEvent(companyId, {
        idempotencyKey: `pilot-usage-recovery:${run.id}:${proof.sourceSha256}`,
        agentId: run.agentId, heartbeatRunId: run.id, provider: 'openai', biller: 'chatgpt',
        billingType: 'subscription_included', costStatus: 'reported', model: proof.model,
        ...delta, costCents: '0', occurredAt: new Date(proof.finishedAt),
        issueId: events[0].issueId, projectId: events[0].projectId,
        pricingProvenance: { source: 'operator', version: 'pilot-provider-usage-v1',
          evidence: `Token delta only; original settlement preserved. Source SHA256 ${proof.sourceSha256}. No invoice or subscription allocation asserted.` },
      });
    }
  }
  const afterRuns = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId));
  const eventsAfter = await db.select().from(costEvents).where(eq(costEvents.companyId, companyId));
  const tasksAfter = taskSnapshot(await db.select().from(issues).where(eq(issues.companyId, companyId)));
  ensure(tasksBefore === tasksAfter, 'Unexpected task change');
  ensure(runRows.every(r => afterRuns.find(a => a.id === r.id)?.status === r.status), 'Unexpected run status change');
  for (const old of eventsBefore) ensure(JSON.stringify(old) === JSON.stringify(eventsAfter.find(e => e.id === old.id)), 'Previously settled event changed');
  const ledgerTotals = Object.fromEntries(tokenKeys.map(k => [k, eventsAfter.reduce((sum, e) => sum + Number(e[k] ?? 0), 0)]));
  if (apply) ensure(tokenKeys.every(k => ledgerTotals[k] === report.totals[k]), 'Ledger does not reconcile to source');
  const result = { mode: apply ? 'apply' : 'dry-run', companyId, planned,
    ledgerTotals, providerTotals: report.totals, pendingRuns: afterRuns.filter(r => r.costAccountingPending).length,
    eventsBefore: eventsBefore.length, eventsAfter: eventsAfter.length, receiptsBefore,
    receiptsAfter: (await db.select().from(runUsageReceipts).where(eq(runUsageReceipts.companyId, companyId))).length,
    tasksUnchanged: true, runStatusesUnchanged: true, originalSettledEventsUnchanged: true,
    subscriptionInvoiceAllocationUSD: null, incrementalApiInvoiceUSD: null };
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { await closeRegisteredClients(url); }
