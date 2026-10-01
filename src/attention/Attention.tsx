import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ListTodo, RefreshCw } from 'lucide-react';
import type { AttentionItem } from '../../contracts/public-api/attention';
import { useSession } from '../identity/session';
import { Button, Badge } from '../shared/ui';
import { Failure, Loading, Pager, useRemote } from '../shared/admin';
import { getAttention } from './client';
import { previewCapacity, type AttentionDisplay } from './layout';
import './attention.css';
const labels = {
  WAITING_INPUT: '需要补充',
  PARTIAL: '部分完成',
  RESULT_UNKNOWN: '结果待核对',
  OVERDUE: '待更新',
  MISSING_DATA: '资料缺口',
  AUTHORIZATION_REQUIRED: '需要重新授权',
  PLAN_NEEDS_ATTENTION: '计划待处理',
};
export function attentionHref(tenant: string, item: AttentionItem) {
  return (
    '/workspace/#' +
    new URLSearchParams({
      tenant,
      view: item.kind === 'TASK' ? 'conversations' : item.kind === 'PLAN' ? 'plans' : 'library',
      ...(item.kind === 'TASK'
        ? { conversation: item.conversationId!, task: item.id }
        : item.kind === 'PLAN'
          ? { plan: item.id }
          : { scope: item.workspaceId, source: item.id }),
    })
  );
}
export function Attention({
  tenant,
  managed = false,
  refreshToken,
}: {
  tenant: string;
  managed?: boolean;
  refreshToken?: number;
}) {
  const { session } = useSession();
  const key = `attention-display:${session.identity?.account.id}:${tenant}:${managed}`;
  const [display, setDisplay] = useState<AttentionDisplay>(() => {
    try {
      const v = localStorage.getItem(key);
      return v === 'expanded' || v === 'collapsed' ? v : 'preview';
    } catch {
      return 'preview';
    }
  });
  const [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0),
    [capacity, setCapacity] = useState(2);
  const container = useRef<HTMLDivElement>(null);
  const refresh = () => setAttempt((n) => n + 1);
  const data = useRemote(
    (signal) => getAttention(tenant, managed, display === 'expanded' ? page * 50 : 0, signal),
    [tenant, managed, page, display, attempt, refreshToken, session.identity],
  );
  useEffect(() => {
    const f = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const timer = setInterval(f, 30000);
    window.addEventListener('focus', f);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', f);
    };
  }, []);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(([e]) => setCapacity(previewCapacity(e.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const choose = (value: AttentionDisplay) => {
    setDisplay(value);
    setPage(0);
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Display preference is optional. */
    }
  };
  const shown =
    display === 'collapsed'
      ? []
      : display === 'preview'
        ? data.value?.items.slice(0, capacity)
        : data.value?.items;
  return (
    <section className="attention" aria-label={managed ? '获权维护待办' : '我的待办'} ref={container}>
      <header className="attention-header">
        <div>
          <ListTodo size={20} />
          <h2>{managed ? '维护待办' : '待办'}</h2>
          {data.value && <Badge>{data.value.total}</Badge>}
        </div>
        <div className="attention-controls">
          {display !== 'expanded' && (
            <Button icon={ChevronDown} onClick={() => choose('expanded')}>
              完全展开
            </Button>
          )}
          {display === 'expanded' && <Button onClick={() => choose('preview')}>两排概览</Button>}
          {display !== 'collapsed' && (
            <Button icon={ChevronUp} onClick={() => choose('collapsed')}>
              完全收起
            </Button>
          )}
          {managed && (
            <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
              刷新待办
            </Button>
          )}
        </div>
      </header>
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : (
        display !== 'collapsed' && (
          <>
            {data.value.total === 0 ? (
              <p className="attention-empty">当前没有需要你处理的事项。</p>
            ) : (
              <div
                className="attention-grid"
                style={{ gridTemplateColumns: `repeat(${capacity / 2}, minmax(0, 1fr))` }}
              >
                {shown?.map((item) => (
                  <article className="attention-card" key={item.kind + item.id}>
                    <div>
                      <Badge>{labels[item.state]}</Badge>
                      <span>{item.workspaceName}</span>
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.instruction}</p>
                    {item.dueAt && (
                      <small>约定更新时间：{new Date(item.dueAt).toLocaleString('zh-CN')}</small>
                    )}
                    <a className="button" href={attentionHref(tenant, item)}>
                      {item.actionLabel}
                    </a>
                  </article>
                ))}
              </div>
            )}
            {display === 'preview' && data.value.total > capacity && (
              <p className="attention-empty">还有 {data.value.total - capacity} 项，完全展开后可查看。</p>
            )}
            {display === 'expanded' && data.value.total > 50 && (
              <Pager page={page} next={data.value.hasMore} onPage={setPage} />
            )}
          </>
        )
      )}
    </section>
  );
}
