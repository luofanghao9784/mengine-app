import { useContext, useState } from 'react';
import { ConversationComposer } from '../conversation/Conversations';
import { conversationClient } from '../conversation/client';
import { identityClient, useSession } from './session';
import { Failure, useRemote } from '../shared/admin';
import { RequestPending } from '../shared/request-guard';

/** Reuse the real send/retry/draft flow. Typing stays in the briefing until a send is accepted. */
export function WorkspaceComposer({ tenant, account }: { tenant: string; account: string }) {
  const { session } = useSession();
  const pendingRequest = useContext(RequestPending);
  const [attempt, setAttempt] = useState(0);
  const data = useRemote(
    async (signal) => {
      const [context, conversations] = await Promise.all([
        identityClient.context(tenant, signal),
        conversationClient.list(tenant, 0, signal),
      ]);
      return { context, conversations };
    },
    [tenant, account, session.identity, attempt],
  );
  if (data.error)
    return (
      <div className="workspace-composer-status">
        <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />
      </div>
    );
  if (!data.value)
    return (
      <div className="workspace-composer-status" role="status">
        正在准备输入框…
      </div>
    );
  const { context, conversations } = data.value;
  return (
    <ConversationComposer
      key={`${account}:${tenant}`}
      fromBriefing
      tenant={tenant}
      context={context}
      enabled={conversations.enabled && !pendingRequest}
      agentMode={conversations.agentMode}
      publicWebEnabled={conversations.publicWebEnabled}
      disabledReason={!conversations.enabled ? '会话暂未开放。' : ''}
      changed={() => {}}
    />
  );
}
