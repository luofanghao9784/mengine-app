import type { NativeConversation } from '../../contracts/public-api/native-conversations';

const time = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** A native session has no title of its own yet: name it by what it continues, or by when it began. */
export function nativeSessionTitle(session: NativeConversation, titles: Map<string, string>) {
  if (session.legacyConversationId) {
    const old = titles.get(session.legacyConversationId);
    return old ? `接续：${old}` : '接续旧会话';
  }
  const at = Date.parse(session.createdAt);
  return Number.isFinite(at) ? `原生会话 · ${time.format(at)}` : '原生会话';
}
