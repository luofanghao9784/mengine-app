import { Plus, Sparkles } from 'lucide-react';
import type { Workspace } from '../../contracts/public-api/identity';
import { useNativeAvailability, useNativeSessions, nativeHref } from './useNativeConversations';
import { nativeSessionTitle } from './labels';
import './native-conversation.css';

/**
 * 企业原生会话（试用）：只有部署开启了原生运行环境才出现，旧会话列表保持不变。
 * 列表与状态都来自服务端；这里不做任何权限判断。
 */
export function NativeConversationGroup({
  tenant,
  hash,
  workspaces,
  titles,
  revision,
}: {
  tenant: string;
  hash: string;
  workspaces: Workspace[];
  titles: Map<string, string>;
  revision?: number;
}) {
  const enabled = useNativeAvailability(tenant);
  const sessions = useNativeSessions(
    tenant,
    workspaces.map((w) => w.id),
    enabled,
    revision,
  );
  if (!enabled) return null;
  const selected = new URLSearchParams(hash.slice(1)).get('native');
  const spaceName = new Map(workspaces.map((w) => [w.id, w.kind === 'PERSONAL' ? '个人空间' : w.name]));
  return (
    <details className="live-conversation-group native-conversation-group" open>
      <summary>
        <Sparkles size={14} />
        企业原生会话
        <span className="native-badge">试用</span>
      </summary>
      <a
        className={`native-new-link ${selected === 'new' ? 'selected' : ''}`}
        href={nativeHref(tenant, 'new')}
        aria-current={selected === 'new' ? 'page' : undefined}
      >
        <Plus size={14} />
        <span>新建原生会话</span>
      </a>
      {sessions.error ? <p className="live-list-empty">原生会话列表暂时无法读取。</p> : null}
      {sessions.items.map((s) => (
        <a
          key={s.id}
          className={selected === s.id ? 'selected' : ''}
          href={nativeHref(tenant, s.id)}
          aria-current={selected === s.id ? 'page' : undefined}
        >
          <span className="conversation-list-title">{nativeSessionTitle(s, titles)}</span>
          <small className="native-row-meta">
            {spaceName.get(s.workspaceId) ?? '空间'} · {s.state === 'ACTIVE' ? '可继续' : '已停止'}
          </small>
        </a>
      ))}
    </details>
  );
}
