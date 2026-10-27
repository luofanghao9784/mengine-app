import type { NativeEvent } from './events.ts';

/**
 * Synthetic DH event log for tests and the development preview. Shapes follow DH 0.2.1; content
 * is invented for illustration and never shown in production builds.
 */
export function syntheticNativeEvents(start = Date.UTC(2026, 9, 27, 1, 0, 0)): NativeEvent[] {
  let seq = 0;
  const at = (minutes: number) => start + minutes * 60_000;
  const e = (type: string, minutes: number, data: unknown): NativeEvent => ({
    type,
    seq: ++seq,
    time: at(minutes),
    data,
  });
  const user = (id: string, text: string) => ({
    id,
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text }],
  });
  const assistant = (id: string, text: string, reasoning = '') => ({
    id,
    role: 'assistant',
    source: { kind: 'model' },
    content: [
      ...(reasoning ? [{ type: 'reasoning', text: reasoning }] : []),
      ...(text ? [{ type: 'text', text }] : []),
    ],
  });
  const result = (callId: string, text: string) => ({
    message: {
      id: `r-${callId}`,
      role: 'tool',
      source: { kind: 'tool' },
      toolCallId: callId,
      content: [{ type: 'text', text }],
    },
  });
  return [
    e('session/title', 0, { title: '荔星中心店十月收款复核' }),
    e('turn/start', 0, { turn: 1 }),
    e(
      'user/message',
      0,
      user('u1', '帮我复核荔星中心店十月的收款记录，列出还没确认的几笔，并整理成一份给店长的说明。'),
    ),
    e('step/start', 0, { turn: 1, step: 1 }),
    e('assistant/message', 1, {
      turn: 1,
      step: 1,
      stream: [],
      message: assistant(
        'a1',
        '我先在企业资料里找荔星中心店十月的收款记录和财务确认情况。',
        '需要先定位收款明细和财务确认口径，再比对差异。',
      ),
    }),
    e('tool/call', 1, {
      turn: 1,
      step: 1,
      callId: 'c1',
      name: 'enterprise_search',
      arguments: '{"query":"荔星中心店 10月 收款 财务确认"}',
    }),
    e('tool/result', 1, {
      turn: 1,
      step: 1,
      ...result('c1', '找到 3 份资料：荔星中心店收款明细（10月）、财务确认台账、门店对账说明。'),
    }),
    e('tool/call', 2, {
      turn: 1,
      step: 1,
      callId: 'c2',
      name: 'enterprise_read',
      arguments: '{"materialId":"m-1","versionId":"v-3"}',
    }),
    e('tool/result', 2, {
      turn: 1,
      step: 1,
      ...result('c2', '已读取到工作目录：荔星中心店收款明细（10月）.xlsx'),
    }),
    e('step/end', 3, { turn: 1, step: 1 }),
    e('step/start', 3, { turn: 1, step: 2 }),
    e('assistant/message', 4, {
      turn: 1,
      step: 2,
      stream: [],
      message: assistant(
        'a2',
        '十月共 45 笔收款，其中 41 笔财务已确认，3 笔已上传凭证待复核，1 笔缺凭证。说明文档已整理好，放在下面的成果文件里。',
      ),
    }),
    e('tool/call', 4, {
      turn: 1,
      step: 2,
      callId: 'c3',
      name: 'present',
      arguments: '{"files":[{"path":"荔星十月收款说明.md"}]}',
    }),
    e('deliverables/presented', 4, {
      turn: 1,
      callId: 'c3',
      files: [{ path: '荔星十月收款说明.md', description: '给店长的收款复核说明' }],
    }),
    e('tool/result', 4, { turn: 1, step: 2, ...result('c3', '已交付 1 个文件') }),
    e('step/end', 5, { turn: 1, step: 2 }),
    e('turn/end', 5, { turn: 1, reason: { kind: 'completed' } }),
    e('turn/start', 8, { turn: 2 }),
    e('user/message', 8, user('u2', '把说明保存到我的私人成果，再看看缺凭证那笔该找谁补。')),
    e('step/start', 8, { turn: 2, step: 1 }),
    e('assistant/message', 9, {
      turn: 2,
      step: 1,
      stream: [],
      message: assistant('a3', '保存说明需要写入文件，我先请你确认。'),
    }),
    e('tool/call', 9, {
      turn: 2,
      step: 1,
      callId: 'c4',
      name: 'enterprise_save',
      arguments: '{"filename":"荔星十月收款说明.md"}',
    }),
    e('approval/asked', 9, {
      id: 'ap1',
      toolName: 'enterprise_save',
      callId: 'c4',
      reason: '把“荔星十月收款说明.md”保存为你的私人成果',
    }),
    e('tool/call', 9, {
      turn: 2,
      step: 1,
      callId: 'c5',
      name: 'ask_user_question',
      arguments: JSON.stringify({
        questions: [
          {
            id: 'q1',
            header: '补凭证',
            question: '缺凭证的那笔（10月19日，800 元）由谁负责补充？',
            options: [
              { label: '郑西', description: '财务核对负责人' },
              { label: '店长', description: '门店收款负责人' },
            ],
          },
        ],
      }),
    }),
  ];
}

/** Synthetic long-task progress (batch two): goal, to-dos, background job, sub-task, workflow, plan review. */
export function syntheticWorkEvents(
  afterSeq: number,
  start = Date.UTC(2026, 9, 27, 1, 10, 0),
): NativeEvent[] {
  let seq = afterSeq;
  const e = (type: string, minutes: number, data: unknown): NativeEvent => ({
    type,
    seq: ++seq,
    time: start + minutes * 60_000,
    data,
  });
  return [
    e('goal/change', 0, {
      kind: 'goal/change',
      version: 1,
      operation: 'create',
      roundsStarted: 1,
      goal: { objective: '十月底前把荔星中心店的收款差异全部核清', phase: 'active', maxGoalRounds: 8 },
    }),
    e('todo/write', 0, {
      todos: [
        { content: '核对 3 笔已上传凭证的收款', status: 'completed' },
        { content: '联系郑西补齐 10月19日 800 元的凭证', status: 'in_progress' },
        { content: '整理给店长的最终说明', status: 'pending' },
      ],
    }),
    e('job/registered', 1, {
      jobId: 'job-1',
      owner: 's1',
      kind: 'bash',
      label: '汇总十月收款明细表',
      startedAt: start + 60_000,
    }),
    e('job/settled', 3, {
      jobId: 'job-1',
      owner: 's1',
      kind: 'bash',
      label: '汇总十月收款明细表',
      startedAt: start + 60_000,
      finishedAt: start + 180_000,
      status: 'completed',
      cause: 'exit',
      producerReported: true,
    }),
    e('job/registered', 4, {
      jobId: 'job-2',
      owner: 's1',
      kind: 'bash',
      label: '比对财务确认台账',
      startedAt: start + 240_000,
    }),
    e('subagent/catalog', 4, {
      childId: 'child-1',
      childCreatedAt: start + 240_000,
      version: 1,
      mode: 'continuable',
      label: '凭证核对助手',
    }),
    e('tool-workflow/run-start', 5, { runId: 'wf-1', name: '五店收款对账' }),
    e('tool-workflow/agent-start', 5, { runId: 'wf-1', seq: 1, label: '梵华里店', phase: '对账' }),
    e('tool-workflow/agent-end', 6, { runId: 'wf-1', seq: 1, outcome: 'completed' }),
    e('tool-workflow/agent-start', 6, { runId: 'wf-1', seq: 2, label: '荔星中心店', phase: '对账' }),
    e('plan/mode', 7, { active: true }),
    e('tool/call', 7, {
      turn: 2,
      step: 2,
      callId: 'plan-1',
      name: 'ask_user_question',
      arguments: JSON.stringify({
        questions: [
          {
            id: 'plan',
            header: '计划审阅',
            question:
              '计划：1. 先补齐缺失凭证；2. 再请财务复核 3 笔待确认收款；3. 最后更新给店长的说明。是否按此执行？',
            options: [{ label: '按计划执行' }, { label: '需要修改' }],
            intent: { kind: 'plan-review', approve: '按计划执行', callId: 'plan-1' },
          },
        ],
      }),
    }),
  ];
}
