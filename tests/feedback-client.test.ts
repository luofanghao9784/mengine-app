import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFeedbackClient,
  isAction,
  isAssessment,
  isFeedback,
  isTarget,
} from '../src/feedback/client.ts';
import type { Feedback, FeedbackAction, FeedbackFollowUp } from '../contracts/public-api/feedback.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2026-10-01T00:00:00Z';
const target = {
  kind: 'TASK' as const,
  taskId: id(3),
  taskRevision: 3,
  attempt: 1,
  presentationVersion: 'task-v1' as const,
  presentationRevision: 0,
};
const feedback: Feedback = {
  id: id(4),
  tenantId: id(1),
  workspaceId: id(2),
  target,
  revision: 1,
  status: 'ACTIVE',
  assessment: { rating: 'ACHIEVED', reasons: [], suggestion: '' },
  snapshot: {
    taskState: 'SUCCEEDED',
    executionClass: 'verification',
    contentSha256: 'a'.repeat(64),
    sourceVersionCount: 1,
  },
  createdAt: now,
  updatedAt: now,
};
const action: FeedbackAction = {
  id: id(5),
  feedbackId: id(4),
  feedbackRevision: 1,
  kind: 'CORRECTION',
  status: 'TASK_CREATED',
  targetId: id(6),
  targetVersion: null,
  targetRevision: 1,
  conversationId: id(7),
  acceptedState: 'WAITING_CAPABILITY',
  executionClass: 'none',
  createdAt: now,
};
const followUp: FeedbackFollowUp = {
  kind: 'CORRECTION',
  confirmed: true,
  preference: null,
  correction: '请核对当前数字',
  candidate: null,
};
const serving = (body: unknown) =>
  createFeedbackClient((async (url) =>
    String(url).endsWith('/csrf')
      ? Response.json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' })
      : Response.json(body)) as typeof fetch);
test('channel and observed version remain explicit, synthetic rating is not success proof', () => {
  assert.ok(isTarget(target));
  assert.ok(isFeedback(feedback));
  assert.equal(isTarget({ ...target, presentationRevision: 2 }), false);
  assert.equal(isTarget({ ...target, kind: 'BRIEFING' }), false);
  assert.equal(
    isFeedback({ ...feedback, assessment: { rating: 'USEFUL', reasons: [], suggestion: '' } }),
    false,
  );
  assert.equal(
    isFeedback({ ...feedback, snapshot: { ...feedback.snapshot, executionClass: 'verified' } }),
    false,
  );
});
test('negative briefing requires explicit reason and custom explanation; duplicate reasons rejected', () => {
  assert.ok(isAssessment({ rating: 'NOT_USEFUL', reasons: ['IRRELEVANT'], suggestion: '' }, 'BRIEFING'));
  for (const reasons of [[], ['CUSTOM'], ['IRRELEVANT', 'IRRELEVANT'], ['FACT_ERROR']])
    assert.equal(isAssessment({ rating: 'NOT_USEFUL', reasons, suggestion: '' }, 'BRIEFING'), false);
  assert.ok(
    isAssessment({ rating: 'NOT_USEFUL', reasons: ['CUSTOM'], suggestion: '缺少本月资料' }, 'BRIEFING'),
  );
});
test('lookup and create reject wrong tenant or exact task revision', async () => {
  await assert.rejects(serving({ feedback: { ...feedback, tenantId: id(2) } }).lookup(id(1), target), {
    code: 'CONTRACT_MISMATCH',
  });
  await assert.rejects(
    serving({ feedback: { ...feedback, target: { ...target, attempt: 2 } } }).lookup(id(1), target),
    { code: 'CONTRACT_MISMATCH' },
  );
  await assert.rejects(
    serving({ ...feedback, revision: 2 }).create(id(1), {
      requestId: id(8),
      target,
      assessment: feedback.assessment,
    }),
    { code: 'CONTRACT_MISMATCH' },
  );
});
test('revision receipts cannot falsely confirm edits or withdrawals', async () => {
  assert.equal(
    (
      await serving({ ...feedback, revision: 2 }).edit(id(1), id(4), {
        requestId: id(8),
        expectedRevision: 1,
        assessment: feedback.assessment,
      })
    ).revision,
    2,
  );
  await assert.rejects(
    serving(feedback).edit(id(1), id(4), {
      requestId: id(8),
      expectedRevision: 1,
      assessment: feedback.assessment,
    }),
    { code: 'CONTRACT_MISMATCH' },
  );
  await assert.rejects(
    serving({ ...feedback, revision: 2 }).withdraw(id(1), id(4), { requestId: id(8), expectedRevision: 1 }),
    { code: 'CONTRACT_MISMATCH' },
  );
  assert.equal(
    (
      await serving({ ...feedback, revision: 2, status: 'WITHDRAWN' }).withdraw(id(1), id(4), {
        requestId: id(8),
        expectedRevision: 1,
      })
    ).status,
    'WITHDRAWN',
  );
});
test('action receipt cannot turn a candidate into published evidence or task into a preference', () => {
  assert.ok(isAction(action));
  assert.equal(isAction({ ...action, status: 'APPLIED' }), false);
  assert.equal(isAction({ ...action, acceptedState: 'VERIFIED_SUCCESS' }), false);
  assert.equal(
    isAction({
      ...action,
      kind: 'EXPERIENCE_CANDIDATE',
      status: 'CANDIDATE_CREATED',
      targetVersion: id(8),
      acceptedState: 'PUBLISHED',
    }),
    false,
  );
  assert.ok(
    isAction({
      ...action,
      kind: 'EXPERIENCE_CANDIDATE',
      status: 'CANDIDATE_CREATED',
      targetVersion: id(8),
      conversationId: null,
      acceptedState: 'CANDIDATE',
    }),
  );
});
test('follow-up requires matching feedback revision, object and action kind', async () => {
  const body = { requestId: id(8), expectedRevision: 1, action: followUp };
  for (const value of [
    { ...action, feedbackId: id(9) },
    { ...action, feedbackRevision: 2 },
  ])
    await assert.rejects(serving(value).followUp(id(1), id(4), body), { code: 'CONTRACT_MISMATCH' });
  assert.equal((await serving(action).followUp(id(1), id(4), body)).acceptedState, 'WAITING_CAPABILITY');
});
test('stable request is transmitted on retry after response loss with CSRF and unchanged body', async () => {
  const calls: string[] = [];
  const client = createFeedbackClient((async (url, init) => {
    if (String(url).endsWith('/csrf'))
      return Response.json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
    assert.equal((init?.headers as Record<string, string>)['X-CSRF-TOKEN'], 'synthetic');
    calls.push(String(init?.body));
    if (calls.length === 1) throw new TypeError('Response lost');
    return Response.json(action);
  }) as typeof fetch);
  const body = { requestId: id(8), expectedRevision: 1, action: followUp };
  await assert.rejects(client.followUp(id(1), id(4), body), { code: 'UNCERTAIN_RESULT' });
  await client.followUp(id(1), id(4), body);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], calls[1]);
});
test('version conflict preserves real HTTP status and useful recovery guidance', async () => {
  const client = createFeedbackClient((async (url) =>
    String(url).endsWith('/csrf')
      ? Response.json({ headerName: 'X-CSRF-TOKEN', token: 'x' })
      : Response.json(
          { contractVersion: '1.0', code: 'FEEDBACK_STATE_CHANGED', message: '', retryable: false },
          { status: 409 },
        )) as typeof fetch);
  await assert.rejects(
    client.edit(id(1), id(4), { requestId: id(8), expectedRevision: 1, assessment: feedback.assessment }),
    (e: any) => e.status === 409 && e.code === 'FEEDBACK_STATE_CHANGED' && e.message.includes('刷新'),
  );
});
test('history refuses wrong channel and action pages refuse duplicate/wrong object receipts', async () => {
  await assert.rejects(
    serving({
      items: [
        {
          revision: 1,
          status: 'ACTIVE',
          assessment: { rating: 'USEFUL', reasons: [], suggestion: '' },
          createdAt: now,
        },
      ],
      hasMore: false,
    }).history(id(1), id(4), 'TASK'),
    { code: 'CONTRACT_MISMATCH' },
  );
  await assert.rejects(serving({ items: [action, action], hasMore: false }).actions(id(1), id(4)), {
    code: 'CONTRACT_MISMATCH',
  });
  await assert.rejects(
    serving({ items: [{ ...action, feedbackId: id(8) }], hasMore: false }).actions(id(1), id(4)),
    { code: 'CONTRACT_MISMATCH' },
  );
});
test('personal preference slots cannot be replaced by duplicate scenarios', async () => {
  const p = { scenario: 'GENERAL', profileId: null, revision: 0, status: 'UNSET', style: null };
  await assert.rejects(serving({ items: [p, p, p] }).preferences(id(1)), { code: 'CONTRACT_MISMATCH' });
});
test('publication feedback has exact public copy identity without a private task and lookup omits nulls', async () => {
  const publication = {
    kind: 'PUBLICATION' as const,
    taskId: null,
    taskRevision: 0 as const,
    attempt: 0 as const,
    publicationId: id(8),
    materialVersionId: id(9),
    materialVersion: 2,
    presentationVersion: 'recommendation-v1' as const,
    presentationRevision: 8,
  };
  assert.ok(isTarget(publication));
  assert.equal(isTarget({ ...publication, taskId: id(3) }), false);
  assert.equal(isTarget({ ...publication, materialVersion: 0 }), false);
  assert.equal(isTarget({ ...publication, presentationRevision: 0 }), false);
  assert.ok(isAssessment({ rating: 'NOT_USEFUL', reasons: ['INACCURATE'], suggestion: '' }, 'PUBLICATION'));
  assert.equal(isAssessment({ rating: 'ACHIEVED', reasons: [], suggestion: '' }, 'PUBLICATION'), false);
  const opinion = {
    ...feedback,
    target: publication,
    assessment: { rating: 'USEFUL', reasons: [], suggestion: '' },
    snapshot: { ...feedback.snapshot, taskState: 'PUBLISHED_COPY', executionClass: 'none' },
  };
  assert.ok(isFeedback(opinion));
  const client = createFeedbackClient(async (url) => {
    const query = new URL(String(url), 'http://localhost').searchParams;
    assert.equal(query.has('taskId'), false);
    assert.equal(query.get('publicationId'), id(8));
    return new Response(JSON.stringify({ feedback: opinion }), {
      headers: { 'content-type': 'application/json' },
    });
  });
  assert.equal((await client.lookup(id(1), publication)).feedback?.id, feedback.id);
  await assert.rejects(
    serving({ feedback: { ...opinion, target: { ...publication, materialVersionId: id(7) } } }).lookup(
      id(1),
      publication,
    ),
    { code: 'CONTRACT_MISMATCH' },
  );
});

test('unavailable preference slots retain identifiers but cannot smuggle a live style', async () => {
  const items = ['GENERAL', 'WEEKLY_REPORT', 'TABLE_SUMMARY'].map((scenario) => ({
    scenario,
    profileId: id(8),
    revision: 2,
    status: 'UNAVAILABLE',
    style: null,
  }));
  assert.deepEqual((await serving({ items }).preferences(id(1))).items, items);
  await assert.rejects(
    serving({ items: items.map((p, i) => (i === 0 ? { ...p, style: 'CONCISE' } : p)) }).preferences(id(1)),
    { code: 'CONTRACT_MISMATCH' },
  );
});
