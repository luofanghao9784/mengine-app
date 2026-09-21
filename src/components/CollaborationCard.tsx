import { useEffect, useState } from 'react';
import { ArrowUpRight, Bot, Check, Clock3, FileText, History, ShieldCheck } from 'lucide-react';
import { useDemo, useUI } from '../store';
import {
  actOnCollaboration,
  capabilities,
  colleagueName,
  collaborationStatus,
  isCollaborationOpen,
  submitCollaboration,
  type Brief,
  type Collaboration,
  type CollaborationAction,
} from '../colleagues';
import { Badge, Button, DocumentText, Field } from './ui';

export function CollaborationCard({ request }: { request: Collaboration }) {
  const { state, change } = useDemo();
  const ui = useUI();
  const [receiver, setReceiver] = useState(ui.route.endsWith('/receiver'));
  const [brief, setBrief] = useState<Brief>(request.brief);
  const [feedback, setFeedback] = useState('请补充这份结果的具体用途，以及是否只需要销售业务范围。');
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(request.draftContent || '');
  useEffect(() => setBrief(request.brief), [request.brief.month, request.brief.scope, request.brief.purpose]);
  useEffect(() => setContent(request.draftContent || ''), [request.draftContent]);
  const name = colleagueName(state, request.colleagueId);
  const capability = capabilities.find((c) => c.id === request.capabilityId)!;
  const stopped = ['rejected', 'cancelled'].includes(request.status);
  const step = ['draft', 'changes_requested'].includes(request.status)
    ? 0
    : request.status === 'pending'
      ? 1
      : request.status === 'authorized'
        ? 2
        : 3;
  function action(value: CollaborationAction, confirm = false) {
    const perform = () => {
      const ok = change((s) =>
        actOnCollaboration(s, request.id, value, receiver ? 'receiver' : 'requester', feedback),
      );
      ui.toast(
        ok
          ? value === 'deliver'
            ? '已模拟确认交付，成果已送达原会话'
            : '协作状态已更新'
          : '状态已变化，请查看当前步骤',
      );
    };
    if (confirm)
      ui.open({
        kind: 'confirm',
        title:
          value === 'authorize'
            ? `模拟${name}授权本次工作`
            : value === 'deliver'
              ? `模拟${name}确认交付`
              : value === 'cancel'
                ? '取消本次协作'
                : `模拟${name}拒绝请求`,
        text:
          value === 'authorize'
            ? `授权处理「${capability.name}」第 ${request.revision} 版需求：${request.brief.month}，${request.brief.scope}，${request.brief.purpose}。仅限本次请求，不开放底层资料。`
            : value === 'deliver'
              ? `将已审阅的「${capability.output}」交付给${request.requester}，保存至其个人空间。此操作不会开放底层明细或私人记忆。`
              : value === 'cancel'
                ? '未交付的结果不会进入资料库，协作记录保留。'
                : `拒绝当前请求。说明：${feedback || '当前请求未获授权'}`,
        onConfirm: perform,
      });
    else perform();
  }
  return (
    <section className="collaboration-card colleague-collaboration" aria-label="同事协作需求">
      <div className="card-heading">
        <span className="row">
          <Bot size={20} />
          <strong>{capability.name}</strong>
        </span>
        <Badge blue={isCollaborationOpen(request)}>{collaborationStatus[request.status]}</Badge>
      </div>
      <p className="subtle">
        {request.requester} → {name}的智能体 · 需求版本 {request.revision}
      </p>
      <div className="collaboration-perspective">
        <span>演示视角</span>
        <div className="segmented">
          <button
            className={!receiver ? 'selected' : ''}
            aria-pressed={!receiver}
            onClick={() => setReceiver(false)}
          >
            我的请求
          </button>
          <button
            className={receiver ? 'selected' : ''}
            aria-pressed={receiver}
            onClick={() => setReceiver(true)}
          >
            {name}视角 · 演示
          </button>
        </div>
      </div>
      <ol className="collaboration-steps" aria-label="协作进度">
        {['准备需求', '同事授权', '生成结果', '确认交付'].map((label, i) => (
          <li key={label} className={!stopped && i <= step ? 'current' : ''}>
            <span>
              {!stopped && (request.status === 'delivered' || i < step) ? <Check size={12} /> : i + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
      {receiver && (
        <div className="receiver-note">
          <ShieldCheck size={16} />
          <span>正在模拟{name}处理请求，所有操作仅影响演示数据。</span>
        </div>
      )}
      {!receiver && ['draft', 'changes_requested'].includes(request.status) ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (change((s) => submitCollaboration(s, request.id, brief)))
              ui.toast('请求已发送，可切换到同事视角继续演示');
          }}
        >
          {request.feedback && (
            <p className="inline-notice">
              {name}希望你补充：{request.feedback}
            </p>
          )}
          <div className="form-grid">
            <Field label={request.capabilityId === 'finance-report' ? '报表月份' : '工作月份'}>
              <input
                type="month"
                required
                min="2020-01"
                max="2099-12"
                value={brief.month}
                onChange={(e) => setBrief({ ...brief, month: e.target.value })}
              />
            </Field>
            <Field label="业务范围">
              <select
                aria-label="业务范围"
                value={brief.scope}
                onChange={(e) => setBrief({ ...brief, scope: e.target.value as Brief['scope'] })}
              >
                <option>公司整体</option>
                <option>销售业务</option>
              </select>
            </Field>
          </div>
          <Field label="使用目的" hint="说明用途，有助于同事判断口径和可交付范围。">
            <textarea
              aria-label="使用目的"
              required
              maxLength={500}
              value={brief.purpose}
              onChange={(e) => setBrief({ ...brief, purpose: e.target.value })}
            />
          </Field>
          <div className="row wrap">
            <Button type="submit" variant="primary" disabled={!brief.month || !brief.purpose.trim()}>
              {request.status === 'changes_requested' ? '重新发送协作请求' : '发送协作请求'}
            </Button>
            <Button onClick={() => action('cancel', true)}>取消协作</Button>
          </div>
        </form>
      ) : (
        <>
          <dl className="request-brief">
            <dt>需求范围</dt>
            <dd>
              {request.brief.month} · {request.brief.scope}
            </dd>
            <dt>使用目的</dt>
            <dd>{request.brief.purpose}</dd>
            <dt>交付内容</dt>
            <dd>{capability.output} · 仅请求方接收</dd>
          </dl>
          {request.feedback && (
            <p className="inline-notice">
              {name}的说明：{request.feedback}
            </p>
          )}
          {receiver && request.status === 'pending' && (
            <>
              <Field label="给请求方的说明">
                <textarea maxLength={500} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
              </Field>
              <div className="row wrap">
                <Button variant="primary" onClick={() => action('authorize', true)}>
                  授权本次工作
                </Button>
                <Button onClick={() => action('clarify')} disabled={!feedback.trim()}>
                  请对方补充
                </Button>
                <Button variant="ghost" onClick={() => action('reject', true)}>
                  拒绝请求
                </Button>
              </div>
            </>
          )}
          {receiver && request.status === 'authorized' && (
            <div className="request-next">
              <p>本次范围已授权。下一步用合成资料准备结果，由你审阅后交付。</p>
              <Button variant="primary" icon={Bot} onClick={() => action('generate')}>
                模拟生成结果
              </Button>
            </div>
          )}
          {receiver && request.status === 'review' && (
            <div className="receiver-result">
              <div className="between">
                <h3>待交付结果</h3>
                <Badge>仅接收方审阅 · 演示</Badge>
              </div>
              {editing ? (
                <>
                  <Field label="调整交付内容">
                    <textarea
                      className="result-editor"
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                    />
                  </Field>
                  <div className="row">
                    <Button
                      disabled={!content.trim()}
                      onClick={() => {
                        change((s) => {
                          const r = s.collaborations.find((x) => x.id === request.id);
                          if (r?.status === 'review') r.draftContent = content.trim();
                        });
                        setEditing(false);
                      }}
                    >
                      保存调整
                    </Button>
                    <Button
                      onClick={() => {
                        setContent(request.draftContent || '');
                        setEditing(false);
                      }}
                    >
                      放弃修改
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="result-preview">
                    <DocumentText text={request.draftContent || ''} />
                  </div>
                  <div className="row wrap">
                    <Button variant="primary" onClick={() => action('deliver', true)}>
                      确认交付给{name === request.requester ? '自己' : request.requester}
                    </Button>
                    <Button onClick={() => setEditing(true)}>调整结果</Button>
                  </div>
                </>
              )}
            </div>
          )}
          {receiver && ['draft', 'changes_requested'].includes(request.status) && (
            <div className="request-next">
              <p>等待请求方补齐需求并发送。授权将以重新提交的需求为准。</p>
              <Button onClick={() => setReceiver(false)}>返回我的请求</Button>
            </div>
          )}
          {!receiver && ['pending', 'authorized', 'review'].includes(request.status) && (
            <div className="request-next">
              <p className="row">
                <Clock3 size={16} />
                {request.status === 'pending'
                  ? `等待${name}确认权限与工作范围。`
                  : request.status === 'authorized'
                    ? '本次请求已获授权，等待同事智能体生成结果。'
                    : '同事智能体已准备结果，等待负责人确认交付。'}
              </p>
              <div className="row wrap">
                <Button onClick={() => setReceiver(true)}>
                  体验同事处理流程
                  <ArrowUpRight size={14} />
                </Button>
                <Button variant="ghost" onClick={() => action('cancel', true)}>
                  取消协作
                </Button>
              </div>
            </div>
          )}
          {request.status === 'delivered' && request.resultDocId && (
            <div className="request-next">
              <p className="row success-text">
                <Check size={16} />
                已交付至请求方个人空间
              </p>
              <div className="row wrap">
                <Button variant="primary" icon={FileText} onClick={() => ui.preview(request.resultDocId!)}>
                  预览交付成果
                </Button>
                <Button onClick={() => ui.go(`library/personal/${request.resultDocId}`)}>
                  在资料库中查看
                  <ArrowUpRight size={14} />
                </Button>
              </div>
            </div>
          )}
          {['rejected', 'cancelled'].includes(request.status) && (
            <div className="request-next">
              <p>本次协作已结束，未向资料库新增结果。</p>
              <Button onClick={() => ui.go('home')}>返回新建会话</Button>
            </div>
          )}
        </>
      )}
      <details className="collaboration-history">
        <summary>
          <History size={14} />
          协作记录 · {request.events.length}
        </summary>
        <ol>
          {request.events.map((e) => (
            <li key={e.id}>
              <span>
                {e.actor} · {e.date}
              </span>
              <p>{e.text}</p>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
