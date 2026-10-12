import { skills, Preview, iconMap } from './catalog';
import type { Skill, SkillId } from './catalog';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  AudioLines,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  Folder,
  FolderOpen,
  Grid2X2,
  Image,
  LayoutPanelTop,
  Link2,
  MessageSquare,
  Paperclip,
  Presentation,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { DreamcoreLogo } from '../components/DreamcoreLogo';
import './skill-center-prototype.css';

const files = ['季度经营数据.xlsx', '业务复盘说明.docx', '客户访谈摘要.pdf'];
const initialOutline = [
  '季度经营复盘',
  '本季度核心发现',
  '月度经营明细',
  '营收与客户变化',
  '数据说明与限制',
  '下一步行动建议',
];
function Mark({ n }: { n: string }) {
  return <span className="position-mark">{n}</span>;
}
function Modal({
  children,
  onClose,
  className = '',
  label,
}: {
  children: ReactNode;
  onClose: () => void;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    const close = () => onClose();
    d.addEventListener('cancel', close);
    return () => {
      d.removeEventListener('cancel', close);
      d.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
export function SkillCenterPrototype() {
  const [tab, setTab] = useState('discover'),
    [query, setQuery] = useState(''),
    [favorites, setFavorites] = useState<SkillId[]>(['ppt', 'organizer']),
    [detail, setDetail] = useState<Skill | null>(null),
    [marks, setMarks] = useState(false),
    [modal, setModal] = useState<'help' | 'connection' | 'files' | null>(null),
    [flow, setFlow] = useState<Skill | null>(null),
    [stage, setStage] = useState(0),
    [selected, setSelected] = useState<string[]>([files[0]]),
    [prompt, setPrompt] = useState(''),
    [pages, setPages] = useState(6),
    [theme, setTheme] = useState('沉静紫'),
    [outline, setOutline] = useState(initialOutline),
    [picker, setPicker] = useState(false),
    [toast, setToast] = useState('');
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);
  const favorite = (id: SkillId) =>
    setFavorites((old) => (old.includes(id) ? old.filter((s) => s !== id) : [...old, id]));
  const begin = (s: Skill) => {
    setDetail(null);
    setFlow(s);
    setStage(0);
    setPrompt('');
    setOutline(initialOutline);
    setPicker(false);
    setSelected(
      s.id === 'organizer' ? ['个人空间 / 项目资料'] : s.id === 'meeting' ? ['产品周会.m4a'] : [files[0]],
    );
  };
  const back = () => {
    setToast('');
    setFlow(null);
    setStage(0);
  };
  const filtered = skills.filter(
    (s) =>
      (tab !== 'mine' || favorites.includes(s.id)) &&
      `${s.title}${s.description}${s.output}`.toLowerCase().includes(query.toLowerCase()),
  );
  const navigate = (value: string) => {
    setTab(value);
    setQuery('');
    back();
  };
  const submit = () => {
    if (!prompt.trim()) {
      setToast('请先填写这次希望完成的工作');
      return;
    }
    setStage(1);
    setOutline(Array.from({ length: pages }, (_, i) => initialOutline[i] || `补充内容 ${i + 1}`));
  };
  return (
    <div className={`skill-prototype ${marks ? 'show-marks' : ''}`}>
      <aside className="app-rail">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            back();
          }}
          aria-label="梦擎技能中心"
        >
          <DreamcoreLogo />
          <span>梦擎</span>
        </a>
        <div className="rail-links">
          <button className={flow ? 'active' : ''} onClick={() => begin(skills[0])}>
            <MessageSquare />
            <span>会话</span>
          </button>
          <button disabled title="本轮未设计此页面">
            <LayoutPanelTop />
            <span>智能画报</span>
          </button>
          <button disabled title="本轮未设计此页面">
            <FolderOpen />
            <span>资料库</span>
          </button>
          <button className={!flow ? 'active' : ''} onClick={back}>
            <Grid2X2 />
            <span>技能中心</span>
          </button>
        </div>
        <div className="rail-bottom">
          <button aria-label="设计说明" onClick={() => setModal('help')}>
            <CircleHelp size={20} />
          </button>
          <span className="avatar">D</span>
        </div>
      </aside>
      <div className="app-content">
        <header className="topbar">
          <div className="workspace-name">
            <span className="workspace-symbol">梦</span>
            <b>梦擎工作空间</b>
            <span className="workspace-divider" />
            个人工作区
          </div>
          <div className="preview-controls">
            <span className="design-badge">设计预览</span>
            <button className={marks ? 'toggled' : ''} aria-pressed={marks} onClick={() => setMarks(!marks)}>
              <Settings2 size={15} />
              {marks ? '隐藏功能位' : '显示功能位'}
            </button>
            <button className="icon-button" aria-label="设计说明" onClick={() => setModal('help')}>
              <CircleHelp size={18} />
            </button>
          </div>
        </header>
        {!flow ? (
          <main className="center-content">
            <section className="page-heading">
              <div>
                <div className="overline">YOUR WORK, WITH SUPERPOWERS</div>
                <h1>
                  技能中心
                  <Mark n="01" />
                </h1>
                <p>从一个想法，到一份可以直接使用的成果。</p>
              </div>
              {tab !== 'connections' && (
                <div className="search-wrap">
                  <Search size={18} />
                  <input
                    aria-label="搜索技能"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索你想完成的工作"
                  />
                  {query ? (
                    <button aria-label="清空搜索" onClick={() => setQuery('')}>
                      <X size={16} />
                    </button>
                  ) : (
                    <kbd>⌕</kbd>
                  )}
                </div>
              )}
            </section>
            <div className="tab-line">
              <div className="tabs" role="tablist" aria-label="技能中心栏目">
                {[
                  ['discover', '发现技能'],
                  ['mine', '我的技能'],
                  ['connections', '账号与连接'],
                ].map(([id, label]) => (
                  <button
                    role="tab"
                    aria-selected={tab === id}
                    className={tab === id ? 'active' : ''}
                    key={id}
                    onClick={() => navigate(id)}
                  >
                    {label}
                    {id === 'mine' && <span>{favorites.length}</span>}
                    {id === 'connections' && <Mark n="06" />}
                  </button>
                ))}
              </div>
              <span className="catalog-note">
                <ShieldCheck size={14} /> 梦擎适配 · 来源可追溯
              </span>
            </div>
            {tab === 'connections' ? (
              <section className="connections">
                <div className="section-heading">
                  <div>
                    <h2>让技能使用你允许的资料</h2>
                    <p>连接由多个技能共用，资料范围在每次调用时单独选择。</p>
                  </div>
                  <span className="muted">首批无需额外连接</span>
                </div>
                <div className="connection-card">
                  <div className="connection-icon">
                    <FolderOpen />
                  </div>
                  <div>
                    <h3>
                      梦擎个人空间 <span className="tag green-tag">内置来源</span>
                    </h3>
                    <p>使用你有权访问的空间文件，不读取电脑本地文件。</p>
                    <div className="connection-skills">用于 PPT 生成、数据看板、资料整理等技能</div>
                  </div>
                  <button className="secondary" onClick={() => setModal('connection')}>
                    查看访问范围 <ArrowRight size={14} />
                  </button>
                </div>
                <div className="empty-connections">
                  <Link2 size={30} />
                  <h3>暂无外部账号连接</h3>
                  <p>
                    首批技能可以直接使用空间资料。
                    <br />
                    外部服务完成接入后，会在这里展示连接和授权入口。
                  </p>
                  <span className="subtle-label">功能位已预留 · 不代表已支持第三方连接</span>
                </div>
                <div className="connection-policy">
                  <ShieldCheck size={17} />
                  <span>连接账号不等于授权全部资料。共享成果时，仍需单独确认发布范围。</span>
                </div>
              </section>
            ) : (
              <>
                {tab === 'discover' && !query && (
                  <div className="featured-heading">
                    <div>
                      <Sparkles size={17} />
                      <h2>把重复的工作，交给技能</h2>
                      <Mark n="02" />
                    </div>
                    <span>首批 5 项 · 按接入进度开放</span>
                  </div>
                )}
                {tab === 'mine' && (
                  <div className="section-heading">
                    <div>
                      <h2>
                        你的常用技能
                        <Mark n="05" />
                      </h2>
                      <p>收藏后，在这里和会话技能面板中更快找到。此页收藏仅为本次预览。</p>
                    </div>
                  </div>
                )}
                {query && <p className="search-count">找到 {filtered.length} 项相关技能</p>}
                <div className="skill-grid">
                  {filtered.map((s, i) => {
                    const Icon = iconMap[s.id];
                    return (
                      <article
                        className={`skill-card ${s.color} ${i < 2 && tab === 'discover' && !query ? 'featured' : ''}`}
                        key={s.id}
                      >
                        <button
                          className="art-button"
                          aria-label={`查看${s.title}详情`}
                          onClick={() => setDetail(s)}
                        >
                          <Preview id={s.id} />
                        </button>
                        <div className="skill-card-body">
                          <div className="card-title">
                            <div>
                              <span className={`skill-icon ${s.color}`}>
                                <Icon size={18} />
                              </span>
                              <h3>{s.title}</h3>
                            </div>
                            <button
                              className={`favorite ${favorites.includes(s.id) ? 'saved' : ''}`}
                              aria-label={`${favorites.includes(s.id) ? '取消收藏' : '收藏'}${s.title}`}
                              aria-pressed={favorites.includes(s.id)}
                              onClick={() => favorite(s.id)}
                            >
                              <Star size={18} />
                            </button>
                          </div>
                          <p>{s.description}</p>
                          <div className="card-bottom">
                            <span className="output-format">{s.output}</span>
                            <button className="text-button" onClick={() => setDetail(s)}>
                              查看详情 <ArrowRight size={15} />
                            </button>
                          </div>
                          <div className="availability">
                            <span className={`status-dot ${s.id === 'ppt' ? 'testing' : ''}`} />
                            {s.id === 'ppt' ? '本地验收中' : '接入中'}
                            <span>·</span>
                            <span>{s.id === 'ppt' ? '正式开放前仍需质量验收' : '可查看功能与调用设计'}</span>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {!filtered.length && (
                  <div className="empty-connections">
                    <Search size={32} />
                    <h3>{query ? '没有找到相关技能' : '还没有收藏技能'}</h3>
                    <p>{query ? '换一个工作场景或成果名称试试。' : '在技能卡片上点击星标，即可加入这里。'}</p>
                    <button
                      className="secondary"
                      onClick={() => {
                        setQuery('');
                        setTab('discover');
                      }}
                    >
                      查看全部技能
                    </button>
                  </div>
                )}
                <div className="conversation-tip">
                  <span className="tip-icon">
                    <MessageSquare size={22} />
                  </span>
                  <div>
                    <h3>
                      不必离开会话，也能调用技能
                      <Mark n="07" />
                    </h3>
                    <p>在输入框点选技能，或输入 / 搜索。选择资料、设置要求，然后继续你的工作。</p>
                  </div>
                  <button className="secondary" onClick={() => begin(skills[0])}>
                    体验调用流程 <ArrowRight size={15} />
                  </button>
                </div>
                {tab === 'mine' && (
                  <div className="recent-empty">
                    <Clock3 size={18} />
                    <span>最近使用会随真实任务自动记录，此次设计预览不会生成使用记录。</span>
                  </div>
                )}
              </>
            )}
            <footer className="page-footer">
              这里展示的是首批功能设计。演示资料均为合成示例，不会调用模型、连接账号或修改空间文件。
            </footer>
          </main>
        ) : (
          <main className="conversation-page">
            <div className="conversation-heading">
              <button className="text-button" onClick={back}>
                <ArrowLeft size={16} /> 返回技能中心
              </button>
              <span className="subtle-label">调用流程演示 · 不执行真实任务</span>
            </div>
            <div className="chat-column">
              <div className="chat-intro">
                <span className={`large-skill-icon ${flow.color}`}>
                  {(() => {
                    const Icon = iconMap[flow.id];
                    return <Icon size={27} />;
                  })()}
                </span>
                <h1>用{flow.title}，开始这次工作</h1>
                <p>{flow.input}。先确认输入，再查看成果。</p>
              </div>
              {stage === 0 ? (
                <>
                  <div className="starter-prompts">
                    {(flow.id === 'ppt'
                      ? ['用季度数据，制作一份面向管理层的复盘汇报', '做一份 6 页的新项目启动方案']
                      : flow.id === 'dashboard'
                        ? ['分析月度营收趋势，支持按月份筛选', '展示关键指标和原始明细']
                        : flow.id === 'organizer'
                          ? ['按项目归类资料，先给我整理预案', '找出完全重复的文件，暂时不要删除']
                          : flow.id === 'meeting'
                            ? ['整理会议结论，把不明确的负责人标为待确认', '生成纪要，保留回听定位']
                            : ['把这份项目计划制作成一张流程图', '提炼文档重点，生成一张信息图']
                    ).map((p) => (
                      <button key={p} onClick={() => setPrompt(p)}>
                        {p}
                        <ArrowUp size={14} />
                      </button>
                    ))}
                  </div>
                  <div className="composer">
                    <div className="composer-top">
                      <button className="selected-skill" onClick={() => setPicker(!picker)}>
                        <Sparkles size={14} />
                        {flow.title}
                        <ChevronDown size={13} />
                      </button>
                      <Mark n="08" />
                      <span>资料范围：仅本次所选</span>
                    </div>
                    {picker && (
                      <div className="skill-picker">
                        <b>选择一个技能</b>
                        {skills.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => {
                              setFlow(s);
                              setPicker(false);
                            }}
                          >
                            {s.title}
                            {flow.id === s.id ? <Check size={16} /> : <ChevronRight size={15} />}
                          </button>
                        ))}
                      </div>
                    )}
                    <textarea
                      aria-label="工作要求"
                      value={prompt}
                      onChange={(e) => {
                        setPrompt(e.target.value);
                        if (e.target.value === '/') setPicker(true);
                      }}
                      placeholder={
                        flow.id === 'ppt'
                          ? '这份 PPT 讲什么？面向谁？希望得出什么结论？'
                          : '描述你想完成的工作，输入 / 也可以选择技能'
                      }
                      rows={4}
                    />
                    <div className="attached-files">
                      {selected.map((f) => (
                        <span key={f}>
                          <FileText size={14} />
                          {f}
                          <button
                            aria-label={`移除${f}`}
                            onClick={() => setSelected(selected.filter((n) => n !== f))}
                          >
                            <X size={13} />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="composer-settings">
                      {flow.id === 'ppt' ? (
                        <>
                          <label>
                            页数{' '}
                            <select value={pages} onChange={(e) => setPages(Number(e.target.value))}>
                              {[4, 6, 8].map((n) => (
                                <option key={n} value={n}>
                                  {n} 页
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            风格{' '}
                            <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                              <option>沉静紫</option>
                              <option>深海蓝</option>
                            </select>
                          </label>
                        </>
                      ) : (
                        <span className="muted">
                          {flow.id === 'organizer'
                            ? '先展示预案，确认后才执行'
                            : flow.id === 'dashboard'
                              ? '指标有歧义时，先确认口径'
                              : '先确认内容，再生成成果'}
                        </span>
                      )}
                    </div>
                    <div className="composer-bottom">
                      <button className="text-button" onClick={() => setModal('files')}>
                        <Paperclip size={17} /> 选择空间资料
                      </button>
                      <button className="primary" onClick={submit}>
                        预览下一步 <ArrowUp size={16} />
                      </button>
                    </div>
                  </div>
                  <p className="private-note">
                    <ShieldCheck size={13} /> 成果默认为私人草稿；共享发布需要单独确认。
                  </p>
                </>
              ) : (
                <>
                  <div className="user-message">{prompt}</div>
                  <div className="draft-card">
                    <div className="draft-heading">
                      <div>
                        <span className="demo-kicker">合成示例 · 拟议交互</span>
                        <h2>
                          {stage === 2
                            ? '成果交付'
                            : flow.id === 'ppt'
                              ? `PPT 大纲 · ${pages} 页`
                              : flow.id === 'organizer'
                                ? '整理预案'
                                : flow.id === 'dashboard'
                                  ? '确认字段与指标'
                                  : flow.id === 'meeting'
                                    ? '校对纪要与待办'
                                    : '确认信息结构'}
                        </h2>
                      </div>
                      <span className="tag">{stage === 2 ? '示例成果' : '等待你确认'}</span>
                    </div>
                    {stage === 1 ? (
                      <>
                        {flow.id === 'ppt' ? (
                          <>
                            <p className="muted">核对每页主题与顺序。正文和数据编辑为待确认功能位。</p>
                            <div className="outline-list">
                              {outline.map((title, i) => (
                                <div key={i}>
                                  <span>{String(i + 1).padStart(2, '0')}</span>
                                  <input
                                    aria-label={`第${i + 1}页标题`}
                                    value={title}
                                    onChange={(e) =>
                                      setOutline(outline.map((t, n) => (n === i ? e.target.value : t)))
                                    }
                                  />
                                  <button
                                    className="icon-button"
                                    disabled={i === 0}
                                    aria-label={`上移第${i + 1}页`}
                                    onClick={() =>
                                      setOutline((old) => {
                                        const a = [...old];
                                        [a[i - 1], a[i]] = [a[i], a[i - 1]];
                                        return a;
                                      })
                                    }
                                  >
                                    <ArrowUp size={15} />
                                  </button>
                                  <button
                                    className="icon-button"
                                    disabled={i === outline.length - 1}
                                    aria-label={`下移第${i + 1}页`}
                                    onClick={() =>
                                      setOutline((old) => {
                                        const a = [...old];
                                        [a[i + 1], a[i]] = [a[i], a[i + 1]];
                                        return a;
                                      })
                                    }
                                  >
                                    <ArrowDown size={15} />
                                  </button>
                                </div>
                              ))}
                            </div>
                            <details className="data-review">
                              <summary>
                                正文与数据核对 <span>新增功能位</span>
                              </summary>
                              <label>
                                核心结论
                                <textarea defaultValue="营收逐月增加，客户数口径仍需核对。" />
                              </label>
                              <div className="field-row">
                                <label>
                                  指标
                                  <input defaultValue="客户数" />
                                </label>
                                <label>
                                  单位
                                  <input placeholder="资料未提供，待确认" />
                                </label>
                              </div>
                              <p>拟议：按页编辑正文、表格和图表；确认后保存完整版本。</p>
                            </details>
                          </>
                        ) : flow.id === 'organizer' ? (
                          <div className="plan-rows">
                            {[
                              '方案_最终版.docx → 项目方案 / 方案.docx',
                              '会议记录_01.docx → 会议资料 / 会议记录.docx',
                              '数据_新.xlsx → 经营数据 / 季度数据.xlsx',
                            ].map((x) => (
                              <label key={x}>
                                <input type="checkbox" defaultChecked />
                                {x}
                              </label>
                            ))}
                            <p className="muted">仅预览移动和命名，不删除、不覆盖原资料。</p>
                          </div>
                        ) : flow.id === 'dashboard' ? (
                          <div className="plan-rows">
                            <label>
                              时间维度
                              <select>
                                <option>月份</option>
                              </select>
                            </label>
                            <label>
                              核心指标
                              <select>
                                <option>营收（万元）</option>
                              </select>
                            </label>
                            <label>
                              客户数口径
                              <input placeholder="资料未说明跨期去重，不计算客户总数" />
                            </label>
                            <p className="muted">使用固定数据快照，可查看筛选后的明细。</p>
                          </div>
                        ) : (
                          <div className="plan-rows">
                            <label>
                              关键内容
                              <textarea
                                defaultValue={
                                  flow.id === 'meeting'
                                    ? '议题：产品进度复盘\n结论：优先完善资料流程\n待办负责人：待确认'
                                    : '目标 → 路径 → 行动\n保留关键结论，数据和文字逐项核对'
                                }
                              />
                            </label>
                            <p className="muted">这里为中间确认步骤的布局示意。</p>
                          </div>
                        )}
                        <div className="draft-actions">
                          <button className="secondary" onClick={() => setStage(0)}>
                            返回调整输入
                          </button>
                          <button className="primary" onClick={() => setStage(2)}>
                            确认并查看成果示例 <ArrowRight size={15} />
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <Preview id={flow.id} large />
                        <div className="result-note">
                          <Check size={18} />
                          <div>
                            <b>成果操作区</b>
                            <p>预览、下载、保存到个人空间、继续修改；发布共享时另行确认。</p>
                          </div>
                        </div>
                        <div className="draft-actions">
                          <button className="secondary" onClick={() => setStage(1)}>
                            继续修改
                          </button>
                          <button
                            className="secondary"
                            onClick={() => setToast('这是下载功能位，原型不会生成真实文件')}
                          >
                            下载
                          </button>
                          <button
                            className="primary"
                            onClick={() => setToast('这是保存功能位，原型不会写入个人空间')}
                          >
                            保存到个人空间
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </main>
        )}
      </div>
      {detail && (
        <Modal label={`${detail.title}详情`} className="detail-drawer" onClose={() => setDetail(null)}>
          <div className="drawer-top">
            <span>
              技能详情
              <Mark n="03" />
            </span>
            <button className="icon-button" aria-label="关闭详情" onClick={() => setDetail(null)}>
              <X size={20} />
            </button>
          </div>
          <div className="drawer-scroll">
            <Preview id={detail.id} large />
            <div className="detail-heading">
              <div>
                <span className="overline">{detail.eyebrow}</span>
                <h2>{detail.title}</h2>
              </div>
              <button
                className={`favorite ${favorites.includes(detail.id) ? 'saved' : ''}`}
                aria-label={`详情${favorites.includes(detail.id) ? '取消收藏' : '收藏'}`}
                aria-pressed={favorites.includes(detail.id)}
                onClick={() => favorite(detail.id)}
              >
                <Star size={21} />
              </button>
            </div>
            <p className="detail-description">{detail.description}</p>
            <div className="detail-facts">
              <div>
                <small>准备什么</small>
                <p>{detail.input}</p>
              </div>
              <div>
                <small>你会得到</small>
                <p>{detail.output}</p>
              </div>
            </div>
            <h3>使用步骤</h3>
            <ol className="steps">
              {detail.steps.map((s, i) => (
                <li key={s}>
                  <span>{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
            <h3>
              资料与连接
              <Mark n="04" />
            </h3>
            <div className="detail-connection">
              <FolderOpen size={19} />
              <div>
                <b>梦擎空间资料</b>
                <small>仅使用本次选中的授权资料</small>
              </div>
              <span>无需外部连接</span>
            </div>
            <details className="source-info">
              <summary>能力边界与开源来源</summary>
              <p>{detail.boundary}</p>
              <a href={detail.url} target="_blank" rel="noreferrer">
                {detail.source} ↗
              </a>
              <p className="muted">这是适配来源说明，不代表该技能已正式开放。</p>
            </details>
          </div>
          <div className="drawer-footer">
            <span>{detail.id === 'ppt' ? '本地验收中 · 尚未正式开放' : '接入中 · 可预览交互设计'}</span>
            <button className="primary" onClick={() => begin(detail)}>
              预览调用流程 <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {modal && (
        <Modal
          label={modal === 'help' ? '设计说明' : modal === 'connection' ? '资料访问范围' : '选择空间资料'}
          onClose={() => setModal(null)}
          className="small-modal"
        >
          <div className="drawer-top">
            <h2>
              {modal === 'help'
                ? '先确认功能位，再接入业务'
                : modal === 'connection'
                  ? '资料访问范围'
                  : '选择空间资料'}
            </h2>
            <button className="icon-button" aria-label="关闭弹窗" onClick={() => setModal(null)}>
              <X size={20} />
            </button>
          </div>
          <div className="modal-body">
            {modal === 'help' ? (
              <>
                <p>这是可交互的前端设计预览，收藏、设置和确认仅在本页演示。</p>
                <ol className="review-list">
                  <li>01 页面入口与搜索</li>
                  <li>02 成果预览与技能卡片</li>
                  <li>03 详情与调用按钮</li>
                  <li>04 资料要求、连接和来源说明</li>
                  <li>05 收藏与最近使用</li>
                  <li>06 统一账号与连接管理</li>
                  <li>07 会话中的技能入口</li>
                  <li>08 资料选择、技能设置和确认流程</li>
                </ol>
                <button
                  className="primary"
                  onClick={() => {
                    setMarks(true);
                    setModal(null);
                  }}
                >
                  在页面上显示功能位
                </button>
              </>
            ) : modal === 'connection' ? (
              <>
                <div className="permission-summary">
                  <ShieldCheck size={24} />
                  <b>每次调用，单独选择资料</b>
                </div>
                <p>
                  技能只读取你有权限且本次选中的文件。访问共享空间资料沿用空间权限，不因使用技能而扩大范围。
                </p>
                <ul>
                  <li>读取资料：限本次选择</li>
                  <li>保存成果：默认私人草稿</li>
                  <li>资料整理：先确认预案再执行</li>
                  <li>共享发布：另行确认</li>
                </ul>
                <p className="muted">这是权限展示设计，不读取当前账号的实际授权。</p>
              </>
            ) : (
              <>
                <p className="muted">个人空间 / 演练资料 · 合成示例</p>
                {files.map((f) => (
                  <label className="file-choice" key={f}>
                    <input
                      type="checkbox"
                      checked={selected.includes(f)}
                      onChange={() =>
                        setSelected((old) => (old.includes(f) ? old.filter((x) => x !== f) : [...old, f]))
                      }
                    />
                    <FileText size={20} />
                    <span>
                      {f}
                      <small>个人空间 · 固定版本示例</small>
                    </span>
                  </label>
                ))}
                <button className="primary full" onClick={() => setModal(null)}>
                  使用所选资料（{selected.length}）
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
