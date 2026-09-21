import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Bot,
  Building2,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  GitBranch,
  History,
  List,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useDemo, useUI } from '../store';
import { latest, spaceName } from '../model';
import {
  capabilities,
  colleagues,
  colleagueMaterials,
  colleagueName,
  colleagueSpaceIds,
  collaborationStatus,
  departments,
  departmentIncludes,
  isCollaborationOpen,
  startCollaboration,
} from '../colleagues';
import { Badge, Button, Empty, IconButton, PageActions } from '../components/ui';

export function Colleagues() {
  const { state, change } = useDemo();
  const ui = useUI();
  const [department, setDepartment] = useState('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [view, setView] = useState<'people' | 'map' | 'requests'>('people');
  const [selected, setSelected] = useState<string | null>('zhou');
  const [detailTab, setDetailTab] = useState<'capabilities' | 'materials'>('capabilities');
  const detailPanel = useRef<HTMLElement>(null);
  const people = colleagues.filter(
    (c) =>
      departmentIncludes(department, c.department) &&
      [
        colleagueName(state, c.id),
        c.role,
        departments.find((d) => d.id === c.department)?.name,
        ...capabilities.filter((a) => a.colleague === c.id).map((a) => a.name),
      ]
        .join(' ')
        .includes(query.trim()),
  );
  useEffect(() => {
    if (selected && !people.some((c) => c.id === selected)) setSelected(null);
  }, [department, query]);
  const person = colleagues.find((c) => c.id === selected);
  const docs = selected ? colleagueMaterials(state, selected) : [];
  function choose(id: string) {
    setSelected(id);
    setDetailTab('capabilities');
    if (window.innerWidth <= 1250)
      requestAnimationFrame(() =>
        detailPanel.current?.scrollIntoView({ block: 'start', behavior: 'instant' }),
      );
  }
  function chooseDepartment(id: string) {
    setDepartment(id);
    setView('people');
  }
  function start(id: string) {
    const request = change((s) => startCollaboration(s, id));
    ui.preview(null);
    ui.go(`chat/${request.chatId}`);
  }
  return (
    <div className="page-container colleagues-page">
      <PageActions>
        <Button
          icon={History}
          onClick={() => {
            setView(view === 'requests' ? 'people' : 'requests');
          }}
          aria-pressed={view === 'requests'}
        >
          {view === 'requests'
            ? '返回同事目录'
            : `我的协作${state.collaborations.length ? ` · ${state.collaborations.length}` : ''}`}
        </Button>
      </PageActions>
      <div className="colleagues-layout">
        <aside className="org-directory" aria-label="组织目录">
          <div className="org-label">
            <Building2 size={16} />
            <strong>组织目录</strong>
          </div>
          <button
            className={`org-node ${department === 'all' ? 'selected' : ''}`}
            onClick={() => chooseDepartment('all')}
          >
            <Users size={16} />
            <span>全部同事</span>
            <small>{colleagues.length}</small>
          </button>
          {departments
            .filter((d) => !d.parent)
            .map((d) => (
              <div key={d.id}>
                <div className="org-branch">
                  {departments.some((child) => child.parent === d.id) ? (
                    <IconButton
                      icon={expanded ? ChevronDown : ChevronRight}
                      label={expanded ? '收起业务团队' : '展开业务团队'}
                      onClick={() => setExpanded(!expanded)}
                      aria-expanded={expanded}
                    />
                  ) : (
                    <span className="org-indent" />
                  )}
                  <button
                    className={`org-node ${department === d.id ? 'selected' : ''}`}
                    onClick={() => chooseDepartment(d.id)}
                  >
                    <span>{d.name}</span>
                    <small>{colleagues.filter((c) => departmentIncludes(d.id, c.department)).length}</small>
                  </button>
                </div>
                {expanded &&
                  departments
                    .filter((child) => child.parent === d.id)
                    .map((child) => (
                      <button
                        className={`org-node org-child ${department === child.id ? 'selected' : ''}`}
                        key={child.id}
                        onClick={() => chooseDepartment(child.id)}
                      >
                        <span>{child.name}</span>
                        <small>{colleagues.filter((c) => c.department === child.id).length}</small>
                      </button>
                    ))}
              </div>
            ))}
          <p>组织展示职责，工作空间承载资料与成果。</p>
        </aside>
        <section className="colleagues-content" aria-label="同事与能力">
          {view === 'requests' ? (
            <>
              <div className="colleagues-toolbar">
                <h2>我的协作</h2>
                <Badge>{state.collaborations.filter(isCollaborationOpen).length} 项进行中</Badge>
              </div>
              {state.collaborations.length ? (
                state.collaborations.map((r) => (
                  <button
                    className="colleague-request-row"
                    key={r.id}
                    onClick={() => ui.go(`chat/${r.chatId}`)}
                  >
                    <span className="person-avatar">
                      <Bot size={20} />
                    </span>
                    <span className="grow">
                      <strong>{capabilities.find((c) => c.id === r.capabilityId)?.name}</strong>
                      <small>
                        {colleagueName(state, r.colleagueId)} · {r.brief.month} · {r.brief.scope}
                      </small>
                    </span>
                    <Badge blue={isCollaborationOpen(r)}>{collaborationStatus[r.status]}</Badge>
                    <ArrowUpRight size={16} />
                  </button>
                ))
              ) : (
                <Empty
                  icon={History}
                  title="从一次协作开始"
                  text="选择同事的一项能力，系统会准备好会话和需求卡。"
                >
                  <Button onClick={() => setView('people')}>浏览同事能力</Button>
                </Empty>
              )}
            </>
          ) : (
            <>
              <div className="colleagues-toolbar">
                <div className="search-input">
                  <Search size={16} />
                  <input
                    aria-label="搜索同事或能力"
                    placeholder="搜索同事、职责或能力"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setView('people');
                    }}
                  />
                  {query && <IconButton icon={X} label="清空同事搜索" onClick={() => setQuery('')} />}
                </div>
                <Button
                  icon={view === 'map' ? List : GitBranch}
                  onClick={() => setView(view === 'map' ? 'people' : 'map')}
                >
                  {view === 'map' ? '成员列表' : '组织全貌'}
                </Button>
              </div>
              {view === 'map' ? (
                <div className="organization-map">
                  <div className="organization-root">
                    <Building2 size={20} />
                    <strong>企业组织</strong>
                    <span>4 位同事 · 3 个职能团队</span>
                  </div>
                  {departments
                    .filter((d) => !d.parent)
                    .map((d) => (
                      <section className="organization-group" key={d.id}>
                        <button onClick={() => chooseDepartment(d.id)}>
                          <Folder size={17} />
                          <strong>{d.name}</strong>
                          <ChevronRight size={16} />
                        </button>
                        {departments
                          .filter((child) => child.parent === d.id)
                          .map((child) => (
                            <div className="organization-team" key={child.id}>
                              <button onClick={() => chooseDepartment(child.id)}>
                                {child.name}
                                <ChevronRight size={14} />
                              </button>
                              <div className="row wrap">
                                {colleagues
                                  .filter((c) => c.department === child.id)
                                  .map((c) => (
                                    <button
                                      className="person-chip"
                                      onClick={() => {
                                        setView('people');
                                        setDepartment('all');
                                        setQuery('');
                                        choose(c.id);
                                      }}
                                      key={c.id}
                                    >
                                      {colleagueName(state, c.id)}
                                    </button>
                                  ))}
                              </div>
                            </div>
                          ))}
                        <div className="row wrap">
                          {colleagues
                            .filter((c) => c.department === d.id)
                            .map((c) => (
                              <button
                                className="person-chip"
                                onClick={() => {
                                  setView('people');
                                  setDepartment('all');
                                  setQuery('');
                                  choose(c.id);
                                }}
                                key={c.id}
                              >
                                {colleagueName(state, c.id)}
                              </button>
                            ))}
                        </div>
                      </section>
                    ))}
                </div>
              ) : (
                <>
                  <div className="directory-heading">
                    <div>
                      <h2>
                        {department === 'all'
                          ? '全部同事'
                          : departments.find((d) => d.id === department)?.name}
                      </h2>
                    </div>
                    <span className="subtle">{people.length} 位</span>
                  </div>
                  <div className="colleague-list">
                    {people.map((c) => (
                      <button
                        className={`colleague-card ${selected === c.id ? 'selected' : ''}`}
                        key={c.id}
                        onClick={() => choose(c.id)}
                        aria-pressed={selected === c.id}
                      >
                        <div className="row">
                          <span className={`person-avatar tone-${c.id}`}>
                            {colleagueName(state, c.id)[0]}
                          </span>
                          <span className="grow">
                            <strong>
                              {colleagueName(state, c.id)}
                              {c.id === 'me' && <small> · 我</small>}
                            </strong>
                            <span className="person-role">
                              {departments.find((d) => d.id === c.department)?.name} · {c.role}
                            </span>
                          </span>
                          <ChevronRight size={16} />
                        </div>
                        <div className="person-capabilities">
                          <Bot size={15} />
                          <span>
                            {capabilities
                              .filter((a) => a.colleague === c.id)
                              .map((a) => a.name)
                              .join(' · ')}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                  {!people.length && (
                    <Empty
                      icon={Search}
                      title="没有找到匹配的同事"
                      text="可以换一个能力关键词，或查看全部部门。"
                    >
                      <Button
                        onClick={() => {
                          setQuery('');
                          setDepartment('all');
                        }}
                      >
                        查看全部同事
                      </Button>
                    </Empty>
                  )}
                  <div className="directory-note">
                    <ShieldCheck size={17} />
                    <p>能力由同事负责，执行与交付按请求确认。以下身份与能力均为演示。</p>
                  </div>
                </>
              )}
            </>
          )}
        </section>
        <aside ref={detailPanel} className="colleague-detail" aria-label="同事详情">
          {person ? (
            <>
              <div className="colleague-detail-header">
                <span className={`person-avatar tone-${person.id}`}>
                  {colleagueName(state, person.id)[0]}
                </span>
                <div>
                  <h2>{colleagueName(state, person.id)}</h2>
                  <p>
                    {person.role} · {departments.find((d) => d.id === person.department)?.name}
                  </p>
                </div>
                <IconButton icon={X} label="关闭同事详情" onClick={() => setSelected(null)} />
              </div>
              <p className="person-about">{person.about}</p>
              <div className="person-spaces">
                {colleagueSpaceIds(state, person.id).map((id) => (
                  <Button variant="ghost" key={id} icon={Folder} onClick={() => ui.go(`space/${id}`)}>
                    {spaceName(state, id)}
                    <ArrowUpRight size={13} />
                  </Button>
                ))}
              </div>
              <div className="tabs" role="tablist" aria-label="同事信息">
                <button
                  role="tab"
                  aria-selected={detailTab === 'capabilities'}
                  onClick={() => setDetailTab('capabilities')}
                >
                  智能体能力
                </button>
                <button
                  role="tab"
                  aria-selected={detailTab === 'materials'}
                  onClick={() => setDetailTab('materials')}
                >
                  可访问资料 <span>{docs.length}</span>
                </button>
              </div>
              {detailTab === 'capabilities' ? (
                <div className="capability-list">
                  {capabilities
                    .filter((c) => c.colleague === person.id)
                    .map((c) => (
                      <article className="capability-card" key={c.id}>
                        <div className="row">
                          <Sparkles size={16} />
                          <h3>{c.name}</h3>
                        </div>
                        <p>{c.description}</p>
                        <dl>
                          <dt>需要提供</dt>
                          <dd>{c.inputs}</dd>
                          <dt>交付内容</dt>
                          <dd>{c.output}</dd>
                          <dt>确认方式</dt>
                          <dd>同事授权处理，审阅后交付</dd>
                        </dl>
                        <Button
                          variant="primary"
                          className="full"
                          onClick={() => start(c.id)}
                          aria-label={`发起协作：${c.name}`}
                        >
                          发起协作
                          <ArrowUpRight size={15} />
                        </Button>
                      </article>
                    ))}
                </div>
              ) : (
                <div className="colleague-materials">
                  <p className="subtle">由该同事维护、且你有权查看的共享资料。与资料库共用版本和状态。</p>
                  {docs.map((doc) => (
                    <button key={doc.id} onClick={() => ui.open({ kind: 'details', id: doc.id })}>
                      <FileText size={19} />
                      <span>
                        <strong>{doc.title}</strong>
                        <small>
                          {spaceName(state, doc.space)} · v{latest(doc).number} · {doc.status}
                        </small>
                        <p>{doc.summary}</p>
                      </span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                  {!docs.length && (
                    <div className="quiet-empty">暂无对你可见的共享资料。你仍可通过能力卡发起协作。</div>
                  )}
                  <div className="directory-note">
                    <ShieldCheck size={16} />
                    <p>个人草稿、私人会话与个人记忆不会出现在这里。</p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <Empty
              icon={Bot}
              title="了解同事的 AI 能力"
              text="选择一位同事，查看可承接的工作、相关空间和可访问资料。"
            />
          )}
        </aside>
      </div>
    </div>
  );
}
