import { useRequestLock, RequestPending } from '../shared/request-guard';
import { useContext, useState } from 'react';
import type {
  MethodConfiguration,
  MethodFamily,
  MethodComparison,
  MethodSelection,
  MethodVersion,
} from '../../contracts/public-api/methods';
import { identityClient, useSession } from '../identity/session';
import { Badge, Button, Field, Modal } from '../shared/ui';
import { Failure, FormActions, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { evaluationClient } from '../evaluation/client';
import { methodClient as api } from './client';
import '../evaluation/evaluation.css';
import { ObjectLifecycleDetail } from '../objectlifecycle/ObjectLifecycleWorkspace';
export function MethodWorkbench({ tenant }: { tenant?: string }) {
  const pending = useContext(RequestPending);
  const { session } = useSession(),
    [workspace, setWorkspace] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<string | null>(null),
    [editing, setEditing] = useState<MethodFamily | 'new' | null>(null),
    [suite, setSuite] = useState(false),
    [maintenance, setMaintenance] = useState<MethodVersion | null>(null),
    [adopting, setAdopting] = useState<{
      version: MethodVersion;
      action: 'ADOPT' | 'STOP' | 'ROLLBACK';
    } | null>(null);
  const changed = () => setRefresh((x) => x + 1);
  const context = useRemote(
    (signal) => (tenant ? identityClient.context(tenant, signal) : Promise.resolve(null)),
    [tenant, session.identity],
  );
  const data = useRemote(
    async (signal) => ({
      families: await api.families(tenant, page * 20, signal),
      selection: tenant ? await api.selection(tenant, workspace, signal) : null,
    }),
    [tenant, workspace, page, refresh, session.identity],
  );
  const f = data.value?.families.items.find((f) => f.id === selected),
    selection = data.value?.selection;
  return (
    <section className="access-panel evaluation-panel">
      <header className="evaluation-heading">
        <div>
          <h2>{tenant ? '方法采用与回退' : '通用方法维护'}</h2>
          <p className="muted">
            正常人工维护独立运行。发布、范围采用和业务效果各有依据；当前排序校验使用合成样例。
          </p>
        </div>
        <Button disabled={pending} onClick={changed}>
          刷新方法
        </Button>
      </header>
      {data.error || context.error ? (
        <Failure error={data.error ?? context.error} retry={changed} />
      ) : !data.value || context.value === undefined ? (
        <Loading />
      ) : (
        <>
          <div className="evaluation-toolbar">
            {tenant ? (
              <Field label="方法生效范围">
                <select
                  disabled={pending}
                  aria-label="方法生效范围"
                  value={workspace ?? ''}
                  onChange={(e) => setWorkspace(e.target.value || null)}
                >
                  <option value="">企业默认</option>
                  {context.value?.workspaces.map((w) => (
                    <option value={w.id} key={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Badge>通用 RANKING_V1 · 只处理固定排序特征</Badge>
            )}
            {!tenant && (
              <div className="evaluation-actions">
                <Button disabled={pending} onClick={() => setEditing('new')}>
                  新建方法候选
                </Button>
                <Button disabled={pending} onClick={() => setSuite(true)}>
                  建立排序校验样例
                </Button>
              </div>
            )}
          </div>
          {tenant && selection && (
            <article className="evaluation-card" aria-label="当前采用">
              <header>
                <strong>当前实际方法</strong>
                <Badge>
                  {selection.effective.scope === 'BUILTIN'
                    ? '内建默认'
                    : selection.effective.scope === 'TENANT'
                      ? '企业采用'
                      : '空间采用'}
                </Badge>
              </header>
              <p>
                相关度 {selection.configuration.relevanceWeight} · 新鲜度{' '}
                {selection.configuration.recencyWeight} · 业务重要度{' '}
                {selection.configuration.importanceWeight}
              </p>
              <p>权重归一化后排序；同分按创建时间及稳定编号排序。权限、隐藏和可见范围不由此方法改变。</p>
              {selection.adoption?.status === 'STOPPED' && (
                <p>本范围已停止指定采用，现使用{workspace ? '企业默认或内建默认' : '内建默认'}。</p>
              )}
              {!selection.canAdopt && <p className="muted">尚未获此范围方法采用资格。</p>}
              {selection.canAdopt && selection.adoption?.status === 'ACTIVE' && (
                <Button
                  onClick={() => {
                    const version = selection.adoptedVersion;
                    if (version) setAdopting({ version, action: 'STOP' });
                  }}
                >
                  停止本范围采用
                </Button>
              )}
              <details>
                <summary>采用与停止历史</summary>
                {selection.adoption?.history.map((h) => (
                  <p key={h.revision}>
                    采用修订 {h.revision} ·{' '}
                    {h.action === 'ADOPT' ? '采用' : h.action === 'STOP' ? '停止' : '回退'} ·{' '}
                    {new Date(h.createdAt).toLocaleString('zh-CN')}
                  </p>
                )) ?? <p>尚无显式采用记录。</p>}
              </details>
            </article>
          )}
          <div className="evaluation-columns">
            <section>
              <h3>{tenant ? '可采用的已发布版本' : '方法系列'}</h3>
              {!data.value.families.items.length && <p>尚无{tenant ? '已发布' : '待维护'}方法。</p>}
              {data.value.families.items.map((x) => (
                <article className="evaluation-card" key={x.id}>
                  <header>
                    <strong>{x.title}</strong>
                    <Badge>{x.publishedVersion ? '有已发布版本' : '尚未发布'}</Badge>
                  </header>
                  <Button disabled={pending} onClick={() => setSelected(x.id)}>
                    查看版本与比较
                  </Button>
                </article>
              ))}
              <Pager
                page={page}
                next={data.value.families.hasMore}
                onPage={(v) => {
                  if (!pending) setPage(v);
                }}
              />
            </section>
            <section>
              {f ? (
                <>
                  <h3>{f.title}</h3>
                  {!tenant && (
                    <Button disabled={pending} onClick={() => setEditing(f)}>
                      提出新版本
                    </Button>
                  )}
                  {f.versions.map((v) => (
                    <article className="evaluation-card" key={v.id} aria-label={`方法版本 ${v.number}`}>
                      <header>
                        <strong>版本 {v.number}</strong>
                        <Badge>{v.published ? '已发布' : '候选'}</Badge>
                      </header>
                      {v.bodyAvailable && v.configuration ? (
                        <>
                          <p>{v.rationale}</p>
                          <p>
                            相关度 {v.configuration.relevanceWeight} / 新鲜度 {v.configuration.recencyWeight}{' '}
                            / 业务重要度 {v.configuration.importanceWeight}
                          </p>
                        </>
                      ) : (
                        <p className="muted">
                          此版本正文已停用、回收或清理。保留版本索引与原比较结论，不能据此新发布或采用。
                        </p>
                      )}
                      {!tenant && (
                        <Button disabled={pending} onClick={() => setMaintenance(v)}>
                          维护方法版本 {v.number}
                        </Button>
                      )}
                      {tenant && v.bodyAvailable && selection?.canAdopt && (
                        <div className="evaluation-actions">
                          <Button onClick={() => setAdopting({ version: v, action: 'ADOPT' })}>
                            在本范围采用版本 {v.number}
                          </Button>
                          {selection.adoption?.history.some(
                            (h) => h.action !== 'STOP' && h.versionId === v.id,
                          ) &&
                            selection.adoption.versionId !== v.id && (
                              <Button onClick={() => setAdopting({ version: v, action: 'ROLLBACK' })}>
                                回退到版本 {v.number}
                              </Button>
                            )}
                        </div>
                      )}
                    </article>
                  ))}
                  {!tenant && <Comparisons key={f.id} family={f} refresh={refresh} changed={changed} />}
                </>
              ) : (
                <p className="muted">选择一个方法查看不可变版本和比较依据。</p>
              )}
            </section>
          </div>
          {editing && (
            <MethodEditor
              value={editing}
              close={() => setEditing(null)}
              done={(value) => {
                setSelected(value.id);
                setEditing(null);
                changed();
              }}
            />
          )}
          {suite && (
            <SuiteEditor
              close={() => setSuite(false)}
              done={() => {
                setSuite(false);
                changed();
              }}
            />
          )}
          {tenant && selection && adopting && (
            <AdoptionEditor
              tenant={tenant}
              workspace={workspace}
              selection={selection}
              value={adopting}
              close={() => setAdopting(null)}
              done={() => {
                setAdopting(null);
                changed();
              }}
            />
          )}
        </>
      )}
      {!tenant && maintenance && (
        <ObjectLifecycleDetail
          key={maintenance.id}
          selected={{ kind: 'METHOD_VERSION', objectId: maintenance.id }}
          onClose={() => {
            setMaintenance(null);
            changed();
          }}
        />
      )}
    </section>
  );
}
function MethodEditor({
  value,
  close,
  done,
}: {
  value: MethodFamily | 'new';
  close: () => void;
  done: (f: MethodFamily) => void;
}) {
  const existing = value === 'new' ? null : value,
    [title, setTitle] = useState(''),
    [rationale, setRationale] = useState(''),
    [config, setConfig] = useState<MethodConfiguration>(
      existing?.versions[0]?.configuration ?? {
        relevanceWeight: 0.55,
        recencyWeight: 0.25,
        importanceWeight: 0.2,
      },
    );
  const submit = useSubmission<{ title: string; rationale: string; config: MethodConfiguration }>();
  useRequestLock(submit.busy || submit.uncertain);
  return (
    <Modal
      title={existing ? '提出不可变新版本' : '新建方法候选'}
      onClose={() => {
        if (!submit.busy && !submit.uncertain) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit.submit({ title, rationale, config }, async (b, key) =>
            done(
              existing
                ? await api.candidate(existing, key, b.config, b.rationale)
                : await api.create(key, b.title, b.config, b.rationale),
            ),
          );
        }}
      >
        <fieldset disabled={submit.busy || submit.uncertain}>
          {!existing && (
            <Field label="方法名称">
              <input
                aria-label="方法名称"
                required
                maxLength={180}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
          )}
          {(['relevanceWeight', 'recencyWeight', 'importanceWeight'] as const).map((k, i) => (
            <Field key={k} label={['相关度权重', '新鲜度权重', '业务重要度权重'][i]}>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                required
                value={config[k]}
                onChange={(e) => setConfig((c) => ({ ...c, [k]: Number(e.target.value) }))}
              />
            </Field>
          ))}
          <Field label="适用条件与修改理由">
            <textarea
              aria-label="适用条件与修改理由"
              required
              maxLength={2000}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
          </Field>
          <p className="muted">只配置有限排序特征；不会扩大权限、改变业务事实或直接在企业生效。</p>
        </fieldset>
        <SubmitError error={submit.error} uncertain={submit.uncertain} />
        <FormActions>
          <Button type="submit" variant="primary" disabled={submit.busy}>
            保存方法候选
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
function Comparisons({
  family,
  refresh,
  changed,
}: {
  family: MethodFamily;
  refresh: number;
  changed: () => void;
}) {
  const [comparing, setComparing] = useState(false),
    [publish, setPublish] = useState<MethodComparison | null>(null);
  const list = useRemote((signal) => api.comparisons(family.id, signal), [family.id, refresh]);
  return (
    <section>
      <h3>同组样例比较</h3>
      {family.versions.some((v) => v.id === family.headVersion && !v.published && v.bodyAvailable) && (
        <Button onClick={() => setComparing(true)}>比较当前候选</Button>
      )}
      {list.error ? (
        <Failure error={list.error} retry={changed} />
      ) : !list.value ? (
        <Loading />
      ) : (
        list.value.items.map((c) => (
          <article className="evaluation-card" key={c.id}>
            <Badge>
              {c.validity === 'CURRENT'
                ? '当前依据'
                : c.validity === 'DETAILS_UNAVAILABLE'
                  ? '原方法详情不可用'
                  : '依据已改变'}
            </Badge>
            {c.validity === 'DETAILS_UNAVAILABLE' && (
              <p className="muted">保留原分母与比较结论；方法正文不再可用，不能用于新的发布或采用。</p>
            )}
            <p>
              基准符合 {c.baselinePass}/{c.denominator}；候选符合 {c.candidatePass}/{c.denominator}
            </p>
            <p>
              {
                (
                  {
                    IMPROVED_ON_SAMPLES: '在这组样例上有改善',
                    NO_CHANGE: '未见样例通过数变化',
                    REGRESSION: '存在退化',
                    TRADEOFF: '有改善也有退化',
                  } as const
                )[c.conclusion]
              }
              。合成运行，业务质量未验证。
            </p>
            <details>
              <summary>逐例检查</summary>
              {c.cases.map((x, i) => (
                <p key={x.sampleVersion}>
                  样例 {i + 1}：基准{x.baselinePass ? '符合' : '不符合'}，候选
                  {x.candidatePass ? '符合' : '不符合'}；分母不包含重复来源。
                </p>
              ))}
            </details>
            {c.validity === 'CURRENT' &&
              c.candidateVersion === family.headVersion &&
              c.candidatePass === c.denominator &&
              !family.versions.find((v) => v.id === c.candidateVersion)?.published && (
                <Button onClick={() => setPublish(c)}>检查并发布此版本</Button>
              )}
          </article>
        ))
      )}
      {list.value?.hasMore && <p className="muted">显示最近 50 次比较，原记录继续保留。</p>}
      {comparing && (
        <CompareEditor
          family={family}
          close={() => setComparing(false)}
          done={() => {
            setComparing(false);
            changed();
          }}
        />
      )}
      {publish && (
        <PublishEditor
          family={family}
          comparison={publish}
          close={() => setPublish(null)}
          done={() => {
            setPublish(null);
            changed();
          }}
        />
      )}
    </section>
  );
}
function CompareEditor({
  family,
  close,
  done,
}: {
  family: MethodFamily;
  close: () => void;
  done: () => void;
}) {
  const [standard, setStandard] = useState(''),
    [samples, setSamples] = useState<string[]>([]);
  const data = useRemote(
    async (signal) => ({
      standards: await evaluationClient.assets(undefined, null, 'STANDARD', 0, signal),
      samples: await evaluationClient.assets(undefined, null, 'SAMPLE', 0, signal),
    }),
    [],
  );
  const submit = useSubmission<{ standard: string; samples: string[] }>();
  const candidate = family.versions.find((v) => v.id === family.headVersion)!;
  useRequestLock(submit.busy || submit.uncertain);
  return (
    <Modal
      title="实际运行基准与候选"
      onClose={() => {
        if (!submit.busy && !submit.uncertain) close();
      }}
    >
      {data.error ? (
        <Failure error={data.error} retry={close} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit.submit({ standard, samples }, async (b, key) => {
              await api.compare(key, candidate.id, candidate.baseVersion, b.standard, b.samples);
              done();
            });
          }}
        >
          <fieldset disabled={submit.busy || submit.uncertain}>
            <Field label="固定排序标准">
              <select
                aria-label="固定排序标准"
                required
                value={standard}
                onChange={(e) => setStandard(e.target.value)}
              >
                <option value="">选择标准</option>
                {data.value.standards.items
                  .filter(
                    (a) =>
                      a.status === 'ACTIVE' &&
                      a.version.content.criteria.every(
                        (c) => c.check === 'SYNTHETIC_EQUALS' && c.strength === 'REQUIRED',
                      ),
                  )
                  .map((a) => (
                    <option value={a.version.id} key={a.id}>
                      {a.version.content.title}
                    </option>
                  ))}
              </select>
            </Field>
            <p>选择本次同组样例：</p>
            {data.value.samples.items
              .filter((a) => a.status === 'ACTIVE' && a.version.content.input.startsWith('{'))
              .map((a) => (
                <label className="evaluation-check" key={a.id}>
                  <input
                    type="checkbox"
                    checked={samples.includes(a.version.id)}
                    onChange={(e) =>
                      setSamples((x) =>
                        e.target.checked ? [...x, a.version.id] : x.filter((v) => v !== a.version.id),
                      )
                    }
                  />
                  {a.version.content.title}
                </label>
              ))}
            <p className="muted">
              程序实际运行两个权重版本。任何必要样例不符合或依据已改变，都不能发布。若无可选项，请先建立排序校验样例。
            </p>
          </fieldset>
          <SubmitError error={submit.error} uncertain={submit.uncertain} />
          <FormActions>
            <Button type="submit" variant="primary" disabled={submit.busy || !standard || !samples.length}>
              运行合成比较
            </Button>
          </FormActions>
        </form>
      )}
    </Modal>
  );
}
function PublishEditor({
  family,
  comparison,
  close,
  done,
}: {
  family: MethodFamily;
  comparison: MethodComparison;
  close: () => void;
  done: () => void;
}) {
  const submit = useSubmission<{ comparison: MethodComparison }>();
  useRequestLock(submit.busy || submit.uncertain);
  return (
    <Modal
      title="发布供明确采用"
      onClose={() => {
        if (!submit.busy && !submit.uncertain) close();
      }}
    >
      <p>
        本候选在所选 {comparison.denominator}{' '}
        个合成样例上通过。发布只使它成为可选版本，业务质量仍未验证，已有企业选择保持独立。
      </p>
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
      <FormActions>
        <Button
          variant="primary"
          disabled={submit.busy}
          onClick={() =>
            void submit.submit({ comparison }, async (b, key) => {
              await api.publish(family, key, b.comparison);
              done();
            })
          }
        >
          发布当前版本
        </Button>
      </FormActions>
    </Modal>
  );
}
function SuiteEditor({ close, done }: { close: () => void; done: () => void }) {
  const [title, setTitle] = useState(''),
    [expected, setExpected] = useState('B'),
    [values, setValues] = useState([
      { relevance: 1, recency: 0, importance: 0 },
      { relevance: 0, recency: 1, importance: 0 },
    ]);
  const submit = useSubmission<{ title: string; expected: string; values: typeof values }>();
  useRequestLock(submit.busy || submit.uncertain);
  return (
    <Modal
      title="建立合成排序检查组"
      onClose={() => {
        if (!submit.busy && !submit.uncertain) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit.submit({ title, expected, values }, async (b, key) => {
            const ids = ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'];
            await api.suite(
              key,
              b.title,
              {
                items: b.values.map((v, i) => ({
                  ...v,
                  id: ids[i],
                  workspaceId: '00000000-0000-0000-0000-000000000010',
                  createdAt: '2026-01-01T00:00:00Z',
                })),
              },
              { items: b.expected === 'A' ? ids : [...ids].reverse() },
            );
            done();
          });
        }}
      >
        <fieldset disabled={submit.busy || submit.uncertain}>
          <Field label="检查组名称">
            <input
              aria-label="检查组名称"
              required
              maxLength={150}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <p>
            两个虚构条目使用固定时间，仅改变受测特征。请根据要保持的业务目标指定预期，不根据候选结果倒改答案。
          </p>
          <div className="evaluation-columns">
            {values.map((v, i) => (
              <section key={i}>
                <h3>条目 {i ? 'B' : 'A'}</h3>
                {(['relevance', 'recency', 'importance'] as const).map((k, n) => (
                  <Field label={`${i ? 'B' : 'A'}${['相关度', '新鲜度', '业务重要度'][n]}`} key={k}>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step="0.01"
                      required
                      value={v[k]}
                      onChange={(e) =>
                        setValues((x) =>
                          x.map((a, j) => (j === i ? { ...a, [k]: Number(e.target.value) } : a)),
                        )
                      }
                    />
                  </Field>
                ))}
              </section>
            ))}
          </div>
          <Field label="预期优先条目">
            <select aria-label="预期优先条目" value={expected} onChange={(e) => setExpected(e.target.value)}>
              <option value="A">A 在 B 前</option>
              <option value="B">B 在 A 前</option>
            </select>
          </Field>
        </fieldset>
        <SubmitError error={submit.error} uncertain={submit.uncertain} />
        <FormActions>
          <Button type="submit" variant="primary" disabled={submit.busy}>
            保存合成标准与样例
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
function AdoptionEditor({
  tenant,
  workspace,
  selection,
  value,
  close,
  done,
}: {
  tenant: string;
  workspace: string | null;
  selection: MethodSelection;
  value: { version: MethodVersion; action: 'ADOPT' | 'STOP' | 'ROLLBACK' };
  close: () => void;
  done: () => void;
}) {
  const [accepted, setAccepted] = useState(false),
    submit = useSubmission<{ accepted: boolean }>();
  const label =
    value.action === 'STOP'
      ? '停止本范围采用'
      : value.action === 'ROLLBACK'
        ? '回退到此兼容版本'
        : '采用此版本';
  useRequestLock(submit.busy || submit.uncertain);
  return (
    <Modal
      title={label}
      onClose={() => {
        if (!submit.busy && !submit.uncertain) close();
      }}
    >
      <p>
        操作范围：{workspace ? '当前选定空间' : '企业默认'}。版本 {value.version.number}。
        {value.version.configuration && (
          <>
            相关度 {value.version.configuration.relevanceWeight} / 新鲜度{' '}
            {value.version.configuration.recencyWeight} / 业务重要度{' '}
            {value.version.configuration.importanceWeight}。
          </>
        )}
      </p>
      {value.action === 'STOP' ? (
        <p>
          停止后使用{workspace ? '企业默认，未采用时使用内建默认' : '内建默认'}
          。此操作不会停止任务或恢复被删除内容。
        </p>
      ) : (
        <>
          <p>
            已有合成比较只证明所选样例上的排序机制；真实推荐价值未验证。操作只改变之后请求的排序方法，不重发成果或扩大内容权限。
          </p>
          <label className="evaluation-check">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              disabled={submit.busy || submit.uncertain}
            />
            我确认本范围与合成验证的限制
          </label>
        </>
      )}
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
      <FormActions>
        <Button
          variant="primary"
          disabled={submit.busy || (value.action !== 'STOP' && !accepted)}
          onClick={() =>
            void submit.submit({ accepted }, async (b, key) => {
              await api.adopt(
                tenant,
                workspace,
                key,
                selection.adoption?.revision ?? 0,
                value.action,
                value.version.id,
                b.accepted,
              );
              done();
            })
          }
        >
          {label}
        </Button>
      </FormActions>
    </Modal>
  );
}
