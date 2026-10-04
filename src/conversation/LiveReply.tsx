import { useEffect, useRef, useState } from 'react';
import { ReplyText } from './ReplyText';
import type { LiveAnswer } from './useLiveAnswers';
import './live-reply.css';

// Reveal appended batches gradually; already rendered text keeps its DOM and opacity.
function useProgressiveText(text: string, identity: string, animate: boolean) {
  const [visible, setVisible] = useState({ identity, text: '' });
  const rendered = useRef(visible);
  rendered.current = visible;
  const target = useRef(text);
  target.current = text;
  useEffect(() => {
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible({ identity, text });
      return;
    }
    let frame = 0,
      last = 0;
    const tick = (now: number) => {
      if (rendered.current.identity === identity && rendered.current.text === target.current) return;
      if (now - last >= 32) {
        last = now;
        setVisible((old) => {
          const value = target.current;
          const prior = old.identity === identity && value.startsWith(old.text) ? old.text : '';
          let end = Math.min(
            value.length,
            prior.length + Math.max(2, Math.ceil((value.length - prior.length) / 6)),
          );
          // Avoid exposing half of a UTF-16 character.
          if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end++;
          return { identity, text: value.slice(0, end) };
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [identity, animate, text]);
  return !animate ? text : visible.identity === identity ? visible.text : '';
}

export function LiveReply({ live, running }: { live: LiveAnswer; running: boolean }) {
  const text = useProgressiveText(live.text, `${live.attempt}:${live.step}`, running);
  const preview = running && live.state === 'COMPLETE';
  return (
    <div
      className={`conversation-reply live-streaming-reply ${preview ? 'live-process-preview' : ''}`}
      aria-label={preview ? '处理中的临时内容' : '正在生成的回复'}
    >
      <ReplyText text={text} />
    </div>
  );
}

export function ReplyProgress({ status, reconnecting = false }: { status: string; reconnecting?: boolean }) {
  if (!['QUEUED', 'RUNNING'].includes(status)) return null;
  return (
    <div className="reply-progress" role="status" aria-live="polite">
      <span className={reconnecting ? 'reply-progress-connection' : 'reply-progress-flow'}>
        {reconnecting ? '正在恢复连接，已有内容已保留' : status === 'QUEUED' ? '等待处理' : '正在思考'}
      </span>
    </div>
  );
}
