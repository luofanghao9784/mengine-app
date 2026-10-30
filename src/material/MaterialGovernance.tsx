import { versionLabel } from '../admin/display-labels';
import { GovernanceAssistant } from './GovernanceProposals';
import { useState } from 'react';
import { ShieldCheck, Search, ScanLine, FileText, AlertTriangle } from 'lucide-react';
import { governanceApi as api } from './governance-client';
import type {
  GovernanceItem,
  GovernanceChange,
  GovernanceResult,
} from '../../contracts/public-api/material-governance';
import { useRemote, Failure, Loading, Pager, useSubmission, SubmitError } from '../shared/admin';
import { Button, Modal, Field } from '../shared/ui';
import { useRequestLock, requestNavigationLocked } from '../shared/request-guard';
import { useSession } from '../identity/session';
import './material-governance.css';
export const governanceRules = [
  ['phone', '手机号识别', '识别 11 位手机号格式；结果不自动改变访问权限。'],
  ['identity', '身份证号识别', '识别 18 位号码格式，不验证号码真实性。'],
  ['email', '邮箱信息识别', '标记正文中的邮箱格式，按需脱敏。'],
  ['tags', '业务标签完整性', '检查是否有标签，不判断业务分类是否正确。'],
  ['review', '复核时效', '没有复核日期或已超过日期时提醒，不自动延期。'],
  ['content', '内容信息量', '少于 80 个字符时提醒，不代表事实准确性。'],
] as const;
const sourceLabels: Record<string, string> = {
  NOT_CHECKED: '尚未检查或依据已变化',
  ORIGINAL_TEXT: '完整 UTF-8 文本原件',
  PARSED_TEXT: '已解析文本，不包含未提取的图片内容',
  PARTIAL_TEXT: '仅部分解析文本，不计算评分',
  NO_TEXT: '暂无可检查正文，不计算评分',
};
const label = (id: string) => governanceRules.find((r) => r[0] === id)?.[1] || id;
export function MaterialGovernance({ tenant }: { tenant: string }) {
  const { session } = useSession();
  return <Governance key={tenant + session.identity?.account.id} tenant={tenant} />;
}
function Governance({ tenant }: { tenant: string }) {
  const [q, setQ] = useState(''),
    [draft, setDraft] = useState(''),
    [queue, setQueue] = useState('all'),
    [rule, setRule] = useState('all'),
    [sort, setSort] = useState('priority'),
    [page, setPage] = useState(0),
    [revision, refresh] = useState(0),
    [selected, select] = useState<string | null>(null),
    [rules, showRules] = useState(false);
  const data = useRemote(
    (signal) => api.list(tenant, q, queue, rule, sort, page * 20, signal),
    [tenant, q, queue, rule, sort, page, revision],
  );
  const filter = (key: string) => {
    setQueue(key);
    setRule('all');
    setQ('');
    setDraft('');
    setPage(0);
  };
  return (
    <div className="mg-page">
      <header className="mg-heading">
        <div>
          <h2>让资料可信、可用、可追溯</h2>
          <p>诊断当前获权资料，依据实际检查结果处理问题。</p>
        </div>
        <div>
          <Button variant="ghost" onClick={() => showRules(true)}>
            规则与评分说明
          </Button>
          <Button variant="ghost" onClick={() => refresh((n) => n + 1)}>
            刷新治理数据
          </Button>
        </div>
      </header>
      {data.error ? (
        <Failure error={data.error} retry={() => refresh((n) => n + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <div className="mg-scope">
            <ShieldCheck size={15} />
            本人当前可读共享资料；管理身份不扩大内容访问。
          </div>
          <div className="mg-metrics">
            {[
              ['all', '获权资料', data.value.summary.total],
              ['attention', '需要关注', data.value.summary.attention],
              ['sensitive', '敏感信息提醒', data.value.summary.sensitive],
              ['unchecked', '尚未完整检查', data.value.summary.total - data.value.summary.checked],
            ].map(([key, title, value]) => (
              <button key={key} aria-pressed={queue === key} onClick={() => filter(String(key))}>
                <span>{title}</span>
                <strong>
                  {value}
                  <small>份</small>
                </strong>
                <span>查看对应资料 →</span>
              </button>
            ))}
          </div>
          <div className="mg-quality">
            <ScanLine size={19} />
            <div>
              <strong>规则评分 {data.value.summary.average ?? '—'}</strong>
              <p>
                基于 {data.value.summary.checked} 份有完整文本检查依据的资料；不代表业务正确性或专业防泄密检查。
              </p>
            </div>
          </div>
          <section className="mg-panel">
            <header>
              <div>
                <h3>优先行动清单</h3>
                <p>先查看敏感信息提醒，再核对标签和复核日期。</p>
              </div>
              <span>{data.value.filteredTotal} 份符合条件</span>
            </header>
            <form
              className="mg-filters"
              onSubmit={(e) => {
                e.preventDefault();
                setQ(draft.trim());
                setPage(0);
              }}
            >
              <input
                aria-label="治理资料名称"
                placeholder="搜索资料名称"
                value={draft}
                maxLength={180}
                onChange={(e) => setDraft(e.target.value)}
              />
              <Button type="submit" icon={Search}>
                搜索
              </Button>
              <select
                aria-label="治理规则"
                value={rule}
                onChange={(e) => {
                  setRule(e.target.value);
                  setPage(0);
                }}
              >
                <option value="all">全部检查项</option>
                {governanceRules.map((r) => (
                  <option key={r[0]} value={r[0]}>
                    {r[1]}
                  </option>
                ))}
              </select>
              <select
                aria-label="治理排序"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(0);
                }}
              >
                <option value="priority">风险优先</option>
                <option value="quality">评分从低到高</option>
                <option value="updated">最近检查</option>
              </select>
            </form>
            {!data.value.items.length ? (
              <div className="mg-empty">
                <FileText size={28} />
                <h3>{data.value.summary.total ? '没有符合条件的资料' : '暂无可访问的共享资料'}</h3>
                <p>检查结果和列表均受当前内容权限约束。</p>
              </div>
            ) : (
              <div className="mg-table">
                <table>
                  <thead>
                    <tr>
                      <th>资料与范围</th>
                      <th>检查依据</th>
                      <th>规则评分</th>
                      <th>发现的问题</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.value.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.name}</strong>
                          <small>
                            {item.workspaceName} · {versionLabel(item.version)}
                          </small>
                          <small>上传人：{item.uploadedByName || '未记录'}</small>
                        </td>
                        <td>{sourceLabels[item.source]}</td>
                        <td>{item.quality ?? '—'}</td>
                        <td>
                          {item.issues.length
                            ? item.issues.map(label).join('、')
                            : item.quality === null
                              ? '等待检查'
                              : '当前规则未发现问题'}
                        </td>
                        <td>
                          <Button variant="ghost" onClick={() => select(item.id)}>
                            查看诊断
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pager page={page} next={data.value.hasMore} onPage={setPage} />
          </section>
        </>
      )}
      {selected && (
        <Diagnosis
          tenant={tenant}
          id={selected}
          close={() => select(null)}
          changed={() => refresh((n) => n + 1)}
        />
      )}
      {rules && (
        <Modal title="六项治理规则与评分" onClose={() => showRules(false)}>
          <div className="mg-rules">
            {governanceRules.map((r) => (
              <section key={r[0]}>
                <h3>{r[1]}</h3>
                <p>{r[2]}</p>
              </section>
            ))}
            <p>
              每份有完整文本依据的资料从 100 分开始，每项问题扣 16 分，最低 20
              分。部分解析和无正文不计分；缺少日期记为复核提醒。这里只进行规则检查，不自动隔离、提高密级或批准公开。
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Diagnosis({
  tenant,
  id,
  close,
  changed,
}: {
  tenant: string;
  id: string;
  close: () => void;
  changed: () => void;
}) {
  const [revision, refresh] = useState(0);
  const data = useRemote((signal) => api.detail(tenant, id, signal), [tenant, id, revision]);
  return (
    <Modal
      title="资料治理诊断"
      onClose={() => {
        if (!requestNavigationLocked()) close();
      }}
      wide
      className="mg-dialog"
    >
      {data.error ? (
        <Failure error={data.error} retry={() => refresh((n) => n + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <Editor
          key={data.value.revision + ':' + data.value.version}
          tenant={tenant}
          item={data.value}
          changed={changed}
          reload={() => refresh((n) => n + 1)}
        />
      )}
    </Modal>
  );
}
function Editor({
  tenant,
  item,
  changed,
  reload,
}: {
  tenant: string;
  item: GovernanceItem;
  changed: () => void;
  reload: () => void;
}) {
  const [tags, setTags] = useState(item.tags.join('，')),
    [review, setReview] = useState(item.reviewAt || ''),
    [confirm, setConfirm] = useState(false),
    [result, setResult] = useState<GovernanceResult | null>(null);
  const submission = useSubmission<{ body: Omit<GovernanceChange, 'requestId'>; redact: boolean }>();
  useRequestLock(submission.busy || submission.uncertain);
  const locked = submission.busy || submission.uncertain;
  const submit = (redact: boolean) =>
    void submission.submit(
      {
        body: {
          expectedVersion: item.version,
          expectedRevision: item.revision,
          tags: tags
            .split(/[，,]/)
            .map((t) => t.trim())
            .filter(Boolean),
          reviewAt: review || null,
        },
        redact,
      },
      async (value, key) => {
        setResult(await api.change(tenant, item.id, { ...value.body, requestId: key }, value.redact));
        setConfirm(false);
        changed();
      },
    );
  return (
    <div className="mg-diagnosis">
      <h3>{item.name}</h3>
      <GovernanceAssistant tenant={tenant} material={item.id} />
      <p>
        {item.workspaceName} · 文件版本 {versionLabel(item.version)} · 检查记录 {item.revision}
      </p>
      <div className="mg-diagnostic-grid">
        <section>
          <h4>检查依据</h4>
          <p>{sourceLabels[item.source]}</p>
          <p>
            {item.checkedAt
              ? '检查于 ' + new Date(item.checkedAt).toLocaleString('zh-CN')
              : '尚无当前版本的有效检查结果'}
          </p>
          <h4>问题与建议</h4>
          {item.issues.length ? (
            <ul>
              {item.issues.map((i) => (
                <li key={i}>
                  <strong>{label(i)}</strong>
                  <p>{governanceRules.find((r) => r[0] === i)?.[2]}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>{item.quality === null ? '执行检查后查看结果。' : '本次规则未发现问题。'}</p>
          )}
        </section>
        <section>
          <h4>维护与处理</h4>
          <Field label="业务标签（逗号分隔）">
            <input
              aria-label="业务标签"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              disabled={!item.canEdit || locked || !!result}
            />
          </Field>
          <Field label="下次复核日期">
            <input
              aria-label="下次复核日期"
              type="date"
              value={review}
              onChange={(e) => setReview(e.target.value)}
              disabled={!item.canEdit || locked || !!result}
            />
          </Field>
          <p className="mg-note">保存并检查记录本次设置，不代表完成业务复核。不会自动改变访问权限。</p>
          {!item.canEdit ? (
            <p>当前只有阅读权限，请由有编辑权限的人员处理。</p>
          ) : (
            !result && (
              <div className="mg-actions">
                <Button disabled={locked} onClick={() => submit(false)}>
                  保存并检查
                </Button>
                {item.canRedact && (
                  <Button variant="ghost" disabled={locked} onClick={() => setConfirm(true)}>
                    脱敏为新版本
                  </Button>
                )}
              </div>
            )
          )}
          {confirm && (
            <div className="mg-confirm">
              <AlertTriangle size={18} />
              <p>
                将当前 UTF-8
                文本中的手机号、身份证号和邮箱替换为占位符，生成同一文件的新版本，原授权保持。旧版本仍保留敏感信息，不代表彻底删除。非文本文件需人工修订原件。
              </p>
              <Button disabled={locked} onClick={() => submit(true)}>
                确认生成脱敏版本
              </Button>
              <Button variant="ghost" disabled={locked} onClick={() => setConfirm(false)}>
                取消
              </Button>
            </div>
          )}
          <SubmitError error={submission.error} uncertain={submission.uncertain} />
          {submission.uncertain && (
            <Button disabled={submission.busy} onClick={() => submit(confirm)}>
              重试本次请求
            </Button>
          )}
          {!!submission.error && !submission.uncertain && (
            <Button variant="ghost" onClick={reload}>
              重新核对版本与权限
            </Button>
          )}
          {result && (
            <div className="mg-result" role="status">
              <strong>
                {result.redacted ? '已生成脱敏新版本' : '检查已保存'} · {versionLabel(result.version)}
              </strong>
              <p>{sourceLabels[result.source]}</p>
              <p>
                {result.issues.length
                  ? '仍需处理：' + result.issues.map(label).join('、')
                  : '本次规则未发现问题。'}
              </p>
              <Button onClick={reload}>查看最新诊断</Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
