import { companySourceClient, type BackgroundEntry } from '../../profile/company-source-client';
import { useEffect, useState, useRef } from 'react';
import { createIdentityRequest, IdentityError } from '../../identity/client';
const request = createIdentityRequest(fetch, 30000);
const valid = <T,>(v: unknown): v is T => !!v && typeof v === 'object';
type Definition = {
  backgroundVersionIds?: string[];
  name: string;
  meaning: string;
  unit: string;
  grain: string;
  scope: string;
  exclusions: string;
  evidence: string;
  aggregation: string;
  valueField: string;
  execution?: {
    groupColumns: string[];
    dateColumn: string;
    dateFrom: string;
    dateTo: string;
    timeZone: string;
    reviewed: boolean;
    equalsFilters?: Record<string,string>;
    conversion?: string;
  } | null;
};
type Metric = {
  backgroundCurrent?: boolean;
  id: string;
  source_id: string;
  head_version: number;
  published_version: number | null;
  current: boolean;
  published_current: boolean;
  definition: Definition;
  generation?: { origin: string; warnings?: string[] };
  calculations?: { count: number };
  history: { version: number; action: string; created_at: string }[];
};
const blank: Definition = {
  name: '',
  meaning: '',
  unit: '',
  grain: '',
  scope: '',
  exclusions: '',
  evidence: '',
  aggregation: 'COUNT',
  valueField: '',
  execution: {
    groupColumns: [],
    dateColumn: '',
    dateFrom: '',
    dateTo: '',
    timeZone: 'Asia/Shanghai',
    reviewed: false,
  },
};
export function Metrics({
  tenant,
  prefix,
  assets,
  platform,
}: {
  tenant: string;
  prefix: string;
  assets: { source_id: string; kind: string; metadata: { title?: string } }[];
  platform: boolean;
}) {
  const [background, setBackground] = useState<BackgroundEntry[]>([]),
    [backgroundError, setBackgroundError] = useState('');
  useEffect(() => {
    const c = new AbortController();
    setBackground([]);
    setBackgroundError('');
    companySourceClient
      .get(tenant, c.signal)
      .then((s) => {
        if (!c.signal.aborted) setBackground(s.entries);
      })
      .catch(() => {
        if (!c.signal.aborted) setBackgroundError('背景来源暂不可读，保留已选版本；请刷新页面核对。');
      });
    return () => c.abort();
  }, [tenant]);
  const [items, setItems] = useState<Metric[]>([]),
    [editing, setEditing] = useState<Metric | null>(null),
    [definition, setDefinition] = useState({ ...blank }),
    [source, setSource] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [automatic, setAutomatic] = useState(true),
    [autoPublish, setAutoPublish] = useState(false),
    [generationMessage, setGenerationMessage] = useState(''),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(0),
    [total, setTotal] = useState(0),
    [hasMore, setHasMore] = useState(false);
  const path = `${prefix}/tenants/${tenant}/scene/metrics`;
  const listPath = `${path}?query=${encodeURIComponent(search.trim())}&offset=${page * 12}&limit=12`;
  const activeList = useRef(listPath);
  activeList.current = listPath;
  async function generationStatus() {
    const r = await request<{
      enabled: boolean;
      auto_publish?: boolean;
      created_count: number;
      error_code?: string;
    }>(`${path}/generation`, 'GET', valid);
    setAutomatic(r.enabled);
    setAutoPublish(r.auto_publish ?? false);
    if (r.error_code && r.error_code !== 'CATALOG_LIMIT')
      setGenerationMessage('最近自动生成未完成，将在下一周期重试。');
  }
  async function generate() {
    setBusy(true);
    setError('');
    try {
      const r = await request<{
        created: number;
        paused: boolean;
        published?: number;
        batchLimited?: boolean;
      }>(`${path}/generation`, 'POST', valid, {});
      setGenerationMessage(
        r.paused
          ? '自动生成已暂停。'
          : `新增 ${r.created} 项${autoPublish ? '指标定义' : '待核实草稿'}；已有候选不会重复生成。${autoPublish ? `本轮发布 ${r.published ?? 0} 项。` : ''}${r.batchLimited ? '本轮已达处理批量，剩余候选将在后续周期继续。' : ''}`,
      );
      await reload();
    } catch {
      setError('生成未完成，请核对来源权限与治理同步状态。');
    } finally {
      setBusy(false);
    }
  }
  async function toggle() {
    setBusy(true);
    try {
      await request(`${path}/automatic`, 'POST', valid, { enabled: !automatic });
      setAutomatic(!automatic);
    } catch {
      setError('自动生成设置未保存，请重试。');
    } finally {
      setBusy(false);
    }
  }
  function change(key: keyof Definition, value: string) {
    setDefinition({
      ...definition,
      [key]: value,
      execution: { ...(definition.execution ?? blank.execution!), reviewed: false },
    });
  }
  function planChange(value: Partial<NonNullable<Definition['execution']>>) {
    setDefinition({
      ...definition,
      execution: { ...(definition.execution ?? blank.execution!), reviewed: false, ...value },
    });
  }
  async function reload() {
    const key = listPath;
    const r = await request<{ items: Metric[]; total?: number; hasMore?: boolean }>(key, 'GET', valid);
    if (activeList.current === key) {
      setItems(r.items);
      setTotal(r.total ?? r.items.length);
      setHasMore(r.hasMore ?? false);
    }
  }
  useEffect(() => {
    setItems([]);
    setEditing(null);
    setDefinition({ ...blank });
    setSource('');
    setError('');
    setPage(0);
    setSearch('');
    setTotal(0);
    void generationStatus().catch(() => {});
  }, [path]);
  useEffect(() => {
    let live = true;
    const abort = new AbortController();
    setItems([]);
    setHasMore(false);
    const load = () =>
      request<{ items: Metric[]; total?: number; hasMore?: boolean }>(
        listPath,
        'GET',
        valid,
        undefined,
        abort.signal,
      )
        .then((r) => {
          if (live) {
            setItems(r.items);
            setTotal(r.total ?? r.items.length);
            setHasMore(r.hasMore ?? false);
          }
        })
        .catch(() => {
          if (live) setError('指标目录暂不可用，请稍后重试。');
        });
    const first = setTimeout(() => void load(), 250);
    const timer = setInterval(() => void load(), 30000);
    return () => {
      live = false;
      abort.abort();
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [listPath]);
  async function save() {
    setBusy(true);
    setError('');
    try {
      await request(path, 'POST', valid, {
        id: editing?.id ?? null,
        expectedVersion: editing?.head_version ?? 0,
        sourceId: source,
        definition,
      });
      await reload();
      setEditing(null);
      setDefinition({ ...blank });
    } catch {
      setError('保存失败。请检查必填口径、数值字段及来源权限；若版本已更新，请重新选择指标后编辑。');
    } finally {
      setBusy(false);
    }
  }
  async function transition(m: Metric, action: 'publish' | 'withdraw') {
    setBusy(true);
    setError('');
    try {
      await request(`${path}/${m.id}/${action}`, 'POST', valid, { expectedVersion: m.head_version });
      await reload();
    } catch (e) {
      const reasons:Record<string,string>={DATASET_NON_ADDITIVE_FIELD:'来源禁止此求和计划。请由部署人员登记精确筛选和换算规则，不能直接解除源限制。',METRIC_CONVERSION_SOURCE_UNIT_INVALID:'来源字段尚未明确为分，不能执行分转元。',METRIC_CONVERSION_INVALID:'分转元仅适用于数值合计，输出单位须填写元。'};
      setError(e instanceof IdentityError&&reasons[e.code]?reasons[e.code]:'操作未完成：来源、权限或指标版本可能已变化，请刷新并重新核对。');
    } finally {
      setBusy(false);
    }
  }
  const fields: { key: keyof Definition; label: string; max: number }[] = [
    { key: 'name', label: '指标名称', max: 100 },
    { key: 'meaning', label: '业务含义', max: 400 },
    { key: 'unit', label: '输出单位（分转元时填写元）', max: 40 },
    { key: 'grain', label: '统计粒度（每行代表什么）', max: 400 },
    { key: 'scope', label: '适用范围与时间口径', max: 400 },
    { key: 'exclusions', label: '排除项（没有则填写“无”）', max: 400 },
    { key: 'evidence', label: '业务依据与来源说明', max: 400 },
  ];
  return (
    <section className="metric-catalog">
      <h2>业务指标目录</h2>
      <p>
        企业端维护、总台同步查看。草稿不进入 AI
        上下文；发布来自管理员确认或用户委托的自动定义规则，并不自动核实源数据。口径或权限变化后须重新核对。
      </p>
      {error && <p role="alert">{error}</p>}
      {items.length === 0 && <p>{search ? '没有匹配的指标，请调整关键词。' : '当前页暂无指标。'}</p>}
      <div className="toolbar">
        <input
          aria-label="搜索指标"
          placeholder="搜索指标"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <span>
          {autoPublish ? '自动指标' : '自动草稿'}：{automatic ? '每 5 分钟检查' : '已暂停'}
        </span>
        {!platform && (
          <>
            <button disabled={busy || !automatic} onClick={() => void generate()}>
              生成指标草稿
            </button>
            <button disabled={busy} onClick={() => void toggle()}>
              {automatic ? '暂停自动生成' : '开启自动生成'}
            </button>
          </>
        )}
      </div>
      <p className="notice">
        {autoPublish
          ? '已授权委托自动定义，随自动生成任务执行：通过来源规则和快照检查的技术口径自动发布；不适用指标说明原因并等待来源改善。'
          : '按治理元信息规则生成草稿，不自动发布。'}
        每轮最多新增 50 项，并轮转检查最多 50
        项自动定义；目录不设固定总量上限。不调用付费模型，不把字段推断视为业务事实。
      </p>
      {generationMessage && <p role="status">{generationMessage}</p>}
      {items.map((m) => (
        <article key={m.id}>
          <h3>{m.definition.name}</h3>
          <p>
            {(m.definition.backgroundVersionIds?.length ?? 0) > 0
              ? m.backgroundCurrent
                ? '背景依据有效'
                : '背景依据已变化或不可用，需核对新版本'
              : '未绑定企业背景依据'}
          </p>
          <details>
            <summary>背景知识依据</summary>
            {(m.definition.backgroundVersionIds ?? []).map((id) => (
              <p key={id}>
                {background.find((b) => b.versionId === id)?.label ?? '旧版本或当前不可读取'} · {id}
              </p>
            ))}
          </details>
          <p>
            最新 v{m.head_version} · {m.published_version ? `发布 v${m.published_version}` : '未发布'} ·{' '}
            {m.current ? '来源口径当前有效' : '来源已变化或权限待同步'}
          </p>
          <p>
            {m.published_version && !m.published_current ? '发布口径已暂停用于 AI，需复核后发布新版本。' : ''}
            {m.head_version !== m.published_version ? '以下显示最新草稿定义。' : ''}
          </p>
          <p>
            {m.generation?.origin === 'AUTO_DEFINED'
              ? '按用户委托自动定义'
              : m.generation?.origin === 'RULE_BASED'
                ? '规则生成草稿 · 业务粒度、可加性和统计范围待核实'
                : '人工维护'}{' '}
            · 已完成计算 {m.calculations?.count ?? 0} 次
          </p>
          {m.generation?.origin === 'AUTO_DEFINED' &&
            m.generation.warnings?.map((w, i) => (
              <p className="notice" key={i}>
                {w}
              </p>
            ))}
          <p>
            {m.definition.meaning} · {m.definition.unit}
          </p>
          <p>
            粒度：{m.definition.grain}；范围：{m.definition.scope}；排除：{m.definition.exclusions}
          </p>
          <p>依据：{m.definition.evidence}</p>
          <p>
            计算定义：{m.definition.aggregation === 'SUM' ? `合计 ${m.definition.valueField}` : '记录计数'}
            。后端只执行已确认的固定计划；支持精确等值筛选；跨表净额仍需分别核对计算凭据。
          </p>
          <p>筛选：{Object.entries(m.definition.execution?.equalsFilters??{}).map(([k,v])=>`${k} = ${v}`).join(' 且 ')||'无'}；换算：{m.definition.execution?.conversion==='CENTS_TO_YUAN'?'分转元（÷100）':'保持源单位'}；缺失金额：停止计算。</p>
          {!platform && (
            <div className="toolbar">
              <button
                disabled={busy}
                onClick={() => {
                  setEditing(m);
                  setDefinition({
                    ...m.definition,
                    execution: { ...(m.definition.execution ?? blank.execution!), reviewed: false },
                  });
                  setSource(m.source_id);
                }}
              >
                编辑新版本
              </button>
              <button
                disabled={
                  busy ||
                  !m.current ||
                  !m.definition.execution?.reviewed ||
                  m.definition.exclusions !== '无' ||
                  m.published_version === m.head_version
                }
                onClick={() => void transition(m, 'publish')}
              >
                确认并发布 v{m.head_version}
              </button>
              <button
                disabled={busy || m.published_version === null}
                onClick={() => void transition(m, 'withdraw')}
              >
                撤回发布
              </button>
            </div>
          )}
          <details>
            <summary>版本记录</summary>
            {m.history.map((h, i) => (
              <p key={i}>
                v{h.version} ·{' '}
                {{ DRAFT: '保存草稿', PUBLISH: '确认发布', WITHDRAW: '撤回发布' }[h.action] ?? '变更'} ·{' '}
                {new Date(h.created_at).toLocaleString('zh-CN')}
              </p>
            ))}
          </details>
        </article>
      ))}
      <div className="toolbar">
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          上一页指标
        </button>
        <span>
          共 {total} 项 · 第 {page + 1} 页
        </span>
        <button disabled={!hasMore} onClick={() => setPage(page + 1)}>
          下一页指标
        </button>
      </div>
      {!platform && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h3>{editing ? '编辑指标新版本' : '登记指标草稿'}</h3>
          <label>
            来源数据集
            <select
              aria-label="指标来源"
              required
              disabled={busy || !!editing}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">请选择来源</option>
              {assets
                .filter((a) => a.kind === 'TABLE')
                .map((a) => (
                  <option key={a.source_id} value={a.source_id}>
                    {a.metadata.title ?? a.source_id}
                  </option>
                ))}
            </select>
          </label>
          {fields.map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                required
                maxLength={f.max}
                disabled={busy}
                value={String(definition[f.key] ?? '')}
                onChange={(e) => change(f.key, e.target.value)}
              />
            </label>
          ))}
          <label>
            统计方式
            <select
              aria-label="统计方式"
              disabled={busy}
              value={definition.aggregation}
              onChange={(e) =>
                setDefinition({
                  ...definition,
                  aggregation: e.target.value,
                  valueField: '',
                  execution: { ...(definition.execution ?? blank.execution!), reviewed: false },
                })
              }
            >
              <option value="COUNT">记录计数</option>
              <option value="SUM">数值合计</option>
            </select>
          </label>
          {definition.aggregation === 'SUM' && (
            <label>
              数值字段（准确列名）
              <input
                required
                maxLength={160}
                disabled={busy}
                value={definition.valueField}
                onChange={(e) => change('valueField', e.target.value)}
              />
            </label>
          )}
          <fieldset>
            <legend>企业背景知识依据（可选）</legend>
            <p>仅选择此方法实际依赖的背景。来源变化会阻止旧版本执行，需核对后保存并发布新版本。</p>
            {backgroundError && <p role="alert">{backgroundError}</p>}
            {background.map((b) => (
              <label key={b.versionId}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={definition.backgroundVersionIds?.includes(b.versionId) ?? false}
                  onChange={(e) =>
                    setDefinition({
                      ...definition,
                      backgroundVersionIds: e.target.checked
                        ? [...(definition.backgroundVersionIds ?? []), b.versionId]
                        : (definition.backgroundVersionIds ?? []).filter((id) => id !== b.versionId),
                      execution: { ...(definition.execution ?? blank.execution!), reviewed: false },
                    })
                  }
                />
                {b.label} · v{b.revision}
              </label>
            ))}
            {(definition.backgroundVersionIds ?? [])
              .filter((id) => !background.some((b) => b.versionId === id))
              .map((id) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked
                    onChange={() =>
                      setDefinition({
                        ...definition,
                        backgroundVersionIds: (definition.backgroundVersionIds ?? []).filter((v) => v !== id),
                        execution: { ...(definition.execution ?? blank.execution!), reviewed: false },
                      })
                    }
                  />
                  旧版本或不可读背景：{id}（需重新核对）
                </label>
              ))}
          </fieldset>
          <fieldset>
            <legend>固定计算计划</legend>
            <p>
              支持单个快照的记录计数或数值合计。状态、币种等条件必须在下面明确设置；排除项填写筛选之外尚未落实的规则，无额外规则才填“无”。源字段禁止求和时，部署规范必须明确放行完全匹配的条件。缺失金额将阻止计算，不补零。
            </p>
            <fieldset><legend>等值筛选（所有条件同时满足）</legend>
              {Object.entries(definition.execution?.equalsFilters??{}).map(([column,value],i)=><div className="toolbar" key={i}>
                <input aria-label={`筛选字段${i+1}`} value={column} disabled={busy} onChange={e=>{const entries=Object.entries(definition.execution?.equalsFilters??{});entries[i]=[e.target.value,value];planChange({equalsFilters:Object.fromEntries(entries)});}}/>
                <span>等于</span><input aria-label={`筛选值${i+1}`} value={value} disabled={busy} onChange={e=>planChange({equalsFilters:{...definition.execution?.equalsFilters,[column]:e.target.value}})}/>
                <button type="button" disabled={busy} onClick={()=>planChange({equalsFilters:Object.fromEntries(Object.entries(definition.execution?.equalsFilters??{}).filter(([k])=>k!==column))})}>删除条件</button>
              </div>)}
              <button type="button" disabled={busy||Object.keys(definition.execution?.equalsFilters??{}).length>=5||Object.hasOwn(definition.execution?.equalsFilters??{},'')} onClick={()=>planChange({equalsFilters:{...definition.execution?.equalsFilters,'':''}})}>添加筛选条件</button>
            </fieldset>
            <label>金额单位换算<select aria-label="金额单位换算" disabled={busy||definition.aggregation!=='SUM'} value={definition.execution?.conversion??'NONE'} onChange={e=>planChange({conversion:e.target.value})}><option value="NONE">保持来源单位</option><option value="CENTS_TO_YUAN">分 → 元（精确除以100）</option></select></label>
            <label>
              分组字段（最多三个，用英文逗号分隔；留空计算总计）
              <input
                disabled={busy}
                value={(definition.execution?.groupColumns ?? []).join(',')}
                onChange={(e) =>
                  planChange({
                    groupColumns: e.target.value ? e.target.value.split(',').map((s) => s.trim()) : [],
                  })
                }
              />
            </label>
            <label>
              日期字段（不限制日期时留空）
              <input
                disabled={busy}
                value={definition.execution?.dateColumn ?? ''}
                onChange={(e) => planChange({ dateColumn: e.target.value })}
              />
            </label>
            <label>
              起始日期
              <input
                type="date"
                disabled={busy}
                value={definition.execution?.dateFrom ?? ''}
                onChange={(e) => planChange({ dateFrom: e.target.value })}
              />
            </label>
            <label>
              截止日期
              <input
                type="date"
                disabled={busy}
                value={definition.execution?.dateTo ?? ''}
                onChange={(e) => planChange({ dateTo: e.target.value })}
              />
            </label>
            <label>
              业务时区
              <input
                disabled={busy}
                value={definition.execution?.timeZone ?? 'Asia/Shanghai'}
                onChange={(e) => planChange({ timeZone: e.target.value })}
              />
            </label>
            <label>
              <input
                type="checkbox"
                disabled={busy}
                checked={definition.execution?.reviewed ?? false}
                onChange={(e) => planChange({ reviewed: e.target.checked })}
              />
              我已核对业务依据、粒度、单位、重复记录和以上计划；计算只覆盖同时符合日期和等值筛选的记录，缺失金额不视为零。
            </label>
          </fieldset>
          <button disabled={busy}>{busy ? '处理中…' : '保存草稿'}</button>
          {editing && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setDefinition({ ...blank });
                setSource('');
              }}
            >
              取消编辑
            </button>
          )}
        </form>
      )}
    </section>
  );
}
