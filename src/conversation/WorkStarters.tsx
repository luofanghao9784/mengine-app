import { useEffect, useState } from 'react';
import { workRoles, type WorkAudience } from '../identity/work-roles';
import './work-starters.css';
export function WorkStarters({ tenant, choose }: { tenant: string; choose: (text: string) => void }) {
  const [context, setContext] = useState<WorkAudience | null>(null);
  useEffect(() => {
    let current: AbortController | undefined;
    const load = () => {
      current?.abort();
      current = new AbortController();
      const request = current;
      setContext(null);
      workRoles
        .current(tenant, request.signal)
        .then((v) => {
          if (!request.signal.aborted) setContext(v);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      current?.abort();
      window.removeEventListener('focus', load);
    };
  }, [tenant]);
  if (!context) return null;
  return (
    <section className="work-starters" aria-label="适合当前工作的提问建议">
      <p>
        {context.jobTitle || context.roleLabel}
        {context.department ? ` · ${context.department}` : ''}，可以从这些工作开始：
      </p>
      <div>
        {context.starters.map((text) => (
          <button type="button" key={text} onClick={() => choose(text)}>
            {text}
          </button>
        ))}
      </div>
      {!context.configured && context.role === 'MEMBER' && (
        <small>还没有填写具体岗位，可以先在会话里说明你负责什么。</small>
      )}
    </section>
  );
}
