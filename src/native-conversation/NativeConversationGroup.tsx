import { Plus } from 'lucide-react';
import type { NativeConversation } from '../../contracts/public-api/native-conversations';
import type { Workspace } from '../../contracts/public-api/identity';
import { useNativeAvailability, useNativeSessions, nativeHref } from './useNativeConversations';
import { nativeSessionTitle } from './labels';
import './native-conversation.css';

/**
 * Native sessions for the conversation list. They appear only when the deployment enables the
 * native runtime, and sit in the same space groups as the other conversations. The server decides
 * what is listed; nothing here checks access.
 */
export function useNativeList(tenant: string, workspaces: Workspace[], revision?: number) {
  const enabled = useNativeAvailability(tenant);
  const sessions = useNativeSessions(
    tenant,
    workspaces.map((w) => w.id),
    enabled,
    revision,
  );
  return { enabled, items: sessions.items, error: !!sessions.error };
}

export function NativeNewLink({ tenant, hash }: { tenant: string; hash: string }) {
  const selected = new URLSearchParams(hash.slice(1)).get('native') === 'new';
  return (
    <a
      className={`native-new-link ${selected ? 'selected' : ''}`}
      href={nativeHref(tenant, 'new')}
      aria-current={selected ? 'page' : undefined}
    >
      <Plus size={14} aria-hidden="true" />
      新建原生会话
    </a>
  );
}

export function NativeRows({
  tenant,
  hash,
  items,
  titles,
}: {
  tenant: string;
  hash: string;
  items: NativeConversation[];
  titles: Map<string, string>;
}) {
  const selected = new URLSearchParams(hash.slice(1)).get('native');
  return (
    <>
      {items.map((s) => {
        const title = nativeSessionTitle(s, titles);
        return (
          <div className="live-conversation-row" key={s.id}>
            <a
              className={selected === s.id ? 'selected' : ''}
              href={nativeHref(tenant, s.id)}
              aria-current={selected === s.id ? 'page' : undefined}
            >
              <span className="conversation-list-title" title={title}>
                {title}
              </span>
              {s.state === 'STOPPED' && <small className="native-row-meta">已停止</small>}
            </a>
          </div>
        );
      })}
    </>
  );
}
