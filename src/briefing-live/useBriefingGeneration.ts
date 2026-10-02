import { useCallback, useEffect, useRef, useState } from 'react';
import type { GenerationBatch } from '../../contracts/public-api/briefing-generation';
import type { RecommendationItem } from '../../contracts/public-api/recommendation';
import { IdentityError } from '../identity/client';
import { useSession } from '../identity/session';
import { useSubmission } from '../shared/admin';
import { useRequestLock } from '../shared/request-guard';
import { useViewState } from '../shared/useViewState';
import { recommendationClient } from '../recommendation/client';
import { generationClient as api } from './generation-client';

export const generationOpen = (b: GenerationBatch) =>
  ['QUEUED', 'RUNNING', 'WAITING_DATA', 'WAITING_RESOURCE', 'WAITING_CAPABILITY'].includes(b.status);
export type GenerationSlot = { batch: GenerationBatch; item?: RecommendationItem; reading?: boolean };

/** One owner per briefing page: filtering and refreshing the feed must not resubmit or lose a batch. */
export function useBriefingGeneration(tenant: string, workspace?: string, businessType?: string) {
  const { expire } = useSession();
  const [requested, setRequested] = useViewState<string | undefined>(
    tenant,
    'briefing:generation-request',
    undefined,
    (v): v is string | undefined => v === undefined || typeof v === 'string',
  );
  const requestRef = useRef(requested);
  requestRef.current = requested;
  const [batches, setBatches] = useState<GenerationBatch[]>([]);
  const [slots, setSlots] = useState<GenerationSlot[]>([]);
  const [error, setError] = useState<unknown>();
  const [revision, setRevision] = useState(0);
  const [cancelBusy, setCancelBusy] = useState<string>();
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  const seen = useRef<Set<string> | undefined>(undefined);
  const tracked = useRef<string[]>([]);
  const submission = useSubmission<{ workspaceId?: string; businessType?: string }>();
  useRequestLock(submission.busy || submission.uncertain || !!cancelBusy);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const state = await api.state(tenant, controller.signal);
        // The state endpoint bounds history to five batches per space. Revalidate
        // older displayed batches individually instead of treating truncation as deletion.
        const older = await Promise.all(
          tracked.current
            .filter((id) => !state.batches.some((b) => b.id === id))
            .map(async (id) => {
              try {
                return await api.batch(tenant, id, controller.signal);
              } catch (e) {
                if (e instanceof IdentityError && [403, 404].includes(e.status)) return undefined;
                throw e;
              }
            }),
        );
        state.batches.push(...older.filter((b): b is GenerationBatch => !!b));
        if (controller.signal.aborted) return;
        const previous = seen.current;
        for (const b of [...state.batches].reverse()) {
          const newlyFinished = previous && !previous.has(b.id) && b.status === 'SUCCEEDED';
          if (
            (generationOpen(b) || b.id === requestRef.current || newlyFinished) &&
            !tracked.current.includes(b.id)
          )
            tracked.current.push(b.id);
        }
        seen.current = new Set(state.batches.map((b) => b.id));
        // The server removes inaccessible batches; never retain their former content.
        tracked.current = tracked.current.filter((id) => state.batches.some((b) => b.id === id));
        const next = tracked.current.flatMap((id) => {
          const batch = state.batches.find((b) => b.id === id)!;
          return generationOpen(batch) || batch.status === 'SUCCEEDED' ? [{ batch }] : [];
        });
        setBatches(state.batches);
        setError(undefined);
        setSlots((old) =>
          next.map(({ batch }) => ({
            batch,
            item: old.find((s) => s.batch.id === batch.id)?.item,
            reading: batch.status === 'SUCCEEDED',
          })),
        );
        const ids = next.flatMap(({ batch }) => batch.cardIds);
        const items: RecommendationItem[] = [];
        for (let offset = 0; offset < ids.length; offset += 20)
          items.push(
            ...(await recommendationClient.cards(tenant, ids.slice(offset, offset + 20), controller.signal)),
          );
        if (!controller.signal.aborted)
          setSlots(
            next.map(({ batch }) => ({
              batch,
              item: items.find((i) => batch.cardIds.includes(i.content.id)),
            })),
          );
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e instanceof IdentityError && e.status === 401) expire();
        if (e instanceof IdentityError && [401, 403, 404].includes(e.status)) {
          setSlots([]);
          setBatches([]);
        } else setSlots((old) => old.map((s) => ({ ...s, reading: false })));
        setError(e);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(read, 5000);
      }
    };
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [tenant, revision, expire]);

  const matches = (b: GenerationBatch) =>
    (!workspace || b.workspaceId === workspace) &&
    (!businessType || !b.businessType || b.businessType === businessType);
  const visible = batches.filter(matches);
  const active = visible.find((b) => generationOpen(b) && b.businessType === (businessType || null));
  const current = active || visible.find((b) => b.id === requested) || visible[0];
  const generate = () =>
    void submission.submit({ workspaceId: workspace, businessType }, async (body, requestId) => {
      const batch = await api.generate(tenant, { ...body, requestId });
      requestRef.current = batch.id;
      setRequested(batch.id);
      if (!tracked.current.includes(batch.id)) tracked.current.push(batch.id);
      setBatches((old) => [batch, ...old.filter((b) => b.id !== batch.id)]);
      setSlots((old) => [...old.filter((s) => s.batch.id !== batch.id), { batch }]);
      refresh();
    });
  const cancel = async (id: string) => {
    if (cancelBusy) return;
    setCancelBusy(id);
    try {
      const batch = await api.cancel(tenant, id);
      setBatches((old) => old.map((b) => (b.id === id ? batch : b)));
      setSlots((old) => old.filter((s) => s.batch.id !== id));
      setError(undefined);
      refresh();
    } catch (e) {
      setError(e);
      if (e instanceof IdentityError && e.status === 401) expire();
    } finally {
      setCancelBusy(undefined);
    }
  };
  return {
    slots: slots.filter(
      (s) =>
        matches(s.batch) &&
        (!businessType || !s.item || s.item.briefing?.content.businessType === businessType),
    ),
    current,
    active,
    submission,
    error,
    generate,
    refresh,
    cancel,
    cancelBusy,
  };
}
export type BriefingGeneration = ReturnType<typeof useBriefingGeneration>;
