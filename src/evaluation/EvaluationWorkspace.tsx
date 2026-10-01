import { useRequestLock } from '../shared/request-guard';
import { useEffect, useState } from 'react';
import type {
  Criterion,
  Evaluation,
  EvaluationAsset,
  EvaluationContent,
  EvaluationIssue,
  Evidence,
  IssueChange,
  Judgment,
} from '../../contracts/public-api/evaluation';
import { identityClient, useSession } from '../identity/session';
import { Badge, Button, Field, Modal } from '../shared/ui';
import { Failure, FormActions, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { evaluationClient as api, dimensions, issueStatuses, modes, outcomes, verdicts } from './client';
import './evaluation.css';
export function EvaluationWorkspace({ tenant }: { tenant?: string }) {
  const { session } = useSession(),
    [workspace, setWorkspace] = useState<string | null>(null),
    [tab, setTab] = useState<'assets' | 'runs' | 'issues'>('assets'),
    [page, setPage] = useState(0),
    [refresh, setRefresh] = useState(0);
  const context = useRemote(
    (signal) => (tenant ? identityClient.context(tenant, signal) : Promise.resolve(null)),
    [tenant, session.identity],
  );
  useEffect(() => {
    setWorkspace(tenant ? (context.value?.workspaces[0]?.id ?? null) : null);
    setPage(0);
  }, [tenant, context.value]);
  const changed = () => setRefresh((x) => x + 1);
  return (
    <section className="access-panel evaluation-panel">
      <header className="evaluation-heading">
        <div>
          <h2>评价与问题处理</h2>
          <p className="muted">标准、运行事实、人工判断和采用决定分别保留。当前未验证真实业务质量。</p>
        </div>
        <Button onClick={changed}>刷新评价</Button>
      </header>
      {context.error ? (
        <Failure error={context.error} retry={changed} />
      ) : context.value === undefined ? (
        <Loading />
      ) : (
        <>
          <div className="evaluation-toolbar">
            {tenant ? (
              <Field label="评价范围">
                <select
                  aria-label="评价范围"
                  value={workspace ?? ''}
                  onChange={(e) => {
                    setWorkspace(e.target.value);
                    setPage(0);
                  }}
                >
                  {context.value?.workspaces.map((w) => (
                    <option value={w.id} key={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Badge>平台通用合成范围</Badge>
            )}
            <nav aria-label="评价分类">
              {(['assets', 'runs', 'issues'] as const).map((t, i) => (
                <Button
                  key={t}
                  variant={tab === t ? 'primary' : 'secondary'}
                  onClick={() => {
                    setTab(t);
                    setPage(0);
                  }}
                >
                  {['标准与样例', '评价记录', '问题处理'][i]}
                </Button>
              ))}
            </nav>
          </div>
          {(!tenant || workspace) && (
            <ScopeContents
              key={(tenant ?? 'platform') + (workspace ?? '')}
              tenant={tenant}
              workspace={workspace}
              tab={tab}
              page={page}
              setPage={setPage}
              refresh={refresh}
              changed={changed}
            />
          )}
        </>
      )}
    </section>
  );
}
function ScopeContents({
  tenant,
  workspace,
  tab,
  page,
  setPage,
  refresh,
  changed,
}: {
  tenant?: string;
  workspace: string | null;
  tab: 'assets' | 'runs' | 'issues';
  page: number;
  setPage: (p: number) => void;
  refresh: number;
  changed: () => void;
}) {
  const { session } = useSession(),
    [editing, setEditing] = useState<EvaluationAsset | 'STANDARD' | 'SAMPLE' | null>(null),
    [history, setHistory] = useState<EvaluationAsset | null>(null),
    [run, setRun] = useState<Evaluation | 'new' | null>(null),
    [issue, setIssue] = useState<EvaluationIssue | 'new' | null>(null);
  const scope = useRemote(
    (signal) => api.scope(tenant, workspace, signal),
    [tenant, workspace, refresh, session.identity],
  );
  const data = useRemote(
    async (signal) => {
      const [standards, samples, runs, issues] = await Promise.all([
        api.assets(tenant, workspace, 'STANDARD', tab === 'assets' ? page * 20 : 0, signal),
        api.assets(tenant, workspace, 'SAMPLE', tab === 'assets' ? page * 20 : 0, signal),
        api.runs(tenant, workspace, tab === 'runs' ? page * 20 : 0, signal),
        api.issues(tenant, workspace, tab === 'issues' ? page * 20 : 0, signal),
      ]);
      return { standards, samples, runs, issues };
    },
    [tenant, workspace, tab, page, refresh, session.identity],
  );
  if (data.error || scope.error) return <Failure error={data.error ?? scope.error} retry={changed} />;
  if (!data.value || !scope.value) return <Loading />;
  const d = data.value,
    write = scope.value.canMaintain,
    done = () => {
      setEditing(null);
      setRun(null);
      setIssue(null);
      changed();
    };
  return (
    <>
      <div className="evaluation-actions">
        {write &&
          (tab === 'assets' ? (
            <>
              <Button onClick={() => setEditing('STANDARD')}>新建标准</Button>
              <Button onClick={() => setEditing('SAMPLE')}>新建样例</Button>
            </>
          ) : tab === 'runs' ? (
            <Button onClick={() => setRun('new')}>发起评价</Button>
          ) : (
            <Button onClick={() => setIssue('new')}>登记问题</Button>
          ))}
        {!write && <p className="muted">当前可查看，未获此范围评价维护资格。</p>}
      </div>
      {tab === 'assets' ? (
        <div className="evaluation-columns">
          {[d.standards, d.samples].map((list, i) => (
            <section key={i}>
              <h3>{i ? '评测样例' : '评价标准'}</h3>
              {!list.items.length && <p className="muted">暂无当前可读记录。</p>}
              {list.items.map((a) => (
                <article className="evaluation-card" key={a.id}>
                  <header>
                    <strong>{a.version.content.title}</strong>
                    <Badge>
                      {a.status === 'ACTIVE' ? '有效' : '已撤回'} · v{a.version.revision}
                    </Badge>
                  </header>
                  <p>{a.version.content.description}</p>
                  <small>
                    {modes[a.version.mode]} ·{' '}
                    {a.version.content.purpose === 'REGRESSION' ? '回归用途' : '开发调优用途'}
                  </small>
                  <div className="evaluation-actions">
                    <Button onClick={() => setHistory(a)}>内容与版本</Button>
                    {write && <Button onClick={() => setEditing(a)}>修订或撤回</Button>}
                  </div>
                </article>
              ))}
            </section>
          ))}
        </div>
      ) : tab === 'runs' ? (
        <div className="evaluation-list">
          {!d.runs.items.length && <p>尚无评价。合成通过只证明受测机制。</p>}
          {d.runs.items.map((r) => (
            <article className="evaluation-card" key={r.id}>
              <header>
                <strong>{new Date(r.createdAt).toLocaleString('zh-CN')}</strong>
                <Badge>
                  {r.validity === 'DETAILS_UNAVAILABLE'
                    ? '详细依据不可用，保留原判定与分母'
                    : r.validity === 'CURRENT'
                      ? '当前依据'
                      : r.validity === 'STALE'
                        ? '依据已改变'
                        : '已有复核'}
                </Badge>
              </header>
              <p>
                {r.uniqueOrigins} 个独立来源 · {r.modes.map((m) => modes[m]).join('、')} · 业务质量未验证 ·
                未作采用决定
              </p>
              <div className="evaluation-metrics">
                {r.coverage.map((c) => (
                  <div key={c.dimension}>
                    <b>{dimensions[c.dimension]}</b>
                    <span>
                      符合 {c.pass} / 不符合 {c.fail} / 未知 {c.unknown}
                    </span>
                    <small>检查项分母 {c.denominator}</small>
                  </div>
                ))}
              </div>
              <details>
                <summary>查看具体证据与缺口</summary>
                {r.findings.map((f, i) => (
                  <p key={i}>
                    <Badge>{verdicts[f.verdict]}</Badge> {dimensions[f.dimension]} · {f.criterion}：{f.note}（
                    {f.basis === 'HUMAN' ? '人工判断' : f.basis === 'PROGRAM' ? '程序核对' : '缺少依据'}）
                  </p>
                ))}
              </details>
              {write && r.validity === 'CURRENT' && <Button onClick={() => setRun(r)}>记录复核判断</Button>}
            </article>
          ))}
        </div>
      ) : (
        <div className="evaluation-list">
          {!d.issues.items.length && <p>没有当前可读的问题；后台每次等待不会自动生成问题。</p>}
          {d.issues.items.map((i) => (
            <article className="evaluation-card" key={i.id}>
              <header>
                <strong>{i.title}</strong>
                <Badge>{issueStatuses[i.status]}</Badge>
              </header>
              <p>{i.impact}</p>
              <p>下一步：{i.nextAction}</p>
              <small>
                {i.assignee
                  ? i.assignee === session.identity?.account.id
                    ? '本人负责'
                    : '已指派有权处理者'
                  : '责任尚未分配'}
                {i.outcome ? ' · ' + outcomes[i.outcome] : ''}
              </small>
              <details>
                <summary>处理记录</summary>
                {i.history.map((h) => (
                  <p key={h.revision}>
                    v{h.revision} · {issueStatuses[h.status]} · {h.note}
                    {h.basis === 'HUMAN_CONFIRMATION' ? '（人工确认，不改原任务执行事实）' : ''}
                  </p>
                ))}
              </details>
              {write && <Button onClick={() => setIssue(i)}>处理或转交</Button>}
            </article>
          ))}
        </div>
      )}
      <Pager
        page={page}
        next={
          tab === 'assets'
            ? d.standards.hasMore || d.samples.hasMore
            : tab === 'runs'
              ? d.runs.hasMore
              : d.issues.hasMore
        }
        onPage={setPage}
      />
      {editing && (
        <AssetEditor
          tenant={tenant}
          workspace={workspace}
          value={editing}
          done={done}
          close={() => setEditing(null)}
        />
      )}
      {history && <AssetHistory tenant={tenant} asset={history} close={() => setHistory(null)} />}
      {run && (
        <RunEditor
          tenant={tenant}
          workspace={workspace}
          value={run}
          standards={d.standards.items}
          samples={d.samples.items}
          done={done}
          close={() => setRun(null)}
        />
      )}
      {issue && (
        <IssueEditor
          tenant={tenant}
          workspace={workspace}
          value={issue}
          samples={d.samples.items}
          done={done}
          close={() => setIssue(null)}
        />
      )}
    </>
  );
}
const initialContent = (kind: 'STANDARD' | 'SAMPLE'): EvaluationContent => ({
  title: '',
  purpose: 'REGRESSION',
  description: '',
  criteria:
    kind === 'STANDARD'
      ? [
          {
            key: 'check_1',
            dimension: 'FACT',
            strength: 'REQUIRED',
            check: 'EVIDENCE_AVAILABLE',
            requirement: '检查所选证据及其版本当前可读有效',
          },
        ]
      : [],
  input: '',
  expected: '',
  observed: '',
  unknowns: '',
});
function AssetEditor({
  tenant,
  workspace,
  value,
  done,
  close,
}: {
  tenant?: string;
  workspace: string | null;
  value: EvaluationAsset | 'STANDARD' | 'SAMPLE';
  done: () => void;
  close: () => void;
}) {
  const existing = typeof value === 'string' ? null : value,
    kind = existing?.kind ?? (value as 'STANDARD' | 'SAMPLE');
  const [content, setContent] = useState<EvaluationContent>(
      existing?.version.content ?? initialContent(kind),
    ),
    [refs, setRefs] = useState<Evidence[]>(existing?.version.evidence ?? []);
  const submit = useSubmission<{ content: EvaluationContent; refs: Evidence[]; withdraw: boolean }>();
  const field = (key: keyof EvaluationContent, text: string) => setContent((c) => ({ ...c, [key]: text }));
  const save = (withdraw = false) =>
    submit.submit({ content, refs, withdraw }, async (b, key) => {
      if (existing) await api.revise(tenant, existing, key, b.content, b.refs, b.withdraw);
      else await api.create(tenant, workspace, key, kind, b.content, b.refs);
      done();
    });
  useRequestLock(submit.busy || submit.uncertain);
  return (
    <Modal
      title={existing ? '修订或撤回' : '新建' + (kind === 'STANDARD' ? '评价标准' : '评测样例')}
      onClose={() => {
        if (!submit.busy && !submit.uncertain) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={submit.busy || submit.uncertain}>
          <Field label="名称">
            <input
              aria-label="名称"
              required
              maxLength={180}
              value={content.title}
              onChange={(e) => field('title', e.target.value)}
            />
          </Field>
          <Field label="适用范围与依据">
            <textarea
              aria-label="适用范围与依据"
              required
              maxLength={2000}
              value={content.description}
              onChange={(e) => field('description', e.target.value)}
            />
          </Field>
          <Field label="用途">
            <select
              aria-label="用途"
              value={content.purpose}
              onChange={(e) => field('purpose', e.target.value)}
            >
              <option value="REGRESSION">回归检查</option>
              <option value="DEVELOPMENT">开发与调优</option>
            </select>
          </Field>
          {kind === 'STANDARD' ? (
            <>
              <h3>检查项</h3>
              {content.criteria.map((c, i) => (
                <fieldset className="evaluation-criterion" key={i}>
                  <Field label={`要求 ${i + 1}`}>
                    <textarea
                      aria-label={`要求 ${i + 1}`}
                      required
                      value={c.requirement}
                      onChange={(e) =>
                        setContent((x) => ({
                          ...x,
                          criteria: x.criteria.map((q, n) =>
                            n === i ? { ...q, requirement: e.target.value } : q,
                          ),
                        }))
                      }
                    />
                  </Field>
                  <div className="evaluation-columns">
                    <Field label={`判断维度 ${i + 1}`}>
                      <select
                        aria-label={`判断维度 ${i + 1}`}
                        value={c.dimension}
                        onChange={(e) =>
                          setContent((x) => ({
                            ...x,
                            criteria: x.criteria.map((q, n) =>
                              n === i
                                ? {
                                    ...q,
                                    dimension: e.target.value as Criterion['dimension'],
                                    check: 'MANUAL',
                                  }
                                : q,
                            ),
                          }))
                        }
                      >
                        {Object.entries(dimensions).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={`检查方式 ${i + 1}`}>
                      <select
                        aria-label={`检查方式 ${i + 1}`}
                        value={c.check}
                        onChange={(e) =>
                          setContent((x) => ({
                            ...x,
                            criteria: x.criteria.map((q, n) =>
                              n === i ? { ...q, check: e.target.value as Criterion['check'] } : q,
                            ),
                          }))
                        }
                      >
                        <option value="MANUAL">人工有据判断，未判断时未知</option>
                        {c.dimension === 'FACT' && <option value="EVIDENCE_AVAILABLE">证据版本可用</option>}
                        {c.dimension === 'RUNTIME' && <option value="TASK_SUCCEEDED">原任务执行成功</option>}
                        {['FACT', 'CONTENT_QUALITY'].includes(c.dimension) && (
                          <option value="SYNTHETIC_EQUALS">合成预期与观察值一致</option>
                        )}
                      </select>
                    </Field>
                    <Field label={`要求强度 ${i + 1}`}>
                      <select
                        aria-label={`要求强度 ${i + 1}`}
                        value={c.strength}
                        onChange={(e) =>
                          setContent((x) => ({
                            ...x,
                            criteria: x.criteria.map((q, n) =>
                              n === i ? { ...q, strength: e.target.value as Criterion['strength'] } : q,
                            ),
                          }))
                        }
                      >
                        <option value="REQUIRED">必须满足</option>
                        <option value="QUALITY">质量目标</option>
                        <option value="PREFERENCE">表达偏好</option>
                      </select>
                    </Field>
                  </div>
                  {content.criteria.length > 1 && (
                    <Button
                      onClick={() =>
                        setContent((x) => ({ ...x, criteria: x.criteria.filter((_, n) => n !== i) }))
                      }
                    >
                      移除本检查项
                    </Button>
                  )}
                </fieldset>
              ))}
              <Button
                disabled={content.criteria.length >= 20}
                onClick={() =>
                  setContent((x) => ({
                    ...x,
                    criteria: [
                      ...x.criteria,
                      {
                        key: 'check_' + crypto.randomUUID().slice(0, 8),
                        dimension: 'CONTENT_QUALITY',
                        strength: 'QUALITY',
                        check: 'MANUAL',
                        requirement: '',
                      },
                    ],
                  }))
                }
              >
                添加检查项
              </Button>
            </>
          ) : (
            <>
              <Field label="样例输入与场景">
                <textarea
                  aria-label="样例输入与场景"
                  maxLength={4000}
                  value={content.input}
                  onChange={(e) => field('input', e.target.value)}
                />
              </Field>
              <Field label="可接受结果或合成预期">
                <textarea
                  aria-label="可接受结果或合成预期"
                  maxLength={4000}
                  value={content.expected}
                  onChange={(e) => field('expected', e.target.value)}
                />
              </Field>
              <Field label="合成观察值" hint="仅用于固定样例核对；真实任务事实由服务端读取。">
                <textarea
                  aria-label="合成观察值"
                  maxLength={4000}
                  value={content.observed}
                  onChange={(e) => field('observed', e.target.value)}
                />
              </Field>
            </>
          )}
          <Field label="未知项与未覆盖范围">
            <textarea
              aria-label="未知项与未覆盖范围"
              maxLength={2000}
              value={content.unknowns}
              onChange={(e) => field('unknowns', e.target.value)}
            />
          </Field>
          {tenant && workspace && (
            <EvidencePicker tenant={tenant} workspace={workspace} value={refs} onChange={setRefs} />
          )}
          {!tenant && <p className="muted">平台只保存通用合成案例，不引用企业资料、任务或反馈。</p>}
        </fieldset>
        <SubmitError error={submit.error} uncertain={submit.uncertain} />
        <FormActions>
          {existing && existing.status === 'ACTIVE' && (
            <Button disabled={submit.busy || submit.uncertain} onClick={() => void save(true)}>
              撤回此依据
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={submit.busy}>
            {submit.uncertain ? '核对并重试原请求' : '保存不可变版本'}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
export function EvidencePicker({
  tenant,
  workspace,
  value,
  onChange,
}: {
  tenant: string;
  workspace: string;
  value: Evidence[];
  onChange: (v: Evidence[]) => void;
}) {
  const [kind, setKind] = useState<Evidence['kind']>('TASK'),
    [refresh, setRefresh] = useState(0);
  const options = useRemote(
    (signal) => api.options(tenant, workspace, kind, signal),
    [tenant, workspace, kind, refresh],
  );
  return (
    <fieldset className="evaluation-evidence">
      <legend>关联真实依据</legend>
      <Field label="依据类型">
        <select
          aria-label="依据类型"
          value={kind}
          onChange={(e) => setKind(e.target.value as Evidence['kind'])}
        >
          <option value="TASK">本人任务</option>
          <option value="FEEDBACK">本人反馈</option>
          <option value="MATERIAL_VERSION">获权资料版本</option>
        </select>
      </Field>
      {options.error ? (
        <Failure error={options.error} retry={() => setRefresh((x) => x + 1)} />
      ) : !options.value ? (
        <Loading />
      ) : (
        <>
          <Field label="选择确切对象版本">
            <select
              aria-label="选择确切对象版本"
              value=""
              onChange={(e) => {
                const option = options.value?.items.find((o) => o.evidence.id === e.target.value);
                if (
                  option &&
                  !value.some((v) => v.kind === option.evidence.kind && v.id === option.evidence.id)
                )
                  onChange([...value, option.evidence]);
              }}
            >
              <option value="">不关联时按合成样例处理</option>
              {options.value.items.map((o) => (
                <option key={o.evidence.id} value={o.evidence.id}>
                  {o.title.slice(0, 50)} · v{o.evidence.revision} · {o.state}
                </option>
              ))}
            </select>
          </Field>
          {options.value.hasMore && <small>显示最近 50 项；历史对象可从原对象定位后维护。</small>}
        </>
      )}
      {value.map((e, i) => (
        <div className="evaluation-evidence-row" key={i}>
          <span>
            {e.kind === 'TASK' ? '本人任务' : e.kind === 'FEEDBACK' ? '本人反馈' : '资料版本'} · v{e.revision}{' '}
            · {e.id.slice(0, 8)}
          </span>
          <Button onClick={() => onChange(value.filter((_, n) => n !== i))}>移除关联</Button>
        </div>
      ))}
    </fieldset>
  );
}
function AssetHistory({
  tenant,
  asset,
  close,
}: {
  tenant?: string;
  asset: EvaluationAsset;
  close: () => void;
}) {
  const [revision, setRevision] = useState(asset.revision);
  const result = useRemote(
    (signal) => api.asset(tenant, asset.id, revision, signal),
    [tenant, asset.id, revision],
  );
  return (
    <Modal title="不可变依据版本" onClose={close}>
      <Field label="版本">
        <select aria-label="版本" value={revision} onChange={(e) => setRevision(Number(e.target.value))}>
          {Array.from({ length: asset.revision }, (_, i) => (
            <option value={i + 1} key={i}>
              v{i + 1}
            </option>
          ))}
        </select>
      </Field>
      {result.error ? (
        <Failure error={result.error} retry={() => setRevision(asset.revision)} />
      ) : !result.value ? (
        <Loading />
      ) : (
        <article>
          <h3>{result.value.version.content.title}</h3>
          <p>{result.value.version.content.description}</p>
          {result.value.version.content.criteria.map((c) => (
            <p key={c.key}>
              {dimensions[c.dimension]} · {c.requirement}
            </p>
          ))}
          {(['input', 'expected', 'observed', 'unknowns'] as const).map((k, i) => (
            <div key={k}>
              <h4>{['样例输入', '可接受结果', '合成观察值', '未知与未覆盖'][i]}</h4>
              <p className="evaluation-prose">{result.value!.version.content[k] || '未填写'}</p>
            </div>
          ))}
          <Badge>{modes[result.value.version.mode]}</Badge>
          {tenant &&
            asset.workspaceId &&
            result.value.version.evidence.map((e, i) => (
              <EvidenceReadout key={i} tenant={tenant} workspace={asset.workspaceId!} evidence={e} />
            ))}
        </article>
      )}
    </Modal>
  );
}
function EvidenceReadout({
  tenant,
  workspace,
  evidence,
}: {
  tenant: string;
  workspace: string;
  evidence: Evidence;
}) {
  const data = useRemote(
    (signal) => api.details(tenant, workspace, evidence, signal),
    [tenant, workspace, evidence],
  );
  return (
    <section className="evaluation-card">
      <h4>原对象运行及资源依据</h4>
      {data.error ? (
        <Failure error={data.error} retry={() => {}} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <p>
            {modes[data.value.mode]} · 原状态 {data.value.state} ·{' '}
            {data.value.exact ? '所选版本仍有效' : '原对象已经变化'} · {data.value.sourceVersions}{' '}
            个关联资料版本
          </p>
          {data.value.resourceCoverage === 'NOT_RECORDED' ? (
            <p>此尝试没有计量记录；不补成零用量或零费用。</p>
          ) : (
            data.value.attempts.map((a) => (
              <p key={a.attempt}>
                尝试 {a.attempt}：注册请求 {a.registeredRequests}，有用量回执 {a.reportedUsage}，待回执{' '}
                {a.pendingRequests}。已知输入 Token {a.knownInputTokens ?? '未知'} / 输出 Token{' '}
                {a.knownOutputTokens ?? '未知'}。{a.mode === 'verification' ? '合成验证。' : ''}
              </p>
            ))
          )}
          <small>注册请求不等于供应商调用成功；Token 不是费用账单。</small>
        </>
      )}
    </section>
  );
}
function RunEditor({
  tenant,
  workspace,
  value,
  standards,
  samples,
  done,
  close,
}: {
  tenant?: string;
  workspace: string | null;
  value: Evaluation | 'new';
  standards: EvaluationAsset[];
  samples: EvaluationAsset[];
  done: () => void;
  close: () => void;
}) {
  const previous = value === 'new' ? null : value,
    [standard, setStandard] = useState(
      previous?.standardVersion ?? standards.find((a) => a.status === 'ACTIVE')?.version.id ?? '',
    ),
    [selected, setSelected] = useState<string[]>(previous?.sampleVersions ?? []),
    [judgments, setJudgments] = useState<Judgment[]>([]);
  const source = useRemote(
    (signal) => (standard ? api.version(tenant, standard, signal) : Promise.resolve(null)),
    [tenant, standard],
  );
  const submit = useSubmission<{ standard: string; selected: string[]; judgments: Judgment[] }>();
  const cells = source.value?.version.content.criteria.filter((c) => c.check === 'MANUAL') ?? [];
  useRequestLock(submit.busy || submit.uncertain);
  return (
    <Modal
      title={previous ? '复核确切评价版本' : '发起评价'}
      onClose={() => {
        if (!submit.busy && !submit.uncertain) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit.submit({ standard, selected, judgments }, async (b, key) => {
            await api.evaluate(
              tenant,
              workspace,
              key,
              b.standard,
              b.selected,
              previous?.id ?? null,
              b.judgments,
            );
            done();
          });
        }}
      >
        <fieldset disabled={submit.busy || submit.uncertain}>
          {!previous && (
            <>
              <Field label="评价标准">
                <select
                  aria-label="评价标准"
                  required
                  value={standard}
                  onChange={(e) => setStandard(e.target.value)}
                >
                  <option value="">选择标准</option>
                  {standards
                    .filter((a) => a.status === 'ACTIVE')
                    .map((a) => (
                      <option key={a.id} value={a.version.id}>
                        {a.version.content.title} · v{a.version.revision}
                      </option>
                    ))}
                </select>
              </Field>
              <p>选择样例（本页可读记录）：</p>
              {samples
                .filter((a) => a.status === 'ACTIVE')
                .map((a) => (
                  <label className="evaluation-check" key={a.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(a.version.id)}
                      onChange={(e) =>
                        setSelected((x) =>
                          e.target.checked ? [...x, a.version.id] : x.filter((id) => id !== a.version.id),
                        )
                      }
                    />
                    {a.version.content.title} · {modes[a.version.mode]}
                  </label>
                ))}
            </>
          )}
          {source.error ? (
            <Failure error={source.error} retry={() => setStandard(standard)} />
          ) : !source.value ? (
            <p>请选择有效标准。</p>
          ) : (
            selected.map((id, index) => (
              <section key={id}>
                {cells.length > 0 && <h4>样例 {index + 1} 的人工判断（可留为缺证据）</h4>}
                {cells.map((c) => {
                  const j = judgments.find((x) => x.sampleVersion === id && x.criterion === c.key);
                  const change = (patch: Partial<Judgment>) =>
                    setJudgments((x) => [
                      ...x.filter((q) => q.sampleVersion !== id || q.criterion !== c.key),
                      { sampleVersion: id, criterion: c.key, verdict: 'UNKNOWN', note: '', ...j, ...patch },
                    ]);
                  return (
                    <div key={c.key}>
                      <Field label={c.requirement}>
                        <select
                          value={j?.verdict ?? 'UNKNOWN'}
                          onChange={(e) => change({ verdict: e.target.value as Judgment['verdict'] })}
                        >
                          {Object.entries(verdicts).map(([v, label]) => (
                            <option value={v} key={v}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="判断依据">
                        <textarea
                          aria-label="判断依据"
                          value={j?.note ?? ''}
                          onChange={(e) => change({ note: e.target.value })}
                          required={Boolean(j)}
                          maxLength={2000}
                        />
                      </Field>
                    </div>
                  );
                })}
              </section>
            ))
          )}
          <p className="muted">程序检查不接受人工改分。复核保留原评价，不执行原任务，不产生方法采用。</p>
        </fieldset>
        <SubmitError error={submit.error} uncertain={submit.uncertain} />
        <FormActions>
          <Button type="submit" variant="primary" disabled={submit.busy || !standard || !selected.length}>
            保存评价记录
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
function IssueEditor({
  tenant,
  workspace,
  value,
  samples,
  done,
  close,
}: {
  tenant?: string;
  workspace: string | null;
  value: EvaluationIssue | 'new';
  samples: EvaluationAsset[];
  done: () => void;
  close: () => void;
}) {
  const { session } = useSession(),
    existing = value === 'new' ? null : value;
  const [draft, setDraft] = useState({
    sampleVersion: samples[0]?.version.id ?? '',
    evaluationId: null as string | null,
    title: '',
    category: 'CONTENT' as EvaluationIssue['category'],
    impact: '',
    nextAction: '',
  });
  const [change, setChange] = useState<IssueChange>({
    status: existing?.status === 'CLOSED' ? 'OPEN' : (existing?.status ?? 'OPEN'),
    assignee: existing?.assignee ?? null,
    outcome: null,
    basis: null,
    note: '',
    evidence: [],
  });
  const submit = useSubmission<{ draft: typeof draft; change: IssueChange }>();
  const people = useRemote(
    (signal) => (existing ? api.assignees(tenant, existing.id, signal) : Promise.resolve([])),
    [tenant, existing?.id],
  );
  useRequestLock(submit.busy || submit.uncertain);
  return (
    <Modal
      title={existing ? '处理问题' : '登记问题'}
      onClose={() => {
        if (!submit.busy && !submit.uncertain) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit.submit({ draft, change }, async (b, key) => {
            if (existing)
              await api.changeIssue(tenant, existing, key, {
                ...b.change,
                basis: b.change.status === 'CLOSED' ? 'HUMAN_CONFIRMATION' : null,
                outcome: b.change.status === 'CLOSED' ? b.change.outcome : null,
              });
            else await api.createIssue(tenant, workspace, key, b.draft);
            done();
          });
        }}
      >
        <fieldset disabled={submit.busy || submit.uncertain}>
          {!existing ? (
            <>
              <Field label="关联样例">
                <select
                  aria-label="关联样例"
                  required
                  value={draft.sampleVersion}
                  onChange={(e) => setDraft((x) => ({ ...x, sampleVersion: e.target.value }))}
                >
                  {samples.map((a) => (
                    <option value={a.version.id} key={a.id}>
                      {a.version.content.title} · v{a.version.revision}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="问题标题">
                <input
                  aria-label="问题标题"
                  required
                  maxLength={180}
                  value={draft.title}
                  onChange={(e) => setDraft((x) => ({ ...x, title: e.target.value }))}
                />
              </Field>
              <Field label="问题分类">
                <select
                  aria-label="问题分类"
                  value={draft.category}
                  onChange={(e) =>
                    setDraft((x) => ({ ...x, category: e.target.value as EvaluationIssue['category'] }))
                  }
                >
                  {Object.entries({
                    DATA: '资料与口径',
                    CONTENT: '内容错误',
                    PREFERENCE: '表达与偏好',
                    TECHNICAL: '技术或资源',
                    AUTHORIZATION: '授权或业务决定',
                    METHOD: '方法调整',
                  }).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="实际影响">
                <textarea
                  aria-label="实际影响"
                  required
                  maxLength={2000}
                  value={draft.impact}
                  onChange={(e) => setDraft((x) => ({ ...x, impact: e.target.value }))}
                />
              </Field>
              <Field label="需要的下一步">
                <textarea
                  aria-label="需要的下一步"
                  required
                  maxLength={1000}
                  value={draft.nextAction}
                  onChange={(e) => setDraft((x) => ({ ...x, nextAction: e.target.value }))}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="处理进度">
                <select
                  aria-label="处理进度"
                  value={change.status}
                  onChange={(e) =>
                    setChange((x) => ({ ...x, status: e.target.value as IssueChange['status'] }))
                  }
                >
                  {Object.entries(issueStatuses)
                    .filter(([s]) => existing.status !== 'CLOSED' || s === 'OPEN')
                    .map(([s, label]) => (
                      <option value={s} key={s}>
                        {label}
                      </option>
                    ))}
                </select>
              </Field>
              <label className="evaluation-check">
                <input
                  type="checkbox"
                  checked={change.assignee === session.identity?.account.id}
                  onChange={(e) =>
                    setChange((x) => ({
                      ...x,
                      assignee: e.target.checked ? session.identity!.account.id : null,
                    }))
                  }
                />
                由本人接手
              </label>
              <Field label="转交给有权处理者" hint="候选人已由服务端核对职责和全部证据权限；转交不自动授权。">
                <select
                  aria-label="转交给有权处理者"
                  value={change.assignee ?? ''}
                  onChange={(e) => setChange((x) => ({ ...x, assignee: e.target.value || null }))}
                >
                  <option value="">暂不指派</option>
                  {people.value?.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              {people.error && <Failure error={people.error} retry={close} />}
              {change.status === 'CLOSED' && (
                <Field label="结束原因">
                  <select
                    aria-label="结束原因"
                    required
                    value={change.outcome ?? ''}
                    onChange={(e) =>
                      setChange((x) => ({ ...x, outcome: e.target.value as IssueChange['outcome'] }))
                    }
                  >
                    <option value="">选择实际原因</option>
                    {Object.entries(outcomes).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="处理依据与仍有影响">
                <textarea
                  aria-label="处理依据与仍有影响"
                  required
                  maxLength={2000}
                  value={change.note}
                  onChange={(e) => setChange((x) => ({ ...x, note: e.target.value }))}
                />
              </Field>
              {tenant && workspace && (
                <EvidencePicker
                  tenant={tenant}
                  workspace={workspace}
                  value={change.evidence}
                  onChange={(e) => setChange((x) => ({ ...x, evidence: e }))}
                />
              )}
              <p className="muted">
                本记录说明人工确认及处理范围；不会将原失败任务改成成功，也不会自动重跑或发布内容。
              </p>
            </>
          )}
        </fieldset>
        <SubmitError error={submit.error} uncertain={submit.uncertain} />
        <FormActions>
          <Button type="submit" variant="primary" disabled={submit.busy}>
            保存处理记录
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
