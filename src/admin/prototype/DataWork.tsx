import { useEffect, useRef, useState } from 'react';
import { api, ACTIONS, date, type Asset, type Detail, type Foundation } from './foundation-api';
import { GATES } from './world';
import './foundation-live.css';

function dictionaryNotice(warning: string, fields: { name: string; label: string }[]) {
  const match = warning.trim().match(/^(?:(.+?)\s*[:：]\s*)?(DEPLOYMENT_INFERRED|UNKNOWN|SOURCE_DOCUMENTED)$/);
  if (match) {
    const field = fields.find((item) => item.name === match[1]);
    const label = field?.label || (field ? field.name : '该字段');
    const message = {
      DEPLOYMENT_INFERRED: '当前解释来自部署时的推断，尚待业务依据核实。用于分析前，请确认字段含义和使用范围。',
      UNKNOWN: '当前缺少足够的字段解释依据。用于分析前，请补充业务含义和使用范围。',
      SOURCE_DOCUMENTED: '字段解释已有来源依据，使用时请核对适用范围。',
    }[match[2]];
    return `${label}：${message}`;
  }
  // Unexpected machine codes stay out of user-facing copy; retain ordinary prose notices.
  return /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/.test(warning)
    ? '部分字段口径仍需核实，请查看字段依据并联系数据维护人员确认。'
    : warning;
}

export function DataWork({
  picked,
  pick,
  filter,
  setFilter,
  gate,
  setGate,
  foundation,
}: {
  picked: string;
  pick: (id: string) => void;
  filter: number;
  setFilter: (n: number) => void;
  gate: number | null;
  setGate: (n: number | null) => void;
  foundation: Foundation;
}) {
  const { data, error, unauthorized, loading, refresh } = foundation;
  const [q, setQ] = useState(''),
    [kind, setKind] = useState('all'),
    [department, setDepartment] = useState(''),
    [queue, setQueue] = useState('all'),
    [sort, setSort] = useState('priority'),
    [page, setPage] = useState(1),
    [detail, setDetail] = useState<Detail | null>(null),
    [detailError, setDetailError] = useState(''),
    [pending, setPending] = useState(''),
    [notice, setNotice] = useState(''),
    [pane, setPane] = useState('overview'),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [reason, setReason] = useState(''),
    [finding, setFinding] = useState('');
  const seq = useRef(0),
    active = useRef(true),
    lock = useRef(false);
  const tab = Math.min(2, Math.max(0, filter));
  const available = data?.items || [];
  const rows = available.filter(
    (a) =>
      (tab === 0 ? a.needsAttention : true) &&
      (tab !== 0 ||
        queue === 'all' ||
        (queue === 'isolated'
          ? a.status === 'quarantined' || a.isolated > 0
          : queue === 'overdue'
            ? Date.parse(a.reviewAt) < Date.now()
            : queue === 'failed'
              ? a.status === 'failed' || a.sync?.state === 'failed'
              : a.quality < 90)) &&
      (kind === 'all' || a.kind === kind) &&
      (!department || a.department === department) &&
      `${a.title} ${a.source} ${a.department}`.toLocaleLowerCase().includes(q.trim().toLocaleLowerCase()) &&
      (tab === 1 || gate === null || (gate === 4 ? a.available : a.gate === gate)),
  );
  if (tab === 0)
    rows.sort((a, b) =>
      sort === 'quality'
        ? a.quality - b.quality
        : sort === 'updated'
          ? b.updatedAt.localeCompare(a.updatedAt)
          : Number(b.status === 'quarantined' || b.isolated > 0) * 4 +
              Number(b.status === 'failed') * 3 +
              Number(Date.parse(b.reviewAt) < Date.now()) * 2 -
              (Number(a.status === 'quarantined' || a.isolated > 0) * 4 +
                Number(a.status === 'failed') * 3 +
                Number(Date.parse(a.reviewAt) < Date.now()) * 2) || a.quality - b.quality,
    );
  const pages = Math.max(1, Math.ceil(rows.length / 15)),
    currentPage = Math.min(page, pages),
    shown = rows.slice((currentPage - 1) * 15, currentPage * 15);
  const selected = rows.find((a) => a.id === picked) || shown[0];
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      seq.current++;
    };
  }, []);
  useEffect(() => {
    if (selected && selected.id !== picked) pick(selected.id);
    if (selected) setPage(Math.floor(rows.findIndex((a) => a.id === selected.id) / 15) + 1);
  }, [selected?.id, picked]);
  useEffect(() => {
    setDetail(null);
    setDetailError('');
    const n = ++seq.current;
    if (!selected || !data) return;
    const controller = new AbortController();
    api<Detail>('/scene-foundation/' + encodeURIComponent(selected.id), undefined, controller.signal)
      .then((v) => {
        if (active.current && seq.current === n) setDetail(v);
      })
      .catch((e) => {
        if (active.current && seq.current === n && e.name !== 'AbortError') {
          setDetail(null);
          setDetailError(e.message);
        }
      });
    return () => {
      controller.abort();
      seq.current++;
    };
  }, [selected?.id, data?.at]);
  useEffect(() => {
    setReason('');
    setFinding('');
  }, [selected?.id]);
  const reset = () => {
    setPage(1);
    pick('');
  };
  const open = (at: number) => {
    setFilter(at);
    setGate(null);
    reset();
    setPane('overview');
  };
  async function act(action: string, a: Asset, extra: Record<string, string> = {}) {
    if (lock.current) return;
    lock.current = true;
    setPending(action);
    setNotice('');
    setDetailError('');
    try {
      const result = await api<{ message: string }>(
        '/scene-foundation/' + encodeURIComponent(a.id) + '/actions',
        { action, version: a.version, policyVersion: a.policyVersion, ...extra },
      );
      if (active.current) setNotice(result.message);
      await refresh();
    } catch (e) {
      if (active.current) setDetailError((e as Error).message);
      await refresh();
    } finally {
      lock.current = false;
      if (active.current) setPending('');
    }
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setPending('login');
    setDetailError('');
    try {
      await api('/auth/login', { email, password });
      setPassword('');
      await refresh();
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      lock.current = false;
      setPending('');
    }
  }
  async function scan() {
    if (lock.current) return;
    lock.current = true;
    setPending('scan');
    setNotice('');
    try {
      await api('/scene-foundation/scan', {});
      setNotice('治理检查已完成');
      await refresh();
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      lock.current = false;
      setPending('');
    }
  }
  if (unauthorized && new URLSearchParams(window.location.search).has('tenant'))
    return <section className="cards work data live-foundation"><article className="card live-login"><h2>企业登录已失效</h2><p>请重新登录后继续管理本企业的数据。</p><a href="/tenant-admin/" target="_top">返回企业登录</a></article></section>;
  if (unauthorized)
    return (
      <section className="cards work data live-foundation">
        <article className="card live-login">
          <header>
            <h2>登录数据基座</h2>
            <span>使用 mengine-wiki 的现有企业账号</span>
          </header>
          <form onSubmit={login}>
            <label>
              邮箱
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              密码
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button disabled={!!pending} className="primary">
              {pending ? '正在登录…' : '登录'}
            </button>
            {detailError && <p role="alert">{detailError}</p>}
          </form>
        </article>
      </section>
    );
  const a = detail?.asset || selected,
    dict = detail?.dictionary;
  return (
    <section className="cards work data live-foundation" aria-label="数据基座">
      <article className="card list">
        <div className="tabs" role="tablist" aria-label="数据基座栏目">
          {['治理', '接入', '目录'].map((t, i) => (
            <button role="tab" aria-selected={tab === i} key={t} onClick={() => open(i)}>
              {t}
              <small>
                {data ? (i === 0 ? available.filter((x) => x.needsAttention).length : available.length) : '—'}
              </small>
            </button>
          ))}
        </div>
        {data && (
          <div className="live-governance-summary">
            <details>
              <summary>
                治理概况 · {data.governance.attention} 项待关注 · 质量 {data.governance.averageQuality ?? '—'}
              </summary>
              <p>
                隔离 {data.governance.isolated} · 复核到期 {data.governance.overdue} · 失败{' '}
                {data.governance.failed}
              </p>
              <p>审计链：{data.auditValid ? '校验通过' : '校验异常'}</p>
              {data.governance.departments.map((d) => (
                <p key={d.name}>
                  {d.name}：{d.attention} 待关注 / {d.total} 项
                </p>
              ))}
            </details>
            <button disabled={!!pending} onClick={() => void refresh()}>
              刷新
            </button>
            {data.canScan && (
              <button disabled={!!pending} onClick={() => void scan()}>
                {pending === 'scan' ? '检查中…' : '立即检测'}
              </button>
            )}
          </div>
        )}
        <div className="live-filters">
          {tab === 0 && (
            <div>
              <select
                aria-label="治理问题类型"
                value={queue}
                onChange={(e) => {
                  setQueue(e.target.value);
                  reset();
                }}
              >
                <option value="all">全部治理问题</option>
                <option value="isolated">隔离待处理</option>
                <option value="overdue">复核到期</option>
                <option value="failed">处理或同步失败</option>
                <option value="quality">质量待改善</option>
              </select>
              <select
                aria-label="治理排序"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  reset();
                }}
              >
                <option value="priority">按风险优先</option>
                <option value="quality">按质量评分</option>
                <option value="updated">按最近更新</option>
              </select>
            </div>
          )}
          <input
            aria-label="搜索数据资产"
            placeholder="搜索名称、来源或部门"
            maxLength={120}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              reset();
            }}
          />
          <div>
            <select
              aria-label="数据类型"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                reset();
              }}
            >
              <option value="all">全部类型</option>
              <option value="table">业务数据</option>
              <option value="document">资料</option>
            </select>
            <select
              aria-label="所属部门"
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value);
                reset();
              }}
            >
              <option value="">全部部门</option>
              {[...new Set(available.map((a) => a.department))].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </div>
          {gate !== null && (
            <button
              onClick={() => {
                setGate(null);
                reset();
              }}
            >
              {gate === 4 ? '只看' : '停在'}“{GATES[gate]}” ×
            </button>
          )}
        </div>
        <div className="card-scroll">
          {(error || detailError) && (
            <p className="live-error" role="alert">
              {error || detailError}
            </p>
          )}
          {notice && (
            <p className="live-notice" role="status">
              {notice}
            </p>
          )}
          {!shown.length && (
            <p className="none">
              {loading ? '正在读取数据…' : error ? '数据暂不可用，请重试。' : '当前筛选下没有记录。'}
            </p>
          )}
          {shown.map((x) => (
            <div className="row" key={x.id}>
              <button
                className="live-select"
                aria-pressed={selected?.id === x.id}
                onClick={() => {
                  pick(x.id);
                  setPane('overview');
                }}
              >
                <i className={`tone-${x.tone}`} />
                <span className="t">
                  <b>{x.title}</b>
                  <span>
                    {tab === 1
                      ? x.sync
                        ? `每 ${x.sync.intervalMinutes} 分钟 · ${x.sync.state === 'failed' ? '同步失败' : x.sync.enabled ? '已启用同步' : '同步已暂停'}`
                        : x.updatePolicy
                      : x.label}
                  </span>
                  <small>
                    {x.department} · {x.kind === 'table' ? `${x.total} 条记录` : '资料'} · v{x.version}
                  </small>
                </span>
              </button>
              {(tab === 1 ? 'sync' : x.actions.find((v) => ['retry', 'allow'].includes(v))) &&
                x.actions.includes(
                  tab === 1 ? 'sync' : x.actions.find((v) => ['retry', 'allow'].includes(v))!,
                ) && (
                  <button
                    className="act"
                    disabled={!!pending}
                    onClick={() =>
                      void act(tab === 1 ? 'sync' : x.actions.find((v) => ['retry', 'allow'].includes(v))!, x)
                    }
                  >
                    {ACTIONS[tab === 1 ? 'sync' : x.actions.find((v) => ['retry', 'allow'].includes(v))!]}
                  </button>
                )}
            </div>
          ))}
        </div>
        <footer className="live-pagination">
          <span>{rows.length} 项</span>
          <button
            disabled={currentPage <= 1}
            onClick={() => {
              setPage(currentPage - 1);
              pick('');
            }}
          >
            上一页
          </button>
          <span>
            {currentPage}/{pages}
          </span>
          <button
            disabled={currentPage >= pages}
            onClick={() => {
              setPage(currentPage + 1);
              pick('');
            }}
          >
            下一页
          </button>
        </footer>
      </article>
      <article className="card detail" aria-live="polite">
        <header>
          <h2>{a?.title || '数据资产'}</h2>
          <span>
            {a
              ? `${a.department} · ${a.kind === 'table' ? '业务数据' : '资料'} · v${a.version}`
              : '从清单中选择一项'}
          </span>
        </header>
        {a && (
          <>
            <div className="live-detail-tabs">
              {[
                ['overview', '概况'],
                ...(a.kind === 'document' ? [['analysis', 'AI 研判']] : []),
                ['dictionary', '字段口径'],
                ['issues', '治理问题'],
                ['history', '运行记录'],
              ]
                .filter(([v]) => v !== 'dictionary' || a.kind === 'table')
                .map(([v, t]) => (
                  <button key={v} aria-pressed={pane === v} onClick={() => setPane(v)}>
                    {t}
                  </button>
                ))}
            </div>
            <div className="card-scroll">
              <div className={`verdict act-bar tone-${a.tone}`}>
                <p>{a.label}</p>
                <div>
                  {a.actions
                    .filter((action) => !['hold', 'resume'].includes(action))
                    .map((action) => (
                      <button
                        key={action}
                        disabled={!!pending || !detail}
                        onClick={() => void act(action, a)}
                      >
                        {pending === action ? '处理中…' : ACTIONS[action]}
                      </button>
                    ))}
                </div>
              </div>
              {!detail && !detailError && <p className="none">正在核对详情…</p>}
              {pane === 'overview' && (
                <>
                  <ol className="flow">
                    {GATES.map((s, i) => (
                      <li
                        key={s}
                        data-state={
                          (i === 4 ? a.available : i < a.gate) ? 'done' : i === a.gate ? 'warn' : 'wait'
                        }
                      >
                        <b>{s}</b>
                        <span>
                          {i === 0
                            ? '已登记'
                            : i === 4
                              ? a.available
                                ? '可调用合格快照'
                                : '尚不可用'
                              : i === a.gate
                                ? a.label
                                : i < a.gate
                                  ? '已完成'
                                  : '待处理'}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <dl className="live-kv">
                    {[
                      ['来源', a.source],
                      [
                        '取数频率',
                        a.sync
                          ? `每 ${a.sync.intervalMinutes} 分钟（${a.sync.enabled ? '运行中' : '已暂停'}）`
                          : a.updatePolicy,
                      ],
                      ['数据状态', a.label],
                      [
                        '记录数',
                        a.total === null ? '资料' : `${a.ready} 可用 / ${a.isolated} 隔离 / ${a.total} 总计`,
                      ],
                      ['最近更新', date(a.updatedAt)],
                      ['最近成功取数', date(a.sync?.lastSuccess)],
                      ['下次尝试', date(a.sync?.nextAt)],
                      ['业务标签', a.tags.join('、') || '尚未标注'],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  {a.sync?.error && <p className="live-error">{a.sync.error}</p>}
                  <dl className="live-kv">
                    <dt>质量评分</dt>
                    <dd>{a.quality} / 100</dd>
                    <dt>复核日期</dt>
                    <dd>{a.reviewAt || '未设置'}</dd>
                    <dt>密级</dt>
                    <dd>L{a.classification}</dd>
                  </dl>
                  {a.kind === 'document' && a.actions.includes('remediate') && (
                    <p className="live-note">
                      规则治理会重新检查现有来源，不修改正文、标签和复核日期。人工通过只记录业务核验结论；隔离内容必须通过实际复检后才能恢复使用。
                    </p>
                  )}
                  {a.issues.length > 0 && (
                    <div className="live-box">
                      <h3>检查提示</h3>
                      {a.issues.map((v, i) => (
                        <p key={i}>{v}</p>
                      ))}
                    </div>
                  )}
                  <p className="live-note">
                    口径和取数频率只读。治理提示不自动阻断合格记录；隔离记录不参与 AI
                    查询。记录由来源系统维护，本页不展示正文和数据预览。
                  </p>
                </>
              )}
              {pane === 'dictionary' && dict && (
                <>
                  <p className="live-note">
                    {dict.current
                      ? `模型口径 · 第 ${dict.revision} 版 · ${dict.provider} · ${date(dict.at)}`
                      : '当前口径尚未生效，展示原始字段定义。'}{' '}
                    模型解释不代表已核实的业务事实。
                  </p>
                  {dict.job && (
                    <p>
                      生成任务：
                      {(
                        {
                          queued: '排队中',
                          running: '生成中',
                          retry_wait: '等待重试',
                          succeeded: '已完成',
                          failed: '失败',
                        } as Record<string, string>
                      )[dict.job.state] || dict.job.state}{' '}
                      {dict.job.error} {dict.job.nextAt && `下次尝试 ${date(dict.job.nextAt)}`}
                    </p>
                  )}
                  <h3>{dict.tableMeaning}</h3>
                  <p>{dict.usageRules}</p>
                  {dict.fields.map((f) => (
                    <details className="live-box" key={f.name}>
                      <summary>
                        <b>{f.label}</b> <code>{f.name}</code> · {f.type}
                        {f.sensitive ? ' · 敏感字段' : ''}
                      </summary>
                      <p>{f.meaning || '尚无业务解释'}</p>
                      <p>
                        单位：{f.unit || '未定义'} · {f.required ? '必填' : '可空'} ·{' '}
                        {f.unique ? '唯一' : '非唯一'}
                      </p>
                      <p>规则：{f.rules || '—'}</p>
                      <p>依据：{f.evidence || '—'}</p>
                    </details>
                  ))}
                  {dict.warnings.length > 0 && (
                    <section className="live-dictionary-notices" aria-label="字段口径提示">
                      <h3>字段口径提示</h3>
                      {dict.warnings.map((warning, index) => (
                        <p key={index}>{dictionaryNotice(warning, dict.fields)}</p>
                      ))}
                    </section>
                  )}
                  <h3>数据关联 · {dict.relations.length}</h3>
                  {dict.relations.map((r) => (
                    <div className="live-box" key={r.id}>
                      <b>
                        {r.name} → {r.target}
                      </b>
                      <p>{r.keys.map((k) => `${k.local} = ${k.foreign}`).join('；')}</p>
                      <p>{r.evidence}</p>
                      <button
                        onClick={() => {
                          setFilter(2);
                          setGate(null);
                          setQ('');
                          setKind('all');
                          setDepartment('');
                          pick(r.targetId);
                        }}
                      >
                        查看关联资产
                      </button>
                    </div>
                  ))}
                </>
              )}
              {pane === 'analysis' && detail && (
                <>
                  <p className="live-note">复用当前模型对已授权资料研判，结果为建议，不自动改写数据。</p>
                  {detail.analysis?.report ? (
                    <>
                      <h3>
                        {detail.analysis.model} · {date(detail.analysis.report.createdAt)}
                      </h3>
                      <p>{detail.analysis.report.overview}</p>
                      {detail.analysis.report.findings.map((f, i) => (
                        <div className="live-box" key={i}>
                          <b>
                            {f.title} · {{ high: '高', medium: '中', low: '低' }[f.severity] || f.severity}
                            风险
                          </b>
                          <p>{f.explanation}</p>
                          <p>处理建议：{f.recommendation}</p>
                        </div>
                      ))}
                    </>
                  ) : (
                    <p>
                      {detail.analysis?.state === 'stale'
                        ? '资料已变化，请重新发起 AI 研判。'
                        : '尚无可展示的研判结果；有权限时可点击 AI 研判。'}
                    </p>
                  )}
                </>
              )}
              {pane === 'issues' && detail && (
                <>
                  {detail.findings.length === 0 && (
                    <p className="none">当前没有待处理的资料或数据表治理问题。</p>
                  )}
                  {detail.findings.map((f) => (
                    <details className="live-box" key={f.id} open={finding === f.id}>
                      <summary
                        onClick={(e) => {
                          e.preventDefault();
                          setFinding((value) => (value === f.id ? '' : f.id));
                        }}
                      >
                        <b>{f.title}</b> · {f.count} 项 ·{' '}
                        {
                          (
                            {
                              open: '待处理',
                              handling: '处理中',
                              resolved: f.manuallyApproved ? '人工校验通过' : '复检通过',
                            } as Record<string, string>
                          )[f.status]
                        }
                      </summary>
                      <p>{f.detail}</p>
                      {f.field && <p>字段：{f.field}</p>}
                      <p>最近检查：{date(f.lastAt)}</p>
                      {f.history.map((h, i) => (
                        <p key={i}>
                          <small>
                            {date(h.at)} · {h.actor} · {h.action}
                          </small>
                          <br />
                          {h.note}
                        </p>
                      ))}
                      {f.status !== 'resolved' && a.actions.includes('recheck') && (
                        <>
                          <textarea
                            aria-label={`处理说明：${f.title}`}
                            maxLength={300}
                            placeholder="填写处理措施或人工校验依据（可选）"
                            value={finding === f.id ? reason : ''}
                            onChange={(e) => {
                              setFinding(f.id);
                              setReason(e.target.value);
                            }}
                          />
                          <button
                            disabled={!!pending || finding !== f.id || !reason.trim()}
                            onClick={() => void act('handle', a, { findingId: f.id, reason })}
                          >
                            记录处理措施
                          </button>
                          <button
                            disabled={!!pending}
                            onClick={() =>
                              void act('approve', a, {
                                findingId: f.id,
                                reason: reason.trim() || '已人工核实，确认当前快照中的此问题校验通过',
                              })
                            }
                          >
                            人工校验通过
                          </button>
                        </>
                      )}
                    </details>
                  ))}
                  <p className="live-note">
                    可人工确认当前问题通过，记录校验人和说明。数据或口径变化后会重新检查；人工通过不修改原记录，也不解除记录隔离。
                  </p>
                </>
              )}
              {pane === 'history' && detail && (
                <>
                  <h3>处理阶段</h3>
                  {detail.events.length ? (
                    detail.events.map((e, i) => (
                      <p className="live-event" key={i}>
                        <time>{date(e.at)}</time>
                        <span>{eventName(e.event)}</span>
                      </p>
                    ))
                  ) : (
                    <p>暂无处理记录</p>
                  )}
                  <h3>管理操作审计</h3>
                  {detail.audit.length ? (
                    detail.audit.map((e, i) => (
                      <p className="live-box" key={i}>
                        {date(e.at)} · {e.actor}
                        <br />
                        {e.action}
                        <br />
                        {e.detail}
                      </p>
                    ))
                  ) : (
                    <p>暂无管理操作</p>
                  )}
                  <h3>最近数据批次</h3>
                  {detail.batches.length ? (
                    detail.batches.map((b, i) => (
                      <div className="live-box" key={i}>
                        <b>
                          {b.operation} · v{b.version}
                        </b>
                        <p>
                          {date(b.at)} · {b.actor}
                        </p>
                        <small>{b.reason}</small>
                      </div>
                    ))
                  ) : (
                    <p>暂无数据批次</p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </article>
      <div className="side">
        {data?.governance && (
          <article className="card facts more">
            <header>
              <h2>治理概况</h2>
            </header>
            {[
              ['待关注', data.governance.attention],
              ['隔离资产', data.governance.isolated],
              ['复核到期', data.governance.overdue],
              ['处理失败', data.governance.failed],
              ['平均质量', data.governance.averageQuality ?? '—'],
            ].map(([name, value]) => (
              <div className="fact line" key={name}>
                <span>{name}</span>
                <b>{value}</b>
              </div>
            ))}
            <details className="live-box">
              <summary>部门治理分布</summary>
              {data.governance.departments.map((d) => (
                <button
                  className="fact line"
                  key={d.name}
                  onClick={() => {
                    setDepartment(d.name);
                    setFilter(0);
                    setQueue('all');
                    reset();
                  }}
                >
                  <span>{d.name}</span>
                  <small>
                    {d.attention} 待关注 / {d.total} 项
                  </small>
                </button>
              ))}
            </details>
            <details className="live-box">
              <summary>检查规则与处理范围</summary>
              <p>资料：手机号、身份证号、邮箱、标签完整性、复核时效、内容信息量。</p>
              <p>数据表：必填、格式、唯一性、隔离记录、字段口径、关联匹配、规则冲突、同步状态与新鲜度。</p>
              <p>人工校验保留审计；来源或口径变化后重新检查。记录维护由来源系统完成。</p>
            </details>
            <p className="live-note">审计链：{data.auditValid ? '校验通过' : '校验异常，请检查'}</p>
          </article>
        )}
        <article className="card facts">
          <header>
            <h2>治理进度</h2>
            <button disabled={!!pending} onClick={() => void refresh()}>
              刷新
            </button>
          </header>
          {GATES.map((g, i) => (
            <button
              className="fact"
              key={g}
              aria-pressed={gate === i}
              onClick={() => {
                setFilter(i === 4 ? 2 : 0);
                setGate(gate === i ? null : i);
                reset();
              }}
            >
              <span>{g}</span>
              <b>{data?.passed[i] ?? '—'}</b>
              <small>已通过</small>
            </button>
          ))}
          {data?.canScan && (
            <button className="live-scan" disabled={!!pending} onClick={() => void scan()}>
              {pending === 'scan' ? '检查中…' : '立即检测'}
            </button>
          )}
        </article>
        <article className="card facts more">
          <header>
            <h2>三类来源</h2>
          </header>
          {(data?.sources || []).map((s, i) => (
            <button
              className="fact"
              key={s.name}
              onClick={() => {
                open(1);
                setKind(i === 0 ? 'table' : i === 1 ? 'document' : 'all');
                if (i === 2) setQ('外网数据集');
              }}
            >
              <span>{s.name}</span>
              <b>{s.count}</b>
              <small>{i === 2 ? '尚未接入' : i === 0 ? '现有数据快照' : '现有资料资产'}</small>
            </button>
          ))}
          <p className="live-note">
            {data?.tenant?.name} · {data?.user.name}
            <br />每 15 秒刷新 · {date(data?.at)}
            <br />
            模型：{data?.model.configured && data.model.enabled ? data.model.model : '未配置或已暂停'}
          </p>
        </article>
      </div>
    </section>
  );
}
function eventName(v: string) {
  const names: Record<string, string> = {
    received: '接入',
    parsing: '解析中',
    scanning: '检查中',
    published: '已发布',
    quarantined: '已隔离',
    failed: '处理失败',
    retry: '重新解析',
    resumed: '已恢复',
    edited: '已更新',
    rescanned: '已复检',
    remediated: '治理处理完成',
    'dictionary-queued': '口径已排队',
    'dictionary-generating': '模型生成口径',
    'dictionary-generated': '口径已生效',
    'dictionary-failed': '口径生成失败',
    'dictionary-interrupted': '口径任务中断',
    'sync-started': '取数开始',
    'sync-completed': '取数完成',
    'sync-failed': '取数失败',
    'structure-stored': '结构已保存',
    'records-checked': '记录已检查',
  };
  return names[v] || v;
}
