import { useState } from 'react';
import {
  ArrowUpRight,
  ArrowLeft,
  Plus,
  Sparkles,
  Users,
  LayoutGrid,
  SlidersHorizontal,
  Search,
  Pencil,
  Check,
  CalendarDays,
  Trash2,
} from 'lucide-react';
import { useDemo, useUI } from '../store';
import { externalAppUrl } from '../ninepop/externalApp';
import { openBriefingChat, followupRows } from '../briefing';
import { addChat, addMessage, spaceName, uid, type Followup, type MiniApp } from '../model';
import { Badge, Button, Empty, Field, PageActions, SectionHeading } from '../components/ui';
export function startConfig(
  change: ReturnType<typeof useDemo>['change'],
  kind: 'dashboard' | 'builder',
  scope: string,
) {
  return change((s) => {
    const c = addChat(
      s,
      kind === 'dashboard'
        ? `调整${scope === 'personal' ? '我的' : spaceName(s, scope)}智能画报`
        : '搭建客户跟进应用',
      kind === 'dashboard' && scope !== 'personal' ? scope : 'none',
      kind,
      scope,
    );
    addMessage(
      c,
      'assistant',
      kind === 'dashboard'
        ? '我们先确定需要持续关注的信息。勾选下面的组件，可以预览并保存到智能画报。'
        : '先用客户跟进模板搭建一个工具。名称、说明和下次跟进日期都可以调整，完成后先保存为个人草稿。',
    );
    return c.id;
  });
}
// Older conversations keep their history; their configuration entry now leads to the card.
export function DashboardConfig({ scope }: { chatId: string; scope: string }) {
  const { state, change } = useDemo();
  const ui = useUI();
  const card = state.briefing?.cards.find((c) => c.id === `followup:${scope}` && c.active);
  return (
    <div className="collaboration-card">
      <strong>仪表盘已升级为智能画报</strong>
      <p className="subtle">原会话和配置记录已保留，现在可以直接调整每张卡片的呈现。</p>
      {card && (
        <Button onClick={() => ui.go(`chat/${change((s) => openBriefingChat(s, card.id, 'optimize'))}`)}>
          优化客户跟进卡片
        </Button>
      )}
      <Button onClick={() => ui.go(`briefing/${scope}`)}>打开智能画报</Button>
    </div>
  );
}
export function Applications({ scope, appId: rawId }: { scope: string; appId?: string }) {
  const { state, change } = useDemo();
  const ui = useUI();
  const appId = rawId?.split('?')[0];
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(
    new URLSearchParams(rawId?.split('?')[1] || '').get('status') || '全部',
  );
  const app = state.apps.find((a) => a.id === appId);
  const launchBuilder = (id = '') => {
    ui.preview(null);
    ui.go(`chat/${startConfig(change, 'builder', id)}`);
  };
  if (app?.external) {
    const url = externalAppUrl(app);
    return (
      <div className="page-container applications-page">
        <Button variant="ghost" icon={ArrowLeft} onClick={() => ui.go(`apps/${scope}`)}>
          返回应用
        </Button>
        <h1>{app.name}</h1>
        <p>{app.description}</p>
        <p>真实系统 · 使用9POP现有账号登录，按原有权限查看和操作。后台业务为实时数据。</p>
        {url ? (
          <a className="button primary" href={url} target="_blank" rel="noopener noreferrer">
            打开9POP后台 <ArrowUpRight size={16} />
          </a>
        ) : (
          <p role="alert">后台入口配置不可用。</p>
        )}
        <p className="subtle">画报保留9月24日固定快照；打开后台不会自动刷新画报或执行AI操作。</p>
      </div>
    );
  }
  if (app) {
    // Dashboard drilldown spans the same applications as its metrics.
    const dashboardDrilldown = !!rawId?.includes('?');
    const rows = state.records.filter(
      (r) =>
        (dashboardDrilldown ? followupRows(state, scope).some((row) => row.id === r.id) : r.app === app.id) &&
        (status === '全部' || r.status === status) &&
        `${r.customer} ${r.note}`.includes(query),
    );
    return (
      <div className="page-container applications-page">
        <Button
          variant="ghost"
          icon={ArrowLeft}
          onClick={() => ui.go(dashboardDrilldown ? `briefing/${scope}` : `apps/${scope}`)}
        >
          {dashboardDrilldown ? '返回智能画报' : '返回应用'}
        </Button>
        <PageActions>
          <Button icon={Sparkles} onClick={() => launchBuilder(app.id)}>
            让 AI 调整
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => ui.open({ kind: 'record', target: app.id })}>
            新增跟进
          </Button>
        </PageActions>
        <div className="toolbar">
          <div className="search-input">
            <Search size={16} />
            <input
              aria-label="搜索跟进记录"
              placeholder="搜索客户或跟进内容"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select aria-label="筛选跟进状态" value={status} onChange={(e) => setStatus(e.target.value)}>
            {['全部', '待跟进', '已联系', '已约定'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <span className="subtle">{rows.length} 条记录</span>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>客户</th>
                  <th>跟进内容</th>
                  <th>状态</th>
                  <th>负责人</th>
                  {app.hasDate && <th>下次跟进</th>}
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.customer}</strong>
                    </td>
                    <td className="record-note">{r.note}</td>
                    <td>
                      <Badge blue>{r.status}</Badge>
                    </td>
                    <td>{r.owner}</td>
                    {app.hasDate && <td className="subtle">{r.nextDate || '未安排'}</td>}
                    <td>
                      <div className="row">
                        <Button
                          variant="ghost"
                          aria-label={`编辑${r.customer}`}
                          onClick={() => ui.open({ kind: 'record', id: r.id, target: r.app })}
                        >
                          <Pencil size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={`删除${r.customer}`}
                          onClick={() =>
                            ui.open({
                              kind: 'confirm',
                              title: '删除跟进记录',
                              text: `删除「${r.customer}」这条演示记录后，相关画报卡片会同步更新。`,
                              onConfirm: () => {
                                change((s) => {
                                  s.records = s.records.filter((x) => x.id !== r.id);
                                });
                                ui.toast('跟进记录已删除');
                              },
                            })
                          }
                        >
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={Search} title="当前没有匹配的记录" text="调整筛选条件，或添加一条新的跟进。">
            <Button
              onClick={() => {
                setStatus('全部');
                setQuery('');
              }}
            >
              清除筛选
            </Button>
          </Empty>
        )}
      </div>
    );
  }
  const apps = state.apps.filter(
    (a) => (scope === 'all' || a.space === scope) && `${a.name} ${a.description}`.includes(query),
  );
  return (
    <div className="page-container applications-page">
      {state.scenario !== 'ninepop' && (
        <PageActions>
          <Button variant="primary" icon={Plus} onClick={() => launchBuilder()}>
            用 AI 搭建应用
          </Button>
        </PageActions>
      )}
      <div className="scope-tabs" aria-label="应用范围">
        {[{ id: 'all', name: '全部应用' }, { id: 'personal', name: '我的应用' }, ...state.spaces].map((s) => (
          <button
            key={s.id}
            className={scope === s.id ? 'selected' : ''}
            onClick={() => ui.go(`apps/${s.id}`)}
          >
            {s.name}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <h2>
          可用应用 <span className="subtle">{apps.length}</span>
        </h2>
        <div className="search-input">
          <Search size={16} />
          <input
            aria-label="搜索应用"
            placeholder="搜索应用"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="application-grid">
        {apps.map((a) => (
          <article className="application-card" key={a.id}>
            <div className="between">
              <span className="app-icon">
                <Users size={25} strokeWidth={1.4} />
              </span>
              <Badge blue={a.published}>
                {a.external ? '真实系统' : a.published ? '已共享' : '个人草稿'}
              </Badge>
            </div>
            <h2>{a.name}</h2>
            <p>{a.description}</p>
            <div className="app-meta">
              <FolderIcon />
              {spaceName(state, a.space)}
              <span>·</span>
              {a.external
                ? '使用9POP账号登录'
                : `${state.records.filter((r) => r.app === a.id).length} 条记录`}
            </div>
            {state.requests.some((r) => r.sourceId === a.id && r.status === 'pending') && (
              <p className="pending-note">共享申请等待负责人确认</p>
            )}
            <div className="row">
              {a.external ? (
                externalAppUrl(a) ? (
                  <a
                    className="button primary grow"
                    href={externalAppUrl(a)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    打开9POP后台 <ArrowUpRight size={15} />
                  </a>
                ) : (
                  <span>入口不可用</span>
                )
              ) : (
                <>
                  <Button className="grow" variant="primary" onClick={() => ui.go(`apps/${scope}/${a.id}`)}>
                    打开应用
                    <ArrowUpRight size={15} />
                  </Button>
                  <Button variant="ghost" aria-label={`配置${a.name}`} onClick={() => launchBuilder(a.id)}>
                    <SlidersHorizontal size={17} />
                  </Button>
                </>
              )}
            </div>
          </article>
        ))}
        {state.scenario !== 'ninepop' && (
          <button className="new-app-card" onClick={() => launchBuilder()}>
            <Plus size={25} />
            <strong>你还需要怎样的工具？</strong>
            <span>和 AI 说说，一起从模板开始</span>
          </button>
        )}
      </div>
    </div>
  );
}
function FolderIcon() {
  return <LayoutGrid size={14} />;
}
export function AppBuilder({ chatId, appId }: { chatId: string; appId?: string }) {
  const { state, change } = useDemo();
  const ui = useUI();
  const app = state.apps.find((a) => a.id === appId);
  const [name, setName] = useState(
    app?.name || (state.scenario === 'konggu' ? '我的企业活动跟进' : '我的客户跟进'),
  );
  const [description, setDescription] = useState(app?.description || '记录客户沟通与下一步安排。');
  const [hasDate, setHasDate] = useState(app?.hasDate ?? true);
  const [preview, setPreview] = useState(false);
  const [savedId, setSavedId] = useState(app && !app.published ? app.id : '');
  const [shareTarget, setShareTarget] = useState(state.scenario === 'konggu' ? 'events' : 'sales');
  const save = () => {
    if (!name.trim()) return;
    const id = change((s) => {
      let draft = s.apps.find((a) => a.id === savedId && !a.published);
      if (draft) Object.assign(draft, { name: name.trim(), description: description.trim(), hasDate });
      else {
        draft = {
          id: uid(),
          name: name.trim(),
          description: description.trim(),
          hasDate,
          space: 'personal',
          published: false,
        };
        s.apps.unshift(draft);
      }
      s.chats.find((c) => c.id === chatId)!.context = draft.id;
      addMessage(
        s.chats.find((c) => c.id === chatId)!,
        'assistant',
        `「${name.trim()}」已保存为个人应用草稿，可以打开试用，或申请共享给团队。`,
      );
      return draft.id;
    });
    setSavedId(id);
    ui.toast('应用草稿已保存');
    return id;
  };
  const request = () => {
    if (!name.trim()) return;
    ui.open({
      kind: 'confirm',
      title: '申请共享应用',
      text: `将保存「${name.trim()}」当前配置，并申请共享到${spaceName(state, shareTarget)}。只发布工具配置，个人草稿与试填记录保留。`,
      onConfirm: () => {
        const id = save();
        if (!id) return;
        change((s) => {
          const draft = s.apps.find((a) => a.id === id)!;
          const existing = s.requests.find(
            (r) =>
              r.kind === 'app' && r.sourceId === id && r.target === shareTarget && r.status === 'pending',
          );
          const fields = {
            appSnapshot: structuredClone(draft),
            title: draft.name,
            summary: draft.description,
          };
          if (existing) Object.assign(existing, fields);
          else
            s.requests.unshift({
              id: uid(),
              kind: 'app',
              sourceId: id,
              target: shareTarget,
              visibility: '空间成员',
              status: 'pending',
              ...fields,
            });
        });
        ui.toast('共享申请已进入工作台');
      },
    });
  };
  return (
    <div className="collaboration-card">
      <div className="card-heading">
        <span className="row">
          <LayoutGrid size={19} />
          <strong>一起搭建应用</strong>
        </span>
        <Badge>客户跟进模板</Badge>
      </div>
      {app?.published && <p className="subtle">调整先保留为个人副本，已有共享应用继续使用原配置。</p>}
      <Field label="应用名称">
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="一句话说明">
        <input value={description} maxLength={120} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="field-summary">
        <span>基础字段</span>
        <div>
          <Badge>客户</Badge>
          <Badge>跟进内容</Badge>
          <Badge>状态</Badge>
          <Badge>负责人</Badge>
        </div>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={hasDate} onChange={(e) => setHasDate(e.target.checked)} />
        <span>增加「下次跟进日期」字段</span>
      </label>
      {preview && (
        <div className="app-form-preview">
          <span className="eyebrow">表单预览</span>
          <h3>{name}</h3>
          <div className="form-grid">
            <Field label="客户">
              <input placeholder="例如：企业读书会咨询" />
            </Field>
            <Field label="状态">
              <select>
                <option>待跟进</option>
                <option>已联系</option>
                <option>已约定</option>
              </select>
            </Field>
          </div>
          <Field label="跟进内容">
            <textarea placeholder="记录沟通内容…" />
          </Field>
          {hasDate && (
            <Field label="下次跟进日期">
              <input type="date" />
            </Field>
          )}
          <small className="subtle">这里可以试填；保存草稿后进入应用添加正式演示记录。</small>
        </div>
      )}
      <Field label="共享目标空间">
        <select value={shareTarget} onChange={(e) => setShareTarget(e.target.value)}>
          {state.spaces.map((space) => (
            <option value={space.id} key={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="row wrap">
        <Button onClick={() => setPreview(!preview)}>{preview ? '收起预览' : '预览表单'}</Button>
        <Button variant="primary" disabled={!name.trim()} onClick={save}>
          保存个人草稿
        </Button>
        <Button disabled={!name.trim()} onClick={request}>
          申请共享
        </Button>
        {savedId && (
          <Button variant="ghost" onClick={() => ui.go(`apps/personal/${savedId}`)}>
            打开应用
            <ArrowUpRight size={14} />
          </Button>
        )}
      </div>
    </div>
  );
}
