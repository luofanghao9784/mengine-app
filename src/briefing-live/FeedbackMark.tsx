import { useEffect, useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import type { FeedbackTarget } from '../../contracts/public-api/feedback';
import { feedbackClient } from '../feedback/client';
import { useRemote } from '../shared/admin';

export const feedbackChangedEvent = 'briefing-feedback-changed';
export function FeedbackMark({ tenant, target }: { tenant: string; target: FeedbackTarget }) {
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify(target);
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail?.tenant === tenant) setRevision((n) => n + 1);
    };
    window.addEventListener(feedbackChangedEvent, changed);
    return () => window.removeEventListener(feedbackChangedEvent, changed);
  }, [tenant]);
  const data = useRemote((signal) => feedbackClient.lookup(tenant, target, signal), [tenant, key, revision]);
  const feedback = data.value?.feedback;
  if (data.error || feedback?.status !== 'ACTIVE') return null;
  const rating = feedback.assessment.rating;
  if (rating !== 'USEFUL' && rating !== 'NOT_USEFUL') return null;
  const label = rating === 'USEFUL' ? '已评价有用' : '已评价没用';
  const Icon = rating === 'USEFUL' ? ThumbsUp : ThumbsDown;
  return (
    <span role="img" aria-label={label} title={label}>
      <Icon size={16} fill="currentColor" />
    </span>
  );
}
