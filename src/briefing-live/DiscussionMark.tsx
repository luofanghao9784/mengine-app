import { MessageSquare } from 'lucide-react';
import { conversationClient } from '../conversation/client';
import { useRemote } from '../shared/admin';

export type DiscussionSource = {
  conversationId: string;
  taskId: string;
  taskRevision: number;
  attempt: number;
};

// The generation source is not the user's discussion. Only the authorized
// lookup can confirm a thread exists for this exact card revision and attempt.
export function DiscussionMark({ tenant, source }: { tenant: string; source: DiscussionSource }) {
  const data = useRemote(
    signal => conversationClient.discussion(tenant, source, signal),
    [tenant, source.conversationId, source.taskId, source.taskRevision, source.attempt],
  );
  if (data.error || !data.value?.conversationId) return null;
  return <span role="img" aria-label="已有会话" title="已有会话"><MessageSquare size={16} /></span>;
}
