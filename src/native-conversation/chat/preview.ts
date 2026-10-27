import type { NativeEvent } from './events.ts';
import { syntheticChildEvents, syntheticNativeEvents, syntheticWorkEvents } from './fixture.ts';
import type { NativeFeed } from './useNativeFeed';

/**
 * Development-only preview: synthetic events plus local echoes of each action, so every card and
 * control can be tried before the platform relay exists. Nothing here reaches a server.
 */
export function previewFeed(publish: (feed: NativeFeed) => void) {
  const base = syntheticNativeEvents();
  let events: NativeEvent[] = [...base, ...syntheticWorkEvents(base.at(-1)!.seq)];
  const childEvents = syntheticChildEvents(events.at(-1)!.seq);
  let seq = childEvents.at(-1)!.seq;
  const push = (...items: [string, unknown][]) => {
    events = [...events, ...items.map(([type, data]) => ({ type, seq: ++seq, time: Date.now(), data }))];
    emit();
  };
  const running = () => {
    let open = false;
    for (const e of events) {
      if (e.type === 'turn/start') open = true;
      if (e.type === 'turn/end') open = false;
    }
    return open;
  };
  const turn = () => events.filter((e) => e.type === 'turn/start').length;
  const emit = () =>
    publish({
      events,
      childEvents,
      preview: true,
      skills: [
        { name: '月度对账', description: '按门店核对收款与账单差异' },
        { name: '经营周报', description: '汇总本周营业额、客单与同比' },
        { name: '合同要点', description: '提取合同金额、期限与违约条款' },
      ],
      status: { running: running(), budget: { usedYuan: 0.42, softYuan: 2, hardYuan: 5, elapsedMinutes: 9 } },
      actions: {
        async send(text, materials = []) {
          const next = turn() + 1;
          // Same note the runtime appends for referenced materials (engine/scripts/native-sdk-runtime.mjs).
          const full =
            text +
            (materials.length
              ? '\n\n用户引用的企业资料（须经 enterprise_read/search 按当前权限读取）：\n' +
                materials
                  .map((m) => JSON.stringify({ materialId: m.materialId, versionId: m.versionId }))
                  .join('\n')
              : '');
          push(
            ['turn/start', { turn: next }],
            [
              'user/message',
              { id: `pu${seq}`, source: { kind: 'user' }, content: [{ type: 'text', text: full }] },
            ],
            [
              'assistant/message',
              {
                turn: next,
                step: 1,
                stream: [],
                message: {
                  id: `pa${seq}`,
                  source: { kind: 'model' },
                  content: [{ type: 'text', text: '（预览）运行环境接通后，这里会显示 AI 的真实回复。' }],
                },
              },
            ],
            ['turn/end', { turn: next, reason: { kind: 'completed' } }],
          );
        },
        async stop() {
          if (running()) push(['turn/end', { turn: turn(), reason: { kind: 'aborted' } }]);
        },
        async decide(id, allow) {
          push(['approval/decided', { id, outcome: allow ? 'allowed-once' : 'rejected' }]);
        },
        async answer(callId, answers) {
          const text = answers
            .map((a) => [...a.selected, a.custom].filter(Boolean).join('、') || '跳过')
            .join('；');
          push([
            'tool/result',
            { message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text }] } },
          ]);
        },
        async review(callId, approve, comment) {
          await this.answer?.(callId, [
            { id: 'plan', selected: approve ? ['按计划执行'] : [], custom: comment },
          ]);
        },
        async feedback() {
          /* preview only */
        },
      },
    });
  emit();
}
