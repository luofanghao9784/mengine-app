import { useEffect, useState } from 'react';
import { Eye, EyeOff, MessageSquare, Newspaper, Pin, RefreshCw, Expand, Minimize } from 'lucide-react';
import type { BriefingCard, BriefingView, BriefingPreference } from '../../contracts/public-api/briefing';
import { identityClient, useSession } from '../identity/session';
import { Button, Badge, Empty, Field, PageActions } from '../shared/ui';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { conversationHref } from '../conversation/Conversations';
import { briefingClient as api } from './client';
import './briefing.css';

export const briefingHref = (tenant: string) => '#' + new URLSearchParams({ tenant, view: 'briefing' });
export function LiveBriefing({ tenant }: { tenant: string }) {
  const { session } = useSession();
  const [view, setView] = useState<BriefingView>('LATEST');
  const [date, setDate] = useState(''),
    [space, setSpace] = useState('');
  const [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const refresh = () => setAttempt((n) => n + 1);
  const context = useRemote(
    (signal) => identityClient.context(tenant, signal),
    [tenant, session.identity, attempt],
  );
  const feed = useRemote(
    (signal) =>
      api.list(
        tenant,
        { view, date: date || null, zone, ...(space ? { workspaceId: space } : {}) },
        page * 20,
        signal,
      ),
    [tenant, view, date, zone, space, page, session.identity, attempt],
  );
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'visible') setAttempt((n) => n + 1);
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  const groups = new Map<string, BriefingCard[]>();
  for (const card of feed.value?.items || []) {
    const day = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: zone,
    }).format(new Date(card.completedAt));
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(card);
  }
  return (
    <>
      <PageActions>
        <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
          刷新
        </Button>
      </PageActions>
      <section className="live-briefing">
        <p className="muted">汇集你已完成的会话成果，仅自己可见。点击卡片继续原会话。</p>
        <div className="live-briefing-filters">
          <Field label="画报视图">
            <select
              aria-label="画报视图"
              value={view}
              onChange={(e) => {
                setView(e.target.value as BriefingView);
                setPage(0);
              }}
            >
              <option value="LATEST">最新</option>
              <option value="FOCUSED">关注</option>
              <option value="HIDDEN">已隐藏</option>
            </select>
          </Field>
          <Field label="工作空间">
            <select
              aria-label="工作空间"
              value={space}
              onChange={(e) => {
                setSpace(e.target.value);
                setPage(0);
              }}
            >
              <option value="">全部可访问空间</option>
              {context.value?.workspaces.map((w) => (
                <option value={w.id} key={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="查看日期">
            <input
              type="date"
              aria-label="查看日期"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setPage(0);
              }}
            />
          </Field>
          {date && (
            <Button
              variant="ghost"
              onClick={() => {
                setDate('');
                setPage(0);
              }}
            >
              回到最新
            </Button>
          )}
        </div>
        {feed.error || context.error ? (
          <Failure error={feed.error || context.error} retry={refresh} />
        ) : !feed.value || !context.value ? (
          <Loading />
        ) : (
          <>
            {!feed.value.items.length && (
              <Empty
                icon={Newspaper}
                title={
                  view === 'HIDDEN'
                    ? '没有隐藏的卡片'
                    : view === 'FOCUSED'
                      ? '还没有关注的卡片'
                      : '暂时没有会话成果'
                }
                text={
                  date
                    ? '这一天没有符合当前范围的已完成回复。可切换日期或空间。'
                    : '完成的会话回复会在这里汇集；关注、隐藏只改变自己的画报。'
                }
              >
                <a className="button" href={conversationHref(tenant)}>
                  进入会话
                </a>
              </Empty>
            )}
            {[...groups].map(([day, cards]) => (
              <section className="live-briefing-day" key={day}>
                <h2>{day}</h2>
                <div className="live-briefing-grid">
                  {cards.map((card) => (
                    <Card
                      key={card.conversationId}
                      tenant={tenant}
                      card={card}
                      historical={!!date}
                      changed={refresh}
                    />
                  ))}
                </div>
              </section>
            ))}
            {feed.value.items.length > 0 && <Pager page={page} next={feed.value.hasMore} onPage={setPage} />}
          </>
        )}
      </section>
    </>
  );
}
function Card({
  tenant,
  card,
  historical,
  changed,
}: {
  tenant: string;
  card: BriefingCard;
  historical: boolean;
  changed: () => void;
}) {
  const submission = useSubmission<Omit<BriefingPreference, 'revision'> & { expectedRevision: number }>();
  const edit = (change: Partial<Omit<BriefingPreference, 'revision'>>) =>
    void submission.submit(
      {
        expectedRevision: card.preference.revision,
        pinned: card.preference.pinned,
        hidden: card.preference.hidden,
        size: card.preference.size,
        ...change,
      },
      async (body, requestId) => {
        await api.update(tenant, card.conversationId, { ...body, requestId });
        changed();
      },
    );
  const href =
    conversationHref(tenant, card.conversationId) +
    (historical ? '&task=' + encodeURIComponent(card.taskId) : '');
  return (
    <article
      className={'live-briefing-card ' + (card.preference.size === 'WIDE' ? 'wide' : '')}
      aria-label={'会话成果：' + card.title}
    >
      <a className="live-briefing-body" href={href}>
        <div className="live-briefing-meta">
          <span>{card.workspaceName}</span>
          <time dateTime={card.completedAt}>
            {new Date(card.completedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </time>
        </div>
        <h3>{card.title}</h3>
        <p className="live-briefing-excerpt">
          {card.excerpt}
          {card.truncated ? '…' : ''}
        </p>
        <div className="live-briefing-meta">
          <span>
            {card.artifactCount} 份成果 · {card.citationCount} 处引用 · {card.originalCount} 份原件
          </span>
          <MessageSquare size={16} />
        </div>
        {card.executionClass === 'verification' && <Badge>联调验证 · 未调用真实模型</Badge>}
      </a>
      <div className="live-briefing-controls">
        <Button
          variant="ghost"
          icon={Pin}
          aria-pressed={card.preference.pinned}
          disabled={submission.busy}
          onClick={() => edit({ pinned: !card.preference.pinned })}
        >
          {card.preference.pinned ? '取消关注' : '关注'}
        </Button>
        <Button
          variant="ghost"
          icon={card.preference.hidden ? Eye : EyeOff}
          disabled={submission.busy}
          onClick={() => edit({ hidden: !card.preference.hidden })}
        >
          {card.preference.hidden ? '恢复显示' : '隐藏'}
        </Button>
        <Button
          variant="ghost"
          icon={card.preference.size === 'WIDE' ? Minimize : Expand}
          disabled={submission.busy}
          onClick={() => edit({ size: card.preference.size === 'WIDE' ? 'STANDARD' : 'WIDE' })}
        >
          {card.preference.size === 'WIDE' ? '标准卡片' : '加宽卡片'}
        </Button>
      </div>
      <SubmitError error={submission.error} uncertain={submission.uncertain} />
    </article>
  );
}
