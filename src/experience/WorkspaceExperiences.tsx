import { useEffect, useState } from 'react';
import type { GovernanceSnapshot } from '../../contracts/public-api/governance';
import { uuid } from '../identity/client';
import { identityClient, useSession } from '../identity/session';
import { Failure, Loading, MutationGate, useRemote } from '../shared/admin';
import { Field } from '../shared/ui';
import { ExperienceLibrary } from './ExperienceLibrary';

/** Both entry points choose current readable scopes; the service checks maintenance rights again. */
export function WorkspaceExperiences({
  tenant,
  management,
}: {
  tenant: string;
  management?: GovernanceSnapshot;
}) {
  const { session } = useSession();
  const [selected, setSelected] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get('scope') || '',
  );
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const refresh = () => {
      if (!busy) setAttempt((n) => n + 1);
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [busy]);
  const context = useRemote(
    (signal) => identityClient.context(tenant, signal),
    [tenant, attempt, session.identity, management],
  );
  if (context.error) return <Failure error={context.error} retry={() => setAttempt((n) => n + 1)} />;
  if (!context.value) return <Loading />;
  const spaces = context.value.workspaces.filter(
    (w) =>
      !management ||
      (w.kind === 'SHARED' &&
        management.capabilities.some(
          (c) => c.workspaceId === w.id && c.capability === 'EXPERIENCE_MAINTAIN',
        )),
  );
  const active = spaces.find((w) => w.id === selected) || spaces[0];
  return (
    <MutationGate.Provider value={setBusy}>
      <section className="experience-scope access-panel">
        {active ? (
          <Field label="经验范围">
            <select
              aria-label="经验范围"
              disabled={busy}
              value={active.id}
              onChange={(e) => setSelected(e.target.value)}
            >
              {spaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.kind === 'PERSONAL' ? '我的经验' : w.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <p>当前没有获权的经验维护范围。你可以返回工作空间继续自己的工作。</p>
        )}
      </section>
      {active && (
        <ExperienceLibrary
          key={`${tenant}:${active.id}`}
          tenant={tenant}
          workspace={active.id}
          workspaceName={active.name}
          verification={context.value}
          initialExperience={selected === active.id && uuid(new URLSearchParams(location.hash.slice(1)).get('experience')) ? new URLSearchParams(location.hash.slice(1)).get('experience')! : undefined}
        />
      )}
    </MutationGate.Provider>
  );
}
