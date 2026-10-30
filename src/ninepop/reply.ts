import { addMessage, type DemoState, type Chat, latest } from '../model.ts';
import { canReadMaterial } from '../libraryModel.ts';

// Source retrieval over the fixed package, never presented as a fresh model or production call.
export function replyNinepop(state: DemoState, chat: Chat, text: string) {
  const snapshot = chat.briefingContext?.snapshot;
  const ids = snapshot?.refs || chat.messages.findLast((m) => m.refs?.length)?.refs || [];
  const readable = state.materials.filter((d) => canReadMaterial(state, d));
  const byId = new Map(readable.map((d) => [d.id, d]));
  // Preserve the card's evidence order: authored analysis first, source extracts next.
  let docs = [...new Set(ids)].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  if (!docs.length) {
    const tokens = text.match(/[\p{Script=Han}]{2,}|[A-Za-z0-9]+/gu) || [];
    const keys = [
      '收款',
      '复核',
      '资金',
      '课债',
      '续费',
      '体验',
      '会员',
      '课时',
      '活动',
      '消费券',
      '手册',
      '制度',
      '门店',
    ].filter((k) => text.includes(k));
    docs = readable
      .filter((d) => [...keys, ...tokens].some((k) => d.title.includes(k)))
      .sort(
        (a, b) =>
          Number(b.type === '分析' || b.type === '成果') - Number(a.type === '分析' || a.type === '成果'),
      )
      .slice(0, 3);
  }
  const header = '固定快照资料检索 · 未调用实时模型或9POP接口。\n';
  const answer = docs.length
    ? docs
        .slice(0, 3)
        .map((d) => `「${d.title}」\n${latest(d).content.slice(0, 5000)}`)
        .join('\n\n')
    : '资料包中未找到足够依据。可以从画报卡片发起会话，或选择对应资料继续核对；新问题的实时分析需在梦擎引擎接入后进行。';
  addMessage(
    chat,
    'assistant',
    header + '\n' + answer,
    undefined,
    docs.slice(0, 3).map((d) => d.id),
  );
}
