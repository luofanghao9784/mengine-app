import { useState } from 'react';
import type { LiveTask, ConversationTask } from '../../contracts/public-api/conversation';
import { DocumentText, Button } from '../shared/ui';
import { liveClient } from './realtime-client';
import { useSubmission, SubmitError } from '../shared/admin';
const tools: Record<string, string> = {
  search_sources: '检索资料',
  compare_table: '计算表格',
  deliver_briefing: '生成画报',
  task_context: '读取工作上下文',
  find_skills: '查找可用能力',
  activate_skill: '准备工作能力',
  public_search: '查找公开资料',
  read_public_page: '阅读网页',
  task_control: '记录任务状态',
  ask_user: '确认问题',
  task_preference: '更新偏好',
  manage_plan: '维护计划',
  task_plan: '处理计划',
  list_originals: '查看资料',
  read_original: '读取原件',
  process_original: '处理原件',
};
export function LiveProcess({
  live,
  task,
  tenant,
  conversation,
  changed,
}: {
  live: LiveTask;
  task: ConversationTask;
  tenant: string;
  conversation: string;
  changed: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const working = ['RUNNING', 'QUEUED'].includes(task.status);
  const latest = live.outputs.at(-1);
  const current = live.tools.find((t) => t.status === 'STARTED');
  return (
    <section className="conversation-process" aria-label="任务进展">
      <button
        type="button"
        className="process-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {working
          ? live.stopping
            ? '正在停止…'
            : current
              ? `${tools[current.name] || '执行工具'}…`
              : '正在处理…'
          : '查看处理过程'}{' '}
        <span>{expanded ? '收起' : '展开'}</span>
      </button>
      {expanded && (
        <div className="process-history">
          {live.tools.map((t) => (
            <p key={t.sequence}>
              {tools[t.name] || '执行工具'} ·{' '}
              {t.status === 'STARTED'
                ? working
                  ? '进行中'
                  : '结果未确认'
                : t.status === 'succeeded'
                  ? '已完成'
                  : '未完成'}
            </p>
          ))}
          {live.outputs
            .filter((o) => o !== latest || !!task.reply)
            .map((o) => (
              <div key={o.step}>
                <small>过程说明</small>
                <DocumentText text={o.text} />
              </div>
            ))}
        </div>
      )}
      {live.inputs.map((i) => (
        <div className="process-input" key={i.id}>
          <p>{i.text}</p>
          <small>
            {i.applied
              ? '已采用'
              : working && (i.attempt === undefined || i.attempt === live.attempt || i.resumeAnswer)
                ? '已收到，等待采用'
                : '本次未采用'}
          </small>
        </div>
      ))}
      {!task.reply && latest?.text && (
        <div className="conversation-reply">
          <DocumentText text={latest.text} />
          <small>{working ? '正在输出…' : '未完成的回复'}</small>
        </div>
      )}
      {live.questions.map((q) => (
        <QuestionCard
          key={q.id}
          question={q}
          live={live}
          tenant={tenant}
          conversation={conversation}
          changed={changed}
        />
      ))}
    </section>
  );
}
function QuestionCard({
  question: q,
  live,
  tenant,
  conversation,
  changed,
}: {
  question: LiveTask['questions'][number];
  live: LiveTask;
  tenant: string;
  conversation: string;
  changed: () => void;
}) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const submit = useSubmission<{ attempt: number; text: string; questionId: string }>();
  const active =
    !q.answered &&
    !sent &&
    (q.blocking ? live.status === 'WAITING_INPUT' : live.status === 'RUNNING') &&
    !live.stopping;
  return (
    <form
      className="conversation-question"
      onSubmit={(e) => {
        e.preventDefault();
        if (!active || !text.trim()) return;
        void submit.submit(
          { attempt: live.attempt, text: text.trim(), questionId: q.id },
          async (body, requestId) => {
            await liveClient.input(tenant, conversation, live.taskId, { ...body, requestId });
            setSent(true);
            changed();
          },
        );
      }}
    >
      <strong>{q.text}</strong>
      <small>
        {q.answered || sent
          ? '回答已收到'
          : !active
            ? q.blocking && live.status === 'RUNNING'
              ? '正在保存问题…'
              : '问题已结束'
            : q.blocking
              ? '等待你的回答后继续'
              : '其余工作继续'}
      </small>
      {active && (
        <>
          <div>
            {q.options.map((option) => (
              <Button
                key={option}
                disabled={submit.busy || submit.uncertain}
                aria-pressed={text === option}
                onClick={() => setText(option)}
              >
                {option}
              </Button>
            ))}
          </div>
          <textarea
            aria-label="回答 AI 的问题"
            maxLength={2000}
            value={text}
            disabled={submit.busy || submit.uncertain}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" disabled={!text.trim() || submit.busy}>
            {submit.uncertain ? '重试提交答案' : '提交答案'}
          </Button>
        </>
      )}
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
    </form>
  );
}
