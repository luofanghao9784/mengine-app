import { useEffect, useRef, useState } from 'react';
import {
  BookOpenCheck, Building2, ChartColumn, Database, FileSignature, FileStack, FileText, Headset, Library, ListChecks,
  Lock, Megaphone, MessageSquareText, Newspaper, NotebookPen, PhoneCall, RefreshCcw, Rocket, Scale, ScrollText,
  FolderKey, Target, User, UserCog, type LucideIcon,
} from 'lucide-react';
import { EngineBackdrop } from './EngineViews';
import { useInView } from './hooks';

const Mark = () => (
  <svg className="mark" viewBox="0 0 40 40" fill="none" strokeWidth="1.6" aria-hidden="true">
    <ellipse cx="20" cy="20" rx="16" ry="7" transform="rotate(-45 20 20)" stroke="currentColor" />
    <ellipse cx="20" cy="20" rx="16" ry="7" transform="rotate(45 20 20)" stroke="currentColor" strokeDasharray="2 3" opacity=".7" />
    <circle cx="20" cy="20" r="2.4" fill="currentColor" />
  </svg>
);

/* —— 真实的梦擎工作空间客户端，用合成数据驱动，嵌在页面里只供观看 —— */
const TENANT = '00000000-0000-4000-8000-000000000001';
const VIEW_W = 1440;
const VIEW_H = 900;

function ClientFrame({ hash, title, openFirstCard }: { hash: string; title: string; openFirstCard?: boolean }) {
  // 提前两屏左右就开始加载，加载过就一直留着：滚到跟前时界面已经在了，来回滚动也不会重新加载。
  const [ref, inView] = useInView<HTMLDivElement>('1600px');
  const [seen, setSeen] = useState(false);
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(0.6);
  useEffect(() => {
    if (inView) setSeen(true);
  }, [inView]);
  useEffect(() => {
    const el = ref.current!;
    const fit = () => setScale(el.clientWidth / VIEW_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  // “有据”一段要展示阅读窗口：客户端加载好之后，替访客点开第一张画报。
  const opened = (frame: HTMLIFrameElement) => {
    setReady(true);
    if (!openFirstCard) return;
    let tries = 0;
    const timer = setInterval(() => {
      const card = frame.contentDocument?.querySelector<HTMLButtonElement>('button.live-briefing-body');
      if (card) card.click();
      if (card || ++tries > 40) clearInterval(timer);
    }, 250);
  };
  return (
    <figure className="client-frame">
      <figcaption>
        <i /><i /><i />
        <span>{title}</span>
        <em>产品实际界面 · 演示数据</em>
      </figcaption>
      <div className="client-view" ref={ref} style={{ height: VIEW_H * scale }} data-ready={ready || undefined}>
        <p className="client-loading" aria-hidden={ready}><i />正在载入产品界面…</p>
        {seen && (
          <iframe
            src={`./demo/index.html#tenant=${TENANT}&${hash}`}
            title={title}
            tabIndex={-1}
            width={VIEW_W}
            height={VIEW_H}
            style={{ transform: `scale(${scale})` }}
            onLoad={(e) => opened(e.currentTarget)}
          />
        )}
      </div>
    </figure>
  );
}

/* —— 技能中心（尚未开放，这里是内容预览） —— */
const skills: { icon: LucideIcon; name: string; line: string; needs: string; ask: string }[] = [
  { icon: ChartColumn, name: '经营周报', line: '汇总这一周的经营数据，写成一页能直接转发的周报。', needs: '经营数据', ask: '用“经营周报”整理本周各门店的收款和到店情况' },
  { icon: ListChecks, name: '数据核对', line: '两份表格逐项比对，列出对不上的地方和可能的原因。', needs: '两份表格', ask: '用“数据核对”比对 9 月收款明细和银行流水' },
  { icon: FileSignature, name: '合同要点', line: '读一份合同，提出金额、期限、付款条件和需要留意的条款。', needs: '合同文件', ask: '用“合同要点”看一下这份场地租赁合同' },
  { icon: NotebookPen, name: '会议纪要', line: '把会议记录整理成结论、分工和待办，注明谁负责、何时完成。', needs: '会议记录', ask: '用“会议纪要”整理周一店长例会的记录' },
  { icon: Scale, name: '报价对比', line: '把几家供应商的报价放进一张表，按同一口径比较。', needs: '报价单', ask: '用“报价对比”比较三家器材供应商的报价' },
  { icon: Megaphone, name: '活动方案', line: '按目标、预算和时间起草一份活动方案，列出要准备的事项。', needs: '目标与预算', ask: '用“活动方案”起草国庆期间的会员回流活动' },
  { icon: PhoneCall, name: '回访清单', line: '从客户记录里找出该联系的人，并给出每个人的沟通要点。', needs: '客户记录', ask: '用“回访清单”找出 60 天没到店的会员' },
  { icon: BookOpenCheck, name: '制度问答', line: '按公司现行制度回答员工的问题，并指出依据的是哪一条。', needs: '公司制度', ask: '用“制度问答”查一下试用期请假怎么算' },
];

function SkillCenter() {
  const [picked, setPicked] = useState(1);
  return (
    <div className="skills-wrap">
      <div className="skills">
        {skills.map((s, i) => (
          <button type="button" key={s.name} aria-pressed={picked === i} onClick={() => setPicked(i)}>
            <i><s.icon size={22} strokeWidth={1.7} /></i>
            <b>{s.name}</b>
            <span>{s.line}</span>
            <em><FileStack size={13} strokeWidth={1.8} />需要：{s.needs}</em>
          </button>
        ))}
      </div>
      <div className="ask" aria-live="polite">
        <span>{skills[picked].ask}</span>
        <i>↑</i>
      </div>
    </div>
  );
}

/* —— 管得住：一个可以动手试的权限开关，加隔离、审计、用量三块 —— */
function Control() {
  const [granted, setGranted] = useState(true);
  const files: [string, string, boolean][] = [
    ['财务部', '9 月收款明细.xlsx', true],
    ['财务部', '供应商付款计划.xlsx', true],
    ['运营管理中心', '国庆活动方案.pdf', false],
    ['运营管理中心', '门店培训手册.pdf', false],
  ];
  return (
    <div className="control">
      <ul className="roles">
        <li><i><User size={20} strokeWidth={1.7} /></i><div><b>梦擎工作空间</b><span>员工用。会话、智能画报、资料库，电脑和手机的浏览器都能打开。</span></div></li>
        <li><i><UserCog size={20} strokeWidth={1.7} /></i><div><b>企业管理端</b><span>管理员用。邀请成员、分配权限、办理离职交接、查看用量。</span></div></li>
        <li><i><Headset size={20} strokeWidth={1.7} /></i><div><b>运营平台</b><span>岚云智能用。看护引擎运行，按授权提供支持。</span></div></li>
      </ul>
      <div className="bento">
        <article className="b-perm">
          <p className="label">权限由系统执行</p>
          <h3>收回权限，立刻生效。</h3>
          <div className="perm">
            <div className="perm-admin">
              <span className="pane-title"><UserCog size={14} />管理员这边</span>
              <div className="perm-row">
                <i>周</i>
                <div><b>周屿</b><span>财务部工作空间</span></div>
                <button type="button" role="switch" aria-checked={granted} aria-label="周屿对财务部工作空间的查看权限" onClick={() => setGranted((v) => !v)}><u /></button>
              </div>
              <p className="hint">{granted ? '试着关掉这个开关 →' : '权限已收回，右边马上变了。再点一下可以恢复。'}</p>
            </div>
            <div className="perm-user">
              <span className="pane-title"><User size={14} />周屿看到的资料库</span>
              <ul>
                {files.map(([space, name, finance]) => (
                  <li key={name} data-locked={(finance && !granted) || undefined}>
                    {finance && !granted ? <Lock size={16} /> : <FileText size={16} />}
                    <b>{finance && !granted ? '无权查看' : name}</b>
                    <span>{space}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="note">谁能看哪个空间的资料，由服务端判断，不靠 AI 自觉。AI 替他检索时，也只翻得到这些。</p>
        </article>
        <article className="b-wall">
          <div className="wall-art" aria-hidden="true">
            <div><Building2 size={18} /><i /><i /><i /><i /><i /></div>
            <div><Building2 size={18} /><i /><i /><i /><i /></div>
          </div>
          <h3>企业之间，互相看不到。</h3>
          <p>多家企业共用一套基础设施，数据和任务各走各的。</p>
        </article>
        <article className="b-audit">
          <h3>我们进来，每一步都留记录。</h3>
          <ol>
            <li><time>10:32</time>岚云支持 · 按授权进入</li>
            <li><time>10:33</time>查看引擎运行状态</li>
            <li><time>10:41</time>退出</li>
          </ol>
          <p><ScrollText size={14} />示例记录</p>
        </article>
        <article className="b-usage">
          <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="48" /><circle cx="60" cy="60" r="48" pathLength="100" strokeDasharray="62 100" /></svg>
          <div><h3>用量看得见。</h3><p>每个账号每天能生成多少都有上限，用了多少，管理端随时能查。</p></div>
        </article>
      </div>
    </div>
  );
}

/* —— 落地服务：一条路线，四站，每站写清我们做什么、你们准备什么（与手册的五步对应，后两步并成“复盘扩展”） —— */
const journey: { icon: LucideIcon; title: string; we: string; you: string }[] = [
  { icon: Target, title: '选定场景', we: '一起梳理高频工作，挑出最值得先交给 AI 的一件。', you: '一位能拍板的负责人。' },
  { icon: FolderKey, title: '搭建数据基座', we: '盘点来源、整理资料、确认口径，接上数据，把空间和权限配清楚。', you: '相关资料、成员名单，和一位能确认口径的业务负责人。' },
  { icon: Rocket, title: '跑通真实任务', we: '培训到每个岗位，陪着团队把一项真实任务从头做完。', you: '让团队每天用起来。' },
  { icon: RefreshCcw, title: '复盘扩展', we: '固定回访，看来源是否按时更新、哪里好用、哪里要调。', you: '决定下一个场景。' },
];

function Journey() {
  const [at, setAt] = useState(0);
  return (
    <ol className="journey" style={{ ['--at' as string]: at }}>
      {journey.map((j, i) => (
        <li key={j.title} data-on={i <= at || undefined} onMouseEnter={() => setAt(i)} onFocus={() => setAt(i)} tabIndex={0}>
          <i><j.icon size={24} strokeWidth={1.6} /></i>
          <h3>{j.title}</h3>
          <p><b>我们</b>{j.we}</p>
          <p><b>你们</b>{j.you}</p>
        </li>
      ))}
    </ol>
  );
}

export function App() {
  const [storyRef, storyIn] = useInView<HTMLDivElement>('100px');
  const sunrise = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [tone, setTone] = useState<'night' | 'day'>('night');
  const [curtain, setCurtain] = useState(false);
  useEffect(() => {
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    // 日出：滚过这一段时，夜色被晨光顶上来，页面换成工作空间的底色。
    const on = () => {
      setScrolled(scrollY > 24);
      const el = sunrise.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - innerHeight)));
      el.style.setProperty('--p', p.toFixed(3));
      el.style.setProperty('--k', smooth(0.34, 0.66, p).toFixed(3));
      el.style.setProperty('--g', (smooth(0.04, 0.32, p) * (1 - smooth(0.46, 0.8, p))).toFixed(3));
      setTone(r.top < 0 && (p > 0.5 || r.bottom <= 0) ? 'day' : 'night');
    };
    on();
    addEventListener('scroll', on, { passive: true });
    addEventListener('resize', on);
    // 导航和“回到开头”不直接跳：先落幕，换好位置，再拉开。
    const jump = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
      const target = link && document.querySelector<HTMLElement>(link.getAttribute('href')!);
      if (!target) return;
      e.preventDefault();
      setCurtain(true);
      setTimeout(() => {
        target.scrollIntoView({ behavior: 'instant', block: target.matches('.chapter:not(.hero)') ? 'center' : 'start' });
        setTimeout(() => setCurtain(false), 260);
      }, 420);
    };
    document.addEventListener('click', jump);
    return () => {
      document.removeEventListener('click', jump);
      removeEventListener('scroll', on);
      removeEventListener('resize', on);
    };
  }, []);

  return (
    <>
      <div className="curtain" data-on={curtain || undefined} aria-hidden="true"><Mark /></div>
      <nav className="nav" data-tone={tone} data-solid={scrolled || undefined}>
        <a className="brand" href="#top"><Mark />Mengine <small>梦核引擎</small></a>
        <div className="links">
          <a href="#engine">梦核引擎</a>
          <a href="#workspace">梦擎工作空间</a>
          <a href="#skills">技能中心</a>
          <a href="#control">管理与安全</a>
          <a href="#service">落地服务</a>
          <a href="#about">关于我们</a>
        </div>
        <a className="btn solid" href="./login/index.html">登录</a>
      </nav>

      {/* 引擎只出现这一次：它固定在屏幕上，往下滚只换文字，镜头跟着推近 */}
      <div className="story" ref={storyRef}>
        <div className="stage">{storyIn && <EngineBackdrop />}</div>
        <div className="chapters">
          <header className="chapter hero" id="top" data-zoom="0.7" data-shift="-1.45">
            <div className="hero-copy">
              <p className="eyebrow">Mengine 梦核引擎</p>
              <h1><span>让 AI 主动工作，</span><span><em>让经验成为能力。</em></span></h1>
              <p className="lede">梦核引擎每天读企业的数据和资料，把值得关注的事编成画报，送到每个人面前。员工在梦擎工作空间里接着追问、把事做完；做过的事，会变成下一次的经验。</p>
              <div className="cta">
                <a className="btn solid big" href="#engine">看它怎么工作</a>
                <a className="btn line big" href="#workspace">看梦擎工作空间</a>
              </div>
            </div>
            <ul className="pillars">
              <li><b>主动</b><span>不等你问，先把重点备好</span></li>
              <li><b>有据</b><span>每个判断都有理有据</span></li>
              <li><b>成长</b><span>纠正过一次，下次就记得</span></li>
            </ul>
          </header>

          <section className="chapter left" data-focus="in" data-shift="-1.3" data-labels id="engine">
            <div className="panel">
              <p className="eyebrow">输入</p>
              <h2>先把企业读懂。</h2>
              <p>这三条流向核心的光流，是正在进入引擎的数据和资料。每条光流上钉着一张卡片，写着它从哪来，数字是此刻正在处理的任务数。</p>
              <dl>
                <div><dt>外部取数</dt><dd>按设好的节奏，从企业已接入的业务系统读数据。每次同步都留一份固定版本。</dd></div>
                <div><dt>资料解析</dt><dd>把上传的文档、表格和拍照的单据读成可以检索的内容，原件和历史版本都留着。</dd></div>
                <div><dt>资料检索</dt><dd>为每个任务找资料，而且只找提问的人有权限看的。</dd></div>
              </dl>
            </div>
          </section>

          <section className="chapter right" data-zoom="0.66" data-shift="1.25" data-labels="core">
            <div className="panel">
              <p className="eyebrow">处理</p>
              <h2>一件事，<br />在核心里被做完。</h2>
              <p>中间这颗球是引擎的核心，上面的数字是此刻正在执行的任务。每个任务进来，都走同样的三步。</p>
              <dl>
                <div><dt>读懂问题</dt><dd>结合提问、企业背景和有权限的资料，弄清这一次到底要解决什么。</dd></div>
                <div><dt>掌握全局的数据</dt><dd>不是照着一份资料回答，而是把相关的数据和资料放在一起分析、判断。</dd></div>
                <div><dt>写成结果</dt><dd>把分析的结论讲明白，标上依据和来源；说不准的地方，直接写出来。</dd></div>
              </dl>
            </div>
          </section>

          <section className="chapter right" data-focus="out" data-labels>
            <div className="panel">
              <p className="eyebrow">输出</p>
              <h2>把成果送到人手里。</h2>
              <p>从核心流出去的两条光流，是引擎做完的东西：会话里的回答、整理好的画报，还有保存下来的成果文件。每条光流上的卡片写着它送去了哪里。</p>
              <dl>
                <div><dt>会话回答</dt><dd>回答一段一段返回，不用等全部写完；每个结论都带着出处。</dd></div>
                <div><dt>画报与成果文件</dt><dd>画报送到该看的人面前；文稿和表格保存进工作空间，同事可以接着用。</dd></div>
              </dl>
            </div>
          </section>

          <section className="chapter right" data-focus="pr" data-labels>
            <div className="panel">
              <p className="eyebrow">工作循环</p>
              <h2>用经验做事，<br />做完再攒经验。</h2>
              <p>这条实线轨道是工作循环，转的是经验库。每次工作先调用库里已有的方法，做完之后，把新的纠正和有效做法提炼、核验，再存回库里。</p>
              <dl>
                <div><dt>运用</dt><dd>接到任务，先从经验库里找出适用的方法和注意事项，带着它们去做。</dd></div>
                <div><dt>累积</dt><dd>任务里的纠正和好做法，提炼成方法，经另一个独立会话核验后入库。比如被纠正过“报价更新不代表合同金额变化”，下次分析价格时，它会先去核对合同。</dd></div>
                <div><dt>企业与通用</dt><dd>企业的经验留在企业；去掉企业信息和隐私之后的通用方法，才进入各家共用的经验库。</dd></div>
              </dl>
            </div>
          </section>

          <section className="chapter right" data-focus="evo" data-labels>
            <div className="panel">
              <p className="eyebrow">自进化循环</p>
              <h2>引擎也在检查自己。</h2>
              <p>外圈这条虚线轨道是自进化循环，和工作循环是两件事：工作循环积累的是做事的经验，自进化循环改进的是引擎自身的运行。轨道上那颗卫星一直在巡检。</p>
              <dl>
                <div><dt>巡检与扫描</dt><dd>沿轨道查看引擎各个环节的运行情况，找出做得不够好的地方。</dd></div>
                <div><dt>校准与修复</dt><dd>定位原因，调整引擎的做法。</dd></div>
                <div><dt>验证</dt><dd>改完先验证效果，确认变好了才保留。</dd></div>
              </dl>
            </div>
          </section>
        </div>
      </div>

      {/* 日出：从引擎的夜色，过渡到工作空间的白天 */}
      <div className="sunrise" ref={sunrise} id="workspace">
        <div className="sunrise-sky">
          <div className="sunrise-copy">
            <p className="eyebrow">Mengine Workspace 梦擎工作空间</p>
            <h2>每天早上，<br />今天的重点已经备好。</h2>
            <p>引擎忙完的事，员工在梦擎工作空间里看到。下面都是产品的实际界面，用的是演示数据。</p>
          </div>
        </div>
      </div>

      <div className="day">
        <section className="sec first" id="briefing">
          <div className="sec-head">
            <p className="eyebrow">主动 · 智能画报</p>
            <h2>打开，先看到结论。</h2>
            <p>不用自己去翻报表。引擎把值得关注的事写成一张张卡片，排好版，等你来看。</p>
          </div>
          <ClientFrame hash="view=briefing" title="智能画报" />
          <div className="facts">
            <div><h3>一张卡片，只说一件事</h3><p>资讯、数据、洞察、建议、成果，一共五类。标题就是结论，不用点开去猜。</p></div>
            <div><h3>没有新发现，就不凑数</h3><p>数据没变，也没有值得说的事，引擎会跳过这一轮。它不会为了显得勤快而刷屏。</p></div>
            <div><h3>有用没用，告诉它一声</h3><p>每张卡片都能标“有用”“没用”或“关注”。之后给你看什么，引擎会跟着调整。</p></div>
          </div>
        </section>

        <section className="sec" id="evidence">
          <div className="sec-head">
            <p className="eyebrow">有据</p>
            <h2>掌握全局的数据，<br />每个判断都有理有据。</h2>
            <p>很多人不敢把 AI 的结论拿去开会，是因为说不清它是怎么得出来的。梦核不是照着一份资料回答，而是掌握全局的数据；点开任何一张画报，都能看到它依据了哪些数据和资料。</p>
          </div>
          <ClientFrame hash="view=briefing" title="画报阅读窗口" openFirstCard />
          <div className="say-row">
            <div className="say">
              <p className="label">连措辞都有规矩</p>
              <table>
                <thead><tr><th>数据里的记录</th><th>画报里的说法</th></tr></thead>
                <tbody>
                  <tr><td><code>canceled</code></td><td>已取消<small>不写成“已退款”，取消和退款是两回事</small></td></tr>
                  <tr><td><code>finance_confirmed</code></td><td>财务已确认<small>不写成“已到账”，确认不是到账证明</small></td></tr>
                  <tr><td>只看了一部分记录</td><td>这是部分记录的观察<small>不拿抽样去推算全部</small></td></tr>
                  <tr><td>原因还没查实</td><td>列为“还需核实”<small>不把猜测写成事实</small></td></tr>
                </tbody>
              </table>
            </div>
            <div className="facts stack">
              <div><h3>每个结论都能展开</h3><p>用了哪些数据和资料、哪个版本、按什么口径，点开卡片就在旁边。</p></div>
              <div><h3>说不准的，会直说</h3><p>还缺什么信息、哪里需要人去核对，写在结论旁边，不藏在后面。</p></div>
              <div><h3>数据留着版本</h3><p>每次同步都存一份固定版本。上个月的结论，今天照样能复核。</p></div>
            </div>
          </div>
        </section>

        <section className="sec" id="chat">
          <div className="sec-head">
            <p className="eyebrow">接着干 · AI 会话</p>
            <h2>看到问题，<br />就地往下追。</h2>
            <p>每张画报都能直接发起会话。背景和依据会自动带上，不用把事情从头再讲一遍。</p>
          </div>
          <ClientFrame hash="view=conversations&conversation=00000000-0000-4000-8000-000000000040" title="AI 会话" />
          <div className="facts">
            <div><h3>它会动手</h3><p>查资料库、联网检索、读表格，需要计算时在隔离环境里跑程序。</p></div>
            <div><h3>只用你能看的</h3><p>它能翻到哪些资料，跟着提问的人的权限走。</p></div>
            <div><h3>按工作空间归档</h3><p>每段会话都属于一个工作空间。个人的事和团队的事，分开放。</p></div>
          </div>
        </section>

        <section className="sec" id="library">
          <div className="sec-head">
            <p className="eyebrow">留下来 · 资料库</p>
            <h2>资料和成果，<br />都留在团队里。</h2>
            <p>上传的文件、AI 做出来的文稿和表格，都存在这里。下一次工作，从已有的东西接着做。</p>
          </div>
          <ClientFrame hash="view=library&scope=personal" title="资料库" />
          <div className="facts">
            <div><h3>个人空间和企业资料库</h3><p>自己的草稿放个人空间，大家共用的放企业资料库，一键切换。</p></div>
            <div><h3>每次修改都留版本</h3><p>谁在什么时候改了什么，查得到，也退得回去。</p></div>
            <div><h3>按空间授权</h3><p>部门、客户、项目，都可以是一个工作空间，各有各的成员和资料。</p></div>
          </div>
        </section>

        <section className="sec" id="skills">
          <div className="sec-head">
            <p className="eyebrow">技能中心 <i className="soon">即将开放</i></p>
            <h2>常做的事，<br />点一下就开始。</h2>
            <p>技能中心把团队常用的做法收在一起。每个技能都写好了步骤、要用到的资料和交出来的样子。选一个，补上这次的材料，就可以直接开工，不用每次从头描述需求。</p>
          </div>
          <SkillCenter />
          <div className="facts">
            <div><h3>不用学怎么提问</h3><p>技能替你把话说全了。新同事第一天，也能做出老同事的水平。</p></div>
            <div><h3>做法统一</h3><p>同一件事，每个人用的是同一套步骤和口径，结果可以放在一起比。</p></div>
            <div><h3>照样有据可查</h3><p>技能跑出来的结果，和画报、会话一样带着出处，一样受权限约束。</p></div>
          </div>
        </section>

        <section className="sec" id="control">
          <div className="sec-head">
            <p className="eyebrow">管得住</p>
            <h2>交给 AI 的事越多，<br />越要管得住。</h2>
            <p>三个端，各管各的事。下面这个开关可以动手试一下。</p>
          </div>
          <Control />
        </section>

        <section className="sec" id="service">
          <div className="sec-head">
            <p className="eyebrow">落地服务</p>
            <h2>有人带着团队，<br />把它真正用起来。</h2>
            <p>买的不只是一套软件。从选哪件事开始，到团队每天在用，我们一路陪着。</p>
          </div>
          <Journey />
        </section>

        <footer className="closing" id="about">
          <div className="about">
            <p className="eyebrow">关于我们</p>
            <h3>岚云智能，让 AI 进入企业真实工作。</h3>
            <p>我们围绕企业资料、业务分析与团队成果，研发梦核引擎和梦擎工作空间，并提供场景梳理、配置与使用支持。通过实际工作验证产品，让有效方法逐步积累。</p>
          </div>
          <div className="end">
            <Mark />
            <h2>每一次工作，<br />都成为下一次的起点。</h2>
            <p>从一份资料、一个问题、一项真实任务开始。</p>
            <a className="btn gold big" href="#top">回到开头</a>
          </div>
          <p className="legal">© 2026 贵州岚云智能科技有限公司 · Mengine 梦核引擎 · Mengine Workspace 梦擎工作空间<span>联系电话：18586861020 · 暂未备案，仅供内部测试</span></p>
        </footer>
      </div>
    </>
  );
}
