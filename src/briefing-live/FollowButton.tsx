import { useContext, useState } from 'react';
import { Star } from 'lucide-react';
import { RequestPending, useRequestLock } from '../shared/request-guard';
import { SubmitError, useSubmission } from '../shared/admin';
import type { BriefingUpdate } from '../../contracts/public-api/briefing';
import { briefingClient } from './client';
import { RailButton } from './Magazine';

export function FollowButton({
  tenant,
  conversation,
  pinned,
  changed,
}: {
  tenant: string;
  conversation: string;
  pinned: boolean;
  changed: (pinned: boolean) => void;
}) {
  const pending = useContext(RequestPending),
    mutation = useSubmission<Omit<BriefingUpdate, 'requestId'>>();
  const [reading, setReading] = useState(false),
    [error, setError] = useState<unknown>();
  const [last, setLast] = useState<Omit<BriefingUpdate, 'requestId'>>();
  useRequestLock(reading || mutation.busy || mutation.uncertain);
  const send = async () => {
    setError(undefined);
    let body = last;
    if (!mutation.uncertain) {
      setReading(true);
      try {
        // Fetch all settings before changing one; never reset a previously widened/hidden card.
        const current = await briefingClient.preference(tenant, conversation);
        body = {
          hidden: current.hidden,
          size: current.size,
          expectedRevision: current.revision,
          pinned: !current.pinned,
        };
        setLast(body);
      } catch (e) {
        setError(e);
        return;
      } finally {
        setReading(false);
      }
    }
    if (!body) return;
    await mutation.submit(body, async (value, requestId) => {
      const result = await briefingClient.update(tenant, conversation, { ...value, requestId });
      changed(result.pinned);
    });
  };
  return (
    <div className="live-follow-action">
      <RailButton
        label={mutation.uncertain ? '重试本次关注' : pinned ? '取消关注' : '关注'}
        icon={Star}
        active={pinned}
        aria-pressed={pinned}
        disabled={reading || mutation.busy || (pending && !mutation.uncertain)}
        onClick={() => void send()}
      />
      <SubmitError error={error || mutation.error} uncertain={mutation.uncertain} />
    </div>
  );
}
