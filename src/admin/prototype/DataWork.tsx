import { Fragment, useEffect, useRef, useState } from 'react';
import { api, ACTIONS, date, type Asset, type Detail, type Foundation } from './foundation-api';
import { GATES } from './world';
import { companySourceClient } from '../../profile/company-source-client';
import { useRemote } from '../../shared/admin';
import { useSession } from '../../identity/session';
import { CompanyBackgroundSource } from '../../profile/CompanyBackgroundSource';
import { Fold, Stages, Timeline, readouts, revealInList, stageState, useGlide, useProgressive, useSpotlight } from './AssetBits';
import './foundation-live.css';
import './glass-surface.css';
import { FoundationProcessing } from './FoundationProcessing';
import { assetSourceGroup } from './asset-source-groups';
import { KnowledgeListRow } from './KnowledgeListRow';
import { sceneTenant } from './scene-route';
import { NativeGovernance } from './NativeGovernance';

function BackgroundSourceCard({ tenant, selected, onSelect }: { tenant: string; selected: boolean; onSelect: () => void }) {
  const { session } = useSession();
  const source = useRemote(signal => companySourceClient.get(tenant, signal), [tenant, session.identity]);
  const entries = source.value?.entries;
  return <KnowledgeListRow name="企业背景" label="企业背景来源" selected={selected} onSelect={onSelect}
    summary={source.error ? '暂不可用 · 点击查看原因' : !entries ? '正在读取…' : entries.length ? `${entries.length} 项背景 · 引用企业信息原版本` : '待完善 · 填写企业背景'}
    side="结构化引用" />;
}

function dictionaryNotice(warning: string, fields: { name: string; label: string }[]) {
  const match = warning
    .trim()
    .match(/^(?:(.+?)\s*[:：]\s*)?(DEPLOYMENT_INFERRED|MODEL_DETERMINED|UNKNOWN|SOURCE_DOCUMENTED)$/);
  if (match) {
    const field = fields.find((item) => item.name === match[1]);
    const label = field?.label || (field ? field.name : '该字段');
    const message = {
      DEPLOYMENT_INFERRED:
        '当前解释来自部署时的推断，尚待业务依据核实。用于分析前，请确认字段含义和使用范围。',
      UNKNOWN: '当前缺少足够的字段解释依据。用于分析前，请补充业务含义和使用范围。',
      SOURCE_DOCUMENTED: '字段解释已有来源依据，使用时请核对适用范围。',
      MODEL_DETERMINED: '字段含义与规则由采集端模型判定，可直接使用。',
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
  tenant,
  onMaintainBackground,
}: {
  picked: string;
  pick: (id: string) => void;
  filter: number;
  setFilter: (n: number) => void;
  gate: number | null;
  setGate: (n: number | null) => void;
  foundation: Foundation;
  tenant?: string | null;
  onMaintainBackground?: () => void;
}) {
  const { data, error, unauthorized, loading, refresh } = foundation;
  const [background, setBackground] = useState(false);
  const [collapsedSources, setCollapsedSources] = useState<Set<string>>(new Set());
  useEffect(() => setCollapsedSources(new Set()), [tenant]);
  const [q, setQ] = useState(''),
    [kind, setKind] = useState('all'),
    [department, setDepartment] = useState(''),
    [queue, setQueue] = useState('all'),
    [collection, setCollection] = useState('all'),
    [sort, setSort] = useState('priority'),
    [detail, setDetail] = useState<Detail | null>(null),
    [detailError, setDetailError] = useState(''),
    [pending, setPending] = useState(''),
    [notice, setNotice] = useState(''),
    [step, setStep] = useState<number | null>(null),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [reason, setReason] = useState(''),
    [finding, setFinding] = useState(''),
    [filtersOpen, setFiltersOpen] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [detailTick, setDetailTick] = useState(0),
    [query, setQuery] = useState('');
  // 搜索框即时显示输入，清单在输入停顿 200ms 后再筛选，免得每个字都重排清单、重读详情。
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(q), 200);
    return () => window.clearTimeout(t);
  }, [q]);
  const nextStep = useRef<number | null>(null),
    section = useRef<HTMLElement>(null),
    listBox = useRef<HTMLDivElement>(null),
    lastStep = useRef(0);
  useSpotlight(section);
  const seq = useRef(0),
    active = useRef(true),
    lock = useRef(false);
  const tab = Math.min(3, Math.max(0, filter));
  const available = data?.items || [];
  const inSource = available.filter((x) => kind === 'all' || x.sourceKind === SOURCE_IDS.indexOf(kind));
  const isProcessing = (a: Asset) => a.stageStates?.some((state) => state === 'RUNNING' || state === 'QUEUED') || ['queued', 'processing'].includes(a.status) || a.sync?.state === 'running' || (!a.stageStates && a.tone === 'run');
  const needle = query.trim().toLocaleLowerCase();
  const now = Date.now();
  const rows = available.filter(
    (a) =>
      (tab === 0 ? a.needsAttention : tab === 1 ? isProcessing(a) : tab === 3 ? a.available : true) &&
      (collection !== 'scheduled' || !!a.sync) &&
      (tab !== 0 ||
        queue === 'all' ||
        (queue === 'isolated'
          ? a.status === 'quarantined' || (a.isolated ?? 0) > 0
          : queue === 'overdue'
            ? Date.parse(a.reviewAt) < now
            : queue === 'failed'
              ? a.status === 'failed' || a.sync?.state === 'failed'
              : a.quality !== null && a.quality < 90)) &&
      (kind === 'all' || a.sourceKind === SOURCE_IDS.indexOf(kind)) &&
      (!department || a.department === department) &&
      (!needle || `${a.title} ${a.source} ${a.department}`.toLocaleLowerCase().includes(needle)) &&
      (gate === null || (gate === 4 ? a.available : a.gate === gate)),
  );
  const showBackground = !!tenant && (kind === 'all' || kind === 'document') && tab === 2 && gate === null && !department && collection === 'all' && '企业背景 企业信息维护 内部来源'.includes(q.trim());
  useEffect(() => { if (!showBackground) setBackground(false); }, [showBackground, tenant]);
  const risk = (x: Asset) =>
    Number(x.status === 'quarantined' || (x.isolated ?? 0) > 0) * 4 +
    Number(x.status === 'failed' || x.sync?.state === 'failed') * 3 +
    Number(Date.parse(x.reviewAt) < Date.now()) * 2 +
    Number(x.needsAttention);
  const byRisk = (x: Asset, y: Asset) => risk(y) - risk(x) || (x.quality ?? 101) - (y.quality ?? 101);
  rows.sort((x, y) =>
    sort === 'quality'
      ? (x.quality ?? 101) - (y.quality ?? 101)
      : sort === 'updated'
        ? y.updatedAt.localeCompare(x.updatedAt)
        : byRisk(x, y),
  );
  const groups = Array.from(rows.reduce((map, asset) => {
    const { key, name } = assetSourceGroup(asset);
    const group = map.get(key) || { key, name, items: [] as Asset[] };
    group.items.push(asset);
    map.set(key, group);
    return map;
  }, new Map<string, { key: string; name: string; items: Asset[] }>()).values());
  const visibleRows = groups.flatMap(group => collapsedSources.has(group.key) ? [] : group.items);
  useEffect(() => {
    const asset = available.find(item => item.id === picked);
    if (asset) setCollapsedSources(old => {
      const next = new Set(old);
      next.delete(assetSourceGroup(asset).key);
      return next;
    });
  }, [picked]);
  /** 待处理队列：所有需要关注的资产，按风险排；与左侧清单的筛选无关。 */
  const todo = available.filter((x) => x.needsAttention).sort(byRisk);
  const departments = [
    ...available.reduce((map, x) => map.set(x.department, (map.get(x.department) || 0) + 1), new Map<string, number>()),
  ] as (readonly [string, number])[];
  const activeFilters =
    (tab === 0 ? Number(queue !== 'all') : 0) + Number(sort !== 'priority') + Number(!!department) + Number(collection !== 'all');
  const selected = rows.find((a) => a.id === picked) || rows[0];
  // 清单的“组”：视角、来源、筛选变了，就重新播放一次逐条弹入。
  const listKey = [tab, kind, gate, department, queue, collection, sort, query, ...collapsedSources].join('|');
  const shownRows = useProgressive(
    listBox,
    listKey,
    visibleRows.length,
    visibleRows.findIndex((r) => r.id === selected?.id),
  );
  const glide = useGlide(listBox, selected?.id || '', listKey, rows.length, shownRows);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      seq.current++;
    };
  }, []);
  useEffect(() => {
    if (selected && selected.id !== picked) pick(selected.id);
  }, [selected?.id, picked]);
  // 换一项资产才清空详情；同一项在后台刷新或操作后静默重读，正在看的内容不闪。
  const detailOf = useRef(''),
    loadFailed = useRef(false);
  useEffect(() => {
    if (detailOf.current !== (selected?.id || '')) {
      detailOf.current = selected?.id || '';
      setDetail(null);
      setDetailError('');
    }
    const n = ++seq.current;
    if (!selected || !data) return;
    const controller = new AbortController();
    api<Detail>('/scene-foundation/' + encodeURIComponent(selected.id), undefined, controller.signal)
      .then((v) => {
        if (active.current && seq.current === n) {
          setDetail(v);
          // 只清掉“读取失败”的提示；操作失败的原因留给用户看。
          if (loadFailed.current) setDetailError('');
          loadFailed.current = false;
        }
      })
      .catch((e) => {
        // 临时读取失败保留详情；权限或资源失效不能继续显示旧内容。
        if (active.current && seq.current === n && e.name !== 'AbortError') {
          if ([401, 403, 404, 410].includes(e.status ?? 0)) setDetail(null);
          loadFailed.current = true;
          setDetailError(e.message);
        }
      });
    return () => {
      controller.abort();
      seq.current++;
    };
  }, [selected?.id, data?.at, detailTick]);
  useEffect(() => {
    setReason('');
    setFinding('');
    // 换一项资产时回到它卡住的那一环；从待处理队列点进来时直接打开指定的一环。
    setStep(nextStep.current);
    nextStep.current = null;
  }, [selected?.id]);

  const choose = (id: string, at: number | null = null) => {
    setBackground(false);
    if (id === selected?.id) setStep(at);
    else nextStep.current = at;
    pick(id);
  };
  const reset = () => {
    pick('');
  };
  const open = (at: number) => {
    setFilter(at);
    setGate(null);
    reset();
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
      if (active.current) {
        setPending('');
        // 列表快照可能没变，但这一项的处理记录变了：单独重读一次详情。
        setDetailTick((n) => n + 1);
      }
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
      setDetailTick((n) => n + 1);
    }
  }
  if (unauthorized && sceneTenant())
    return (
      <section className="cards work data live-foundation">
        <article className="card live-login">
          <h2>企业登录已失效</h2>
          <p>请重新登录后继续管理本企业的数据。</p>
          <a href="/tenant-admin/" target="_top">
            返回企业登录
          </a>
        </article>
      </section>
    );
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
  const shownStep = a ? (step ?? stuckAt(a)) : 0;
  const button = (action: string, primary = false) =>
    a && a.actions.includes(action) ? (
      <button
        key={action}
        className={primary ? 'gold' : undefined}
        disabled={!!pending || !detail}
        onClick={() => void act(action, a)}
      >
        {pending === action ? '处理中…' : ACTIONS[action]}
      </button>
    ) : null;
  const kv = (pairs: [string, React.ReactNode][]) => (
    <dl className="live-kv">
      {pairs.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
  /** 三类来源加“全部来源”，平铺在左侧；点卡片看这一类，点卡片里某一环的数字看停在这一环的资产。 */
  const sourceCards = [
    { id: 'all', name: '全部来源', note: '外部数据集、内部资料库、外网数据集', items: available },
    ...(data?.sources || []).map((src, i) => ({
      id: SOURCE_IDS[i] ?? 'web',
      name: src.name,
      note:
        i === 0
          ? [
              ...new Set(available.filter((x) => x.sourceKind === 0).map((x) => x.source.split(' / ')[0])),
            ].join('、') || '尚未接入数据库'
          : i === 1
            ? '企业背景、制度、流程与报告'
            : '尚未接入',
      items: available.filter((x) => x.sourceKind === i),
    })),
  ];
  const atGate = (x: Asset, i: number) => (i === 4 ? x.available : x.gate === i);
  // 每一环最近一次发生的时间，来自处理记录。
  const stepAt: (string | undefined)[] = GATES.map((_, i) =>
    detail?.events
      .filter((e) => STEP_OF_EVENT[e.event] === i)
      .map((e) => e.at)
      .sort()
      .pop(),
  );
  const stepNote = (x: Asset, i: number, state: string) => {
    if (x.sourceDelivery && i >= 2) return i === 4 ? '等待采集端交付核验通过的版本' : x.sourceDelivery.message;
    if (i === 4 && x.available && x.ready === null && x.kind === 'table') return '按已发布口径使用';
    if (x.nativeGovernance && i === x.gate && !x.available) return x.nativeGovernance.message;
    if (x.nativeGovernance?.state === 'DRAFT_READY' && i === 2) return '草稿已生成，待发布';
    if (state === 'held') return x.label;
    if (x.availabilityKind === 'PUBLISHED_KNOWLEDGE') {
      if (i === 4) return `${x.availableKnowledgeCount} 篇知识可用`;
      if (i === 3) return '治理结果校验完成';
      if (i === 2 && x.kind !== 'table') return '知识口径已生成';
    }
    if (state === 'wait') return i === 4 ? '尚未发布可用范围' : i === 3 ? '尚未执行治理检查' : '尚未完成';
    return [
      x.sync ? `每 ${x.sync.intervalMinutes} 分钟取数` : x.kind === 'table' ? '手动拉取' : '上传',
      x.total !== null ? `${x.total} 条 · ${x.fieldCount} 个字段` : '正文已解析',
      x.kind === 'table' ? (dict?.current ? `第 ${dict.revision} 版口径` : '口径已生效') : '标签已生成',
      '检查通过',
      x.total !== null ? `${x.ready} 条可用` : '已提供给 AI',
    ][i];
  };
  const STEP_INTRO = [
    '数据从来源系统进入数据基座：取数频率、最近一次取数和每次取数留下的批次。',
    '把来源内容拆成结构化记录与字段，并记录每个处理阶段。',
    a?.kind === 'table'
      ? '采集端在交付前核对字段业务含义、单位和规则；梦擎按本批携带的来源定义独立复核，无需预先认可版本。缺少依据时在采集端继续补证。'
      : '资料由输入模型自动生成标签与摘要，不需要字段口径。',
    a?.nativeGovernance ? '检查说明：口径不变时沿用已发布版本；每批独立核对来源定义、已声明规则及导出接收依据。缺少依据、版本不符与规则异常分别提示。' : '检查必填、格式、敏感信息和口径冲突；有问题的记录被隔离，不影响其他记录使用。',
    a?.nativeGovernance ? '当前快照检查通过后，按已发布口径提供给 AI；记录规则检查不代表银行到账、利润或真实逾期本金已核实。' : '通过检查的记录提供给 AI 查询；隔离记录不参与。',
  ];
  return (
    <section ref={section} className="cards work data live-foundation glass" aria-label="数据基座">
      <article className="card sources" data-spot>
        <header className="list-head">
          <h2>数据来源</h2>
        </header>
        <div className="src-list">
          {sourceCards.map((c) => {
            const attention = c.items.filter((x) => x.needsAttention).length;
            return (
              <div key={c.id} className="src" data-on={kind === c.id || undefined}>
                <button
                  className="src-pick"
                  aria-pressed={kind === c.id}
                  onClick={() => {
                    setBackground(false);
                    setKind(c.id);
                    if (c.id === 'document') setFilter(2);
                    setGate(null);
                    reset();
                  }}
                >
                  <span className="src-name">{c.name}</span>
                  {attention > 0 && <span className="src-alert">需处理 {attention}</span>}
                  <b className="src-count num">{c.items.length}</b>
                  {c.id !== 'all' && <span className="src-note">{c.note}</span>}
                </button>
                {/* 阶段统计仅在全部来源显示，点击数字筛选对应阶段。 */}
                {c.id === 'all' && <div className="src-gates">
                  {GATES.map((g, i) => {
                    const n = c.items.filter((x) => atGate(x, i)).length,
                      on = kind === c.id && gate === i;
                    return (
                      <button
                        key={g}
                        aria-pressed={on}
                        disabled={n === 0}
                        title={`${c.name}：${i === 4 ? '已到' : '停在'}“${g}”`}
                        onClick={() => {
                          setBackground(false);
                          setKind(c.id);
                          setGate(on ? null : i);
                          setFilter(2);
                          reset();
                        }}
                      >
                        <b className="num">{n}</b>
                        <em>{g}</em>
                      </button>
                    );
                  })}
                </div>}
              </div>
            );
          })}
        </div>

      </article>

      <article className="card list" data-spot>
        <header className="list-head">
          {searchOpen || q ? (
            <input
              className="head-search"
              aria-label="搜索数据资产"
              placeholder="搜索名称或部门"
              maxLength={120}
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                reset();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQ('');
                  setSearchOpen(false);
                }
              }}
              onBlur={() => !q && setSearchOpen(false)}
            />
          ) : (
            <>
              <h2>数据资产</h2>
              <span className="count num">{rows.length}</span>
              {data && (
                <span
                  className="updated"
                  title={`更新于 ${date(data.at)} · ${data.auditValid === true ? '审计链正常' : data.auditValid === false ? '审计链异常' : '审计未核验'}`}
                >
                  {new Date(data.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  {data.auditValid === false ? ' · 审计异常' : data.auditValid == null ? ' · 审计未核验' : ''}
                </span>
              )}
            </>
          )}
          {gate !== null && (
            <button
              className="gate-chip"
              onClick={() => {
                setGate(null);
                reset();
              }}
            >
              {gate === 4 ? '已到' : '停在'}“{GATES[gate]}” ×
            </button>
          )}
          <span className="head-tools">
            {!(searchOpen || q) && (
              <button className="icon" title="搜索" aria-label="搜索" onClick={() => setSearchOpen(true)}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="7" cy="7" r="4.5" />
                  <path d="M10.5 10.5 14 14" />
                </svg>
              </button>
            )}
            {(searchOpen || q) && (
              <button
                className="icon"
                title="清除搜索"
                aria-label="清除搜索"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setQ('');
                  setSearchOpen(false);
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            )}
            <button
              className="icon"
              title="筛选"
              aria-label="筛选"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />
              </svg>
              {activeFilters > 0 && <i className="dotnum num">{activeFilters}</i>}
            </button>
            <button
              className="icon"
              title={data?.canScan ? '刷新并重新检测' : '刷新'}
              aria-label={data?.canScan ? '刷新并重新检测' : '刷新'}
              disabled={!!pending}
              data-busy={pending === 'scan' || undefined}
              onClick={() => void (data?.canScan ? scan() : refresh())}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M13 8a5 5 0 1 1-1.5-3.6" />
                <path d="M13 2.5v3h-3" />
              </svg>
            </button>
          </span>
        </header>
        <div className="views" role="tablist" aria-label="治理状态">
          {(
            [
              [2, '全部', inSource.length],
              [0, '需处理', inSource.filter((x) => x.needsAttention).length],
              [1, '处理中', inSource.filter(isProcessing).length],
              [3, 'AI 可用', inSource.filter((x) => x.available).length],
            ] as const
          ).map(([i, t, n]) => (
            <button role="tab" aria-selected={tab === i} key={t} onClick={() => open(i)}>
              {t}
              <b className="num">{data ? n : '—'}</b>
            </button>
          ))}
        </div>
        {filtersOpen && (
          <div className="live-filters">
            <div className="live-filter-set">
              <select
                aria-label="所属部门"
                value={department}
                onChange={(e) => {
                  setDepartment(e.target.value);
                  reset();
                }}
              >
                <option value="">全部部门</option>
                {departments.map(([d, n]) => (
                  <option key={d} value={d}>
                    {d} · {n}
                  </option>
                ))}
              </select>
              <select
                aria-label="排序"
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
              <select aria-label="取数方式" value={collection} onChange={(e) => { setCollection(e.target.value); reset(); }}>
                <option value="all">全部取数方式</option>
                <option value="scheduled">定时取数</option>
              </select>
              {tab === 0 && (
                <select
                  aria-label="问题类型"
                  value={queue}
                  onChange={(e) => {
                    setQueue(e.target.value);
                    reset();
                  }}
                >
                  <option value="all">全部问题</option>
                  <option value="isolated">有隔离记录</option>
                  <option value="overdue">复核到期</option>
                  <option value="failed">处理或同步失败</option>
                  <option value="quality">质量待改善</option>
                </select>
              )}
            </div>
          </div>
        )}
        {(error || detailError || notice) && (
          <div className="live-messages">
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
          </div>
        )}
        <div
          className="card-scroll rows"
          ref={listBox}
          tabIndex={0}
          aria-label="数据资产清单，方向键切换"
          onKeyDown={(e) => {
            const n = { ArrowDown: 1, ArrowUp: -1 }[e.key];
            if (!n || !visibleRows.length || e.target !== e.currentTarget) return;
            e.preventDefault();
            const at = visibleRows.findIndex((r) => r.id === selected?.id),
              next = visibleRows[Math.max(0, Math.min(visibleRows.length - 1, at + n))];
            choose(next.id);
            // 下一行可能在下一段里，等它渲染出来再滚过去。
            requestAnimationFrame(() =>
              revealInList(listBox.current, listBox.current?.querySelector(`[data-row="${CSS.escape(next.id)}"]`), true),
            );
          }}
        >
          {glide && (
            <span
              className="row-glide"
              aria-hidden="true"
              style={{ transform: `translateY(${glide.top}px)`, height: glide.height }}
            />
          )}
          {showBackground && tenant && <BackgroundSourceCard tenant={tenant} selected={background} onSelect={() => setBackground(true)} />}
          {!rows.length && !showBackground && (
            <p className="none">{loading ? '正在读取数据…' : error ? error : '当前筛选下没有记录。'}</p>
          )}
          {groups.map((group, index) => {
            // 分段渲染：前面的组已用完这一段的行数，后面的组先不画。
            const before = groups
              .slice(0, index)
              .reduce((n, g) => n + (collapsedSources.has(g.key) ? 0 : g.items.length), 0);
            if (index > 0 && before >= shownRows && shownRows < visibleRows.length) return null;
            const items = collapsedSources.has(group.key) ? [] : group.items.slice(0, Math.max(0, shownRows - before));
            return (
            <Fragment key={group.key}>
              <button type="button" className="asset-source-toggle" aria-label={`${group.name} ${group.items.length}`} aria-expanded={!collapsedSources.has(group.key)}
                onClick={() => setCollapsedSources(old => {
                  const next = new Set(old);
                  if (next.has(group.key)) next.delete(group.key); else next.add(group.key);
                  return next;
                })}>
                <span aria-hidden="true">{collapsedSources.has(group.key) ? '▸' : '▾'}</span>
                <span className="source-overview-title"><strong>{group.name}</strong><small>{collapsedSources.has(group.key) ? '展开查看数据资产' : '数据资产 · 点击收起'}</small></span><span className="num">{group.items.length}</span>
              </button>
              {items.map((x, i) => (
            <div
              className="row"
              key={listKey + x.id}
              data-row={x.id}
              style={{ '--i': Math.min(i, 12) } as React.CSSProperties}
            >
              <button
                className="live-select"
                aria-pressed={!background && selected?.id === x.id}
                onClick={() => choose(x.id)}
              >
                <i className={`tone-${x.tone}`} />
                <span className="t">
                  <b>{x.title}</b>
                  <span>{x.label}</span>
                  <small>
                    {x.department} · v{x.version}
                  </small>
                </span>
                <span className="ov">
                  <Stages a={x} />
                  <span className="ov-nums">
                    {x.kind === 'table' ? (
                      <>
                        {(x.isolated ?? 0) > 0 && (
                          <span data-alert>
                            <b className="num">{x.isolated}</b>
                            <em>隔离</em>
                          </span>
                        )}
                        <span>
                          <b className="num">{x.total}</b>
                          <em>记录</em>
                        </span>
                      </>
                    ) : (
                      <span>
                        <b className="num">{x.quality ?? '—'}</b>
                        <em>质量</em>
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </div>
              ))}
            </Fragment>
            );
          })}
          {shownRows < visibleRows.length && (
            <p className="none">还有 {visibleRows.length - shownRows} 项，继续向下滚动加载</p>
          )}
        </div>
      </article>

      {/* 右：一张卡。上面是资产名称与读数、五个环节连成的流程线；点某一环，下面就是这一环的说明、操作和内容。 */}
      {background && tenant ? (
        <article className="card asset background-detail">
          <div className="card-scroll">
            <CompanyBackgroundSource tenant={tenant} onMaintain={onMaintainBackground} />
          </div>
        </article>
      ) : (
        <article className="card asset" aria-live="polite" data-spot>
          <header className="detail-head">
            <div>
              <h2>{a?.title || '数据资产'}</h2>
              <span>{a ? `${a.department} · v${a.version}` : '从清单中选择一项'}</span>
            </div>
            {a && (
              <dl className="head-nums">
                {readouts(a).map(([k, v]) => (
                  <div key={k} data-alert={(['隔离', '规则异常'].includes(k) && Number(v) > 0) || undefined}>
                    <dt>{k}</dt>
                    <dd className="num">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </header>
          {a && (
            <ol
              className="pipeline"
              role="tablist"
              aria-label="治理流程"
              style={{ '--at': shownStep } as React.CSSProperties}
            >
              {GATES.map((g, i) => {
                const state = stageState(a, i);
                return (
                  <li key={g} data-state={state}>
                    <button
                      role="tab"
                      aria-selected={shownStep === i}
                      title={stepAt[i] ? `最近一次：${date(stepAt[i])}` : undefined}
                      onClick={() => setStep(i)}
                    >
                      <span className="node" aria-hidden="true" />
                      <b>{g}</b>
                      <span className="what">{stepNote(a, i, state)}</span>
                    </button>
                  </li>
                );
              })}
              <li className="caret" aria-hidden="true" />
            </ol>
          )}
          {a && (
            <>
              <div className="step-bar">
                {shownStep !== 4 && <p>{STEP_INTRO[shownStep]}</p>}
                <div className="step-actions">
                  {shownStep === 0 && button('sync', true)}
                  {shownStep === 1 && button('retry', true)}
                  {shownStep === 2 && button('dictionary', true)}
                  {shownStep === 3 && (
                    <>
                      {button('allow', true)}
                      {button('recheck')}
                      {button('remediate')}
                      {button('analyze')}
                    </>
                  )}
                </div>
              </div>
              <div
                className="card-scroll step-body"
                key={`${a.id}:${shownStep}`}
                data-dir={shownStep >= lastStep.current ? 'next' : 'prev'}
                ref={() => {
                  lastStep.current = shownStep;
                }}
              >
                {!detail && !detailError && <p className="none">正在核对详情…</p>}
                {a.nativeGovernance && tenant && [2, 3].includes(shownStep) && <NativeGovernance
                  key={a.id} asset={a} tenant={tenant} maintainBackground={onMaintainBackground}
                  refresh={async () => { await refresh(); setDetailTick(n => n + 1); }} />}

                {shownStep === 0 && (
                  <>
                    {kv([
                      [
                        '取数频率',
                        a.sync
                          ? `每 ${a.sync.intervalMinutes} 分钟（${a.sync.enabled ? '运行中' : '已暂停'}）`
                          : a.updatePolicy,
                      ],
                      ['最近成功', date(a.sync?.lastSuccess)],
                      ['下次尝试', date(a.sync?.nextAt)],
                      ['源数据采集', a.sourceCollectedAt ? date(a.sourceCollectedAt) : '未提供来源采集时间'],
                      ['源端最近核验', a.sourceVerifiedAt ? date(a.sourceVerifiedAt) : '未提供来源核验时间'],
                      ['平台接收', date(a.receivedAt || a.updatedAt)],
                      ['业务覆盖截止', a.coverageThrough ? date(a.coverageThrough) : '来源未声明，不能以采集时间代替'],
                      ['业务标签', a.tags.join('、') || '尚未标注'],
                      ['密级', `L${a.classification}`],
                    ])}
                    {a.sync?.error && <p className="live-error">{a.sync.error}</p>}
                    <h4>取数批次</h4>
                    {detail?.batches.length ? (
                      <Timeline
                        items={detail.batches.map((b) => ({
                          at: date(b.at),
                          text: `${b.operation} · v${b.version} · ${b.actor}`,
                          note: b.reason,
                        }))}
                      />
                    ) : (
                      <p className="none">暂无数据批次</p>
                    )}
                  </>
                )}

                {shownStep === 1 && (
                  <>
                    {tenant ? <FoundationProcessing key={`${tenant}:${a.id}`} tenant={tenant} asset={a.id} updatedAt={a.updatedAt} /> : <>
                    {kv([
                      ['字段', a.kind === 'table' ? `${a.fieldCount} 个` : '正文'],
                      ['复核日期', a.reviewAt ? date(a.reviewAt) : '未设置'],
                    ])}
                    <h4>处理阶段</h4>
                    {detail?.events.length ? (
                      <Timeline
                        items={detail.events.map((e) => ({ at: date(e.at), text: eventName(e.event) }))}
                      />
                    ) : (
                      <p className="none">暂无处理记录</p>
                    )}
                    </>}
                  </>
                )}

                {shownStep === 2 &&
                  (a.kind !== 'table' ? (
                    a.availabilityKind === 'PUBLISHED_KNOWLEDGE' ? <><p>{a.availableKnowledgeCount} 篇治理知识已发布，来源版本当前有效。</p>{a.limitations?.map((text,i)=><p key={i}>{text.includes('未发布') ? `生成时说明（发布前）：${text}` : text}</p>)}</> : kv([
                      ['业务标签', a.tags.join('、') || '尚未标注'],
                      ['密级', `L${a.classification}`],
                    ])
                  ) : dict ? (
                    <>
                      <div className="lead">
                        <b>{dict.tableMeaning}</b>
                        <p>{dict.usageRules}</p>
                        <small>
                          {dict.current
                            ? `第 ${dict.revision} 版 · ${dict.provider} · ${date(dict.at)}`
                            : '当前口径尚未生效，展示原始字段定义'}
                          {dict.job &&
                            ` · 生成任务${
                              (
                                {
                                  queued: '排队中',
                                  running: '生成中',
                                  retry_wait: '等待重试',
                                  succeeded: '已完成',
                                  failed: '失败',
                                } as Record<string, string>
                              )[dict.job.state] || dict.job.state
                            }${dict.job.nextAt ? `，下次 ${date(dict.job.nextAt)}` : ''}`}
                        </small>
                      </div>
                      <h4>字段 · {dict.fields.length}</h4>
                      {dict.fields.map((f) => (
                        <Fold
                          key={f.name}
                          title={
                            <>
                              {f.label} <code>{f.name}</code>
                            </>
                          }
                          meta={[f.type, f.unit, f.required ? '必填' : '', f.sensitive ? '敏感' : '']
                            .filter(Boolean)
                            .join(' · ')}
                        >
                          <p>{f.meaning || '尚无业务解释'}</p>
                          {f.rules && <p>规则：{f.rules}</p>}
                          {f.evidence && <small>依据：{f.evidence}</small>}
                        </Fold>
                      ))}
                      <h4>数据关联 · {dict.relations.length}</h4>
                      {dict.relations.map((r) => (
                        <div className="link-row" key={r.id}>
                          <span>
                            <b>{r.target}</b>
                            <small>{r.keys.map((k) => `${k.local} = ${k.foreign}`).join('；')}</small>
                          </span>
                          <button
                            onClick={() => {
                              setFilter(2);
                              setGate(null);
                              setQ('');
                              setKind('all');
                              setDepartment('');
                              setCollection('all');
                              choose(r.targetId);
                            }}
                          >
                            查看
                          </button>
                        </div>
                      ))}
                      {dict.warnings.map((w, i) => (
                        <p className="live-error" key={i}>
                          {dictionaryNotice(w, dict.fields)}
                        </p>
                      ))}
                    </>
                  ) : null)}

                {shownStep === 3 && (
                  <>
                    {detail?.findings.length === 0 && a.issues.length === 0 && (
                      <p className="none">{a.checksPassed && stageState(a, 3) === 'done' ? (a.availabilityKind === 'PUBLISHED_KNOWLEDGE' ? '治理结果引用与格式校验完成；未判定所有原始记录合格。' : '全部检查通过。') : '尚无当前版本的治理检查通过记录。'}</p>
                    )}
                    {detail?.findings.map((f, n) => (
                      <Fold
                        key={f.id}
                        open={n === 0 && f.status !== 'resolved'}
                        tone={f.status === 'resolved' ? 'ok' : a.tone}
                        title={
                          <>
                            {f.title} <span className="badge num">{f.count}</span>
                          </>
                        }
                        meta={
                          (
                            {
                              open: '待处理',
                              handling: '处理中',
                              resolved: f.manuallyApproved ? '人工校验通过' : '复检通过',
                            } as Record<string, string>
                          )[f.status]
                        }
                      >
                        <p>{f.detail}</p>
                        {f.field && <small>字段：{f.field}</small>}
                        {f.status !== 'resolved' && a.actions.includes('recheck') && (
                          <div className="fold-act">
                            {finding === f.id && (
                              <textarea
                                aria-label={`处理说明：${f.title}`}
                                maxLength={300}
                                placeholder="填写处理措施或人工校验依据（可选）"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                              />
                            )}
                            <div>
                              <button
                                className="gold"
                                disabled={!!pending}
                                onClick={() =>
                                  void act('approve', a, {
                                    findingId: f.id,
                                    reason:
                                      (finding === f.id && reason.trim()) ||
                                      '已人工核实，确认当前快照中的此问题校验通过',
                                  })
                                }
                              >
                                人工校验通过
                              </button>
                              {finding === f.id ? (
                                <button
                                  disabled={!!pending || !reason.trim()}
                                  onClick={() => void act('handle', a, { findingId: f.id, reason })}
                                >
                                  保存处理措施
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    setFinding(f.id);
                                    setReason('');
                                  }}
                                >
                                  记录处理措施
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                        {f.history.length > 0 && (
                          <Timeline
                            items={f.history.map((h) => ({
                              at: date(h.at),
                              text: `${h.actor} · ${h.action}`,
                              note: h.note,
                            }))}
                          />
                        )}
                      </Fold>
                    ))}
                    {/* 资料的检查提示在没有对应问题记录时才单独列出，避免与上面重复。 */}
                    {!detail?.findings.length && a.issues.length > 0 && (
                      <Fold title="检查提示" meta={`${a.issues.length} 项`} tone={a.tone} open>
                        {a.issues.map((v, i) => (
                          <p key={i}>{v}</p>
                        ))}
                      </Fold>
                    )}
                    {a.kind === 'document' && detail?.analysis?.report && (
                      <Fold
                        title="AI 研判"
                        meta={`${detail.analysis.model} · ${date(detail.analysis.report.createdAt)}`}
                      >
                        <p>{detail.analysis.report.overview}</p>
                        {detail.analysis.report.findings.map((f, i) => (
                          <p key={i}>
                            <b>
                              {f.title} · {{ high: '高', medium: '中', low: '低' }[f.severity] || f.severity}
                              风险
                            </b>
                            <br />
                            {f.explanation} 处理建议：{f.recommendation}
                          </p>
                        ))}
                      </Fold>
                    )}
                    <Fold title="检查规则与处理范围">
                      <p>{a.availabilityKind?.startsWith('PUBLISHED_') ? '字段口径发布与本批数据检查分别记录；当前检查覆盖已声明的类型、值域、主键和导出接收摘要。未计算综合质量评分，也未自动修正或隔离原始记录。' : '资料：手机号、身份证号、邮箱、标签完整性、复核时效、内容信息量。'}</p>
                      <p>
                        {a.availabilityKind?.startsWith('PUBLISHED_') ? '字段未知、解析限制及结构异常继续展示；发布不会修正原始记录。' : '数据表：必填、格式、唯一性、隔离记录、字段口径、关联匹配、规则冲突、同步状态与新鲜度。'}
                      </p>
                      <small>
                        人工校验保留审计，不修改原记录，也不解除记录隔离；来源或口径变化后重新检查。记录维护由来源系统完成。
                      </small>
                    </Fold>
                  </>
                )}

                {shownStep === 4 && (
                  <>
                    {kv([
                      ['提供范围', a.availabilityKind === 'PUBLISHED_KNOWLEDGE' ? a.availabilityScope || '已发布治理知识' : a.kind !== 'table' ? '资料全文' : a.queryableRecords !== undefined
                        ? `按已发布口径可查询 ${a.queryableRecords} 条记录` : a.ready !== null
                        ? `${a.ready} 条合格记录`
                        : a.available ? '按已发布口径查询（合格记录数未核验）' : '尚未提供给 AI'],
                      ['源数据采集', a.sourceCollectedAt ? date(a.sourceCollectedAt) : '未提供来源采集时间'],
                      ['源端最近核验', a.sourceVerifiedAt ? date(a.sourceVerifiedAt) : '未提供来源核验时间'],
                      ['平台接收', date(a.receivedAt || a.updatedAt)],
                      ['业务覆盖截止', a.coverageThrough ? date(a.coverageThrough) : '来源未声明，不能以采集时间代替'],
                    ])}
                    {a.queryableRecords !== undefined && (
                      <p className="live-note">{a.ruleStats
                        ? `字段规则 ${a.ruleStats.passed}/${a.ruleStats.total} 通过，异常 ${a.ruleStats.violations} 项。${a.ruleStats.scope}`
                        : '当前快照可查询；尚无已声明字段规则的检查统计。'}</p>
                    )}
                    {!a.available && (
                      <p className="live-note">
                        先完成“{GATES[Math.min(a.gate, 3)]}”，并核实当前版本的检查与发布结果。
                      </p>
                    )}
                    {!!a.businessMetrics?.length && <Fold title="经营指标范围">
                      {a.businessMetrics.map(metric => <p key={metric.name}><b>{metric.name} · {metric.state === 'SUPPORTED' ? '已有统计口径' : '暂不能计算'}</b><br />{metric.reason}</p>)}
                    </Fold>}
                    <h4>管理操作审计</h4>
                    {detail?.audit.length ? (
                      <Timeline
                        items={detail.audit.map((e) => ({
                          at: date(e.at),
                          text: `${e.actor} · ${e.action}`,
                          note: e.detail,
                        }))}
                      />
                    ) : (
                      <p className="none">暂无管理操作</p>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </article>
      )}
    </section>
  );
}
const SOURCE_IDS = ['table', 'document', 'web'];
/** 处理记录里的事件属于哪一环。 */
const STEP_OF_EVENT: Record<string, number> = {
  received: 0,
  'sync-started': 0,
  'sync-completed': 0,
  'sync-failed': 0,
  parsing: 1,
  'structure-stored': 1,
  retry: 1,
  'dictionary-queued': 2,
  'dictionary-generating': 2,
  'dictionary-generated': 2,
  'dictionary-failed': 2,
  'dictionary-interrupted': 2,
  scanning: 3,
  'records-checked': 3,
  quarantined: 3,
  rescanned: 3,
  remediated: 3,
  published: 4,
  resumed: 4,
};
/** 资产卡在的那一环：已可用停在“AI 可用”，否则停在它当前的环节（最多到“检查”）。 */
function stuckAt(a: Asset) {
  return a.available && !a.needsAttention ? 4 : Math.min(a.gate, 3);
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
