import {
  ArrowUpRight,
  FileText,
  MessageSquare,
  Plus,
  Users,
  Folder,
  LayoutGrid,
  ChartNoAxesCombined,
  Sparkles,
  Settings2,
} from 'lucide-react';
import { useDemo, useUI } from '../store';
import { latest, spaceName } from '../model';
import { Badge, Button, Empty, PageActions, SectionHeading } from '../components/ui';
import { workspaceKind } from '../workspaceExamples';
export function Workspace({ spaceId }: { spaceId: string }) {
  const { state } = useDemo();
  const ui = useUI();
  const space = state.spaces.find((s) => s.id === spaceId);
  if (!space) return <Empty icon={Folder} title="这个空间暂不可用" text="请选择左侧的工作空间。" />;
  const docs = state.materials.filter((d) => d.space === spaceId);
  const chats = state.chats.filter((c) => c.space === spaceId && !c.archived);
  return (
    <div className="page-container">
      <PageActions>
        <Button icon={Users} onClick={() => ui.open({ kind: 'members', id: spaceId })}>
          成员 · {space.members.length}
        </Button>
        {space.canEdit && (
          <Button icon={Settings2} onClick={() => ui.open({ kind: 'space', id: spaceId })}>
            空间设置
          </Button>
        )}
        <Button variant="primary" icon={Plus} onClick={() => ui.go(`home/${spaceId}`)}>
          发起工作
        </Button>
      </PageActions>
      {workspaceKind(space) === 'project' && space.project && (
        <section className="project-overview" aria-label="项目目标与计划">
          <div className="project-goal">
            <span>项目目标</span>
            <p>{space.project.goal}</p>
          </div>
          <div>
            <span>当前阶段</span>
            <strong>{space.project.phase}</strong>
          </div>
          <div>
            <span>计划交付</span>
            <strong>{space.project.targetDate}</strong>
          </div>
        </section>
      )}
      <div className="space-intro">
        <div>
          <span className="row subtle">
            <Sparkles size={16} />
            空间工作说明
          </span>
          <p>{space.instructions}</p>
        </div>
        <Badge>{space.canEdit ? '可维护资料' : '可查看与引用'}</Badge>
      </div>
      <div className="space-shortcuts">
        {[
          { icon: Folder, label: '空间资料', sub: `${docs.length} 份资料与成果`, path: 'library' },
          {
            icon: ChartNoAxesCombined,
            label: '空间画报',
            sub: '查看业务进展与数据',
            path: 'briefing',
          },
          {
            icon: LayoutGrid,
            label: '空间应用',
            sub: `${state.apps.filter((a) => a.space === spaceId).length} 个可用工具`,
            path: 'apps',
          },
        ].map((x) => (
          <button key={x.path} onClick={() => ui.go(`${x.path}/${spaceId}`)}>
            <span className="shortcut-icon">
              <x.icon size={21} />
            </span>
            <span>
              <strong>{x.label}</strong>
              <small>{x.sub}</small>
            </span>
            <ArrowUpRight size={17} />
          </button>
        ))}
      </div>
      <div className="two-column">
        <section>
          <SectionHeading title="继续空间里的工作" />
          {chats.length ? (
            chats.slice(0, 5).map((c) => (
              <button
                className="list-card"
                key={c.id}
                onClick={() => {
                  ui.preview(c.messages.findLast((m) => m.doc)?.doc || null);
                  ui.go(`chat/${c.id}`);
                }}
              >
                <MessageSquare size={18} />
                <span className="grow">
                  <strong>{c.title}</strong>
                  <small>{c.messages.at(-1)?.text.slice(0, 34) || '开始新工作'}</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))
          ) : (
            <div className="quiet-empty">还没有会话，可以从这里开始第一项工作。</div>
          )}
          <SectionHeading title="近期成果" action="全部资料" onAction={() => ui.go(`library/${spaceId}`)} />
          {docs.slice(0, 3).map((d) => (
            <button className="recent-row" key={d.id} onClick={() => ui.go(`library/${spaceId}/${d.id}`)}>
              <FileText size={18} />
              <span className="grow">
                {d.title}
                <small>
                  v{latest(d).number} · {d.status}
                </small>
              </span>
              <ArrowUpRight size={16} />
            </button>
          ))}
        </section>
        <section>
          <SectionHeading title="空间动态" />
          <ActivityList space={spaceId} />
          <div className="owner-note">
            <span className="avatar small">{space.owner[0]}</span>
            <p>
              空间负责人<strong>{space.owner}</strong>
            </p>
            <Button variant="ghost" onClick={() => ui.open({ kind: 'members', id: spaceId })}>
              查看成员
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
export function ActivityList({ space }: { space?: string }) {
  const { state } = useDemo();
  const ui = useUI();
  const items = state.activities.filter((a) => !space || a.space === space);
  return (
    <div className="activity-list">
      {items.length ? (
        items.slice(0, 6).map((a) => (
          <button
            key={a.id}
            onClick={() => ui.go(a.space === 'personal' ? 'library/personal' : `space/${a.space}`)}
          >
            <span className="activity-dot" />
            <span>
              {a.text}
              <small>
                {a.date} · {spaceName(state, a.space)}
              </small>
            </span>
          </button>
        ))
      ) : (
        <p className="subtle">这里将记录成员、AI 与系统的共同维护。</p>
      )}
    </div>
  );
}
