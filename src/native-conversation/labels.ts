import type { NativeConversation } from '../../contracts/public-api/native-conversations';

const time = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Until the platform lists session titles (B8), name a session by what it continues, or by when
 * it began. Opening it shows the title the AI gave it.
 */
export function nativeSessionTitle(session: NativeConversation, titles: Map<string, string>) {
  if (session.legacyConversationId) {
    const old = titles.get(session.legacyConversationId);
    return old ? `接续：${old}` : '接续旧会话';
  }
  const at = Date.parse(session.createdAt);
  return Number.isFinite(at) ? `新会话 · ${time.format(at)}` : '新会话';
}
