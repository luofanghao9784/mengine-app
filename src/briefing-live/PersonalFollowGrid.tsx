import type { FollowBoard as Board, FollowBoardPreference } from '../../contracts/public-api/follow-board';
import { useContext, useRef, useState } from 'react';
import { FollowGrid } from './FollowGrid';
import type { MagazineGridItem } from './MagazineGrid';
import type { FollowPreference } from '../components/useBriefingFollowLayout';
import { useSession } from '../identity/session';
import { createIdentityRequest, record } from '../identity/client';
import { Failure, Loading, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { RequestPending, useRequestLock } from '../shared/request-guard';
import { Button } from '../shared/ui';

type Save = { expectedRevision: number; preference: FollowBoardPreference | null };
const request = createIdentityRequest();
const isBoard = (v: unknown): v is Board =>
  record(v) &&
  typeof v.tenantId === 'string' &&
  typeof v.board === 'string' &&
  Number.isSafeInteger(v.revision) &&
  Number(v.revision) >= 0 &&
  (v.preference === null ||
    (record(v.preference) &&
      record(v.preference.sizes) &&
      record(v.preference.layout) &&
      Array.isArray(v.preference.layout.positions) &&
      Array.isArray(v.preference.layout.order)));
// Persist geometry and identifiers only, never titles, summaries or source bodies.
const geometry = (value: FollowPreference | undefined): FollowBoardPreference | null =>
  value
    ? {
        sizes: value.sizes,
        layout: {
          columns: value.layout.columns,
          order: value.layout.order,
          manual: value.layout.manual || [],
          positions: value.layout.positions.map(({ id, row, col, size }) => ({ id, row, col, size })),
        },
      }
    : null;
export function PersonalFollowGrid(props: {
  tenant: string;
  board: 'PRIVATE' | 'PUBLICATIONS';
  items: MagazineGridItem[];
  onArranging: (active: boolean) => void;
}) {
  const { session } = useSession();
  return <BoardGrid key={props.tenant + ':' + session.identity!.account.id + ':' + props.board} {...props} />;
}
function BoardGrid({ tenant, board, items, onArranging }: Parameters<typeof PersonalFollowGrid>[0]) {
  const pending = useContext(RequestPending);
  const [attempt, setAttempt] = useState(0);
  const url = `/api/v1/tenants/${tenant}/briefing/boards/${board}`;
  const remote = useRemote((signal) => request(url, 'GET', isBoard, undefined, signal), [url, attempt]);
  const [received, setReceived] = useState<Board>();
  const current =
    remote.value && (!received || remote.value.revision > received.revision) ? remote.value : received;
  const [draft, setDraft] = useState<{ value: FollowPreference | null }>();
  const submission = useSubmission<Save>();
  const retry = useRef<Save | undefined>(undefined);
  useRequestLock(submission.busy || submission.uncertain);
  const save = async (value: FollowPreference | undefined) => {
    if (!current) return false;
    const preference = geometry(value);
    if (preference && current.preference) {
      // Infinite loading must not erase saved positions of cards outside the loaded page.
      const visible = new Set(items.map((item) => item.id));
      const retained = current.preference.layout.positions
        .filter((position) => !visible.has(position.id))
        .map((position) => {
          const width = Math.min(preference.layout.columns, Number(position.size[0]));
          return {
            ...position,
            col: Math.min(position.col, preference.layout.columns - width),
            size: `${width}×${position.size[2]}` as typeof position.size,
          };
        });
      preference.layout.positions.push(...retained);
      preference.layout.order.push(...retained.map((position) => position.id));
      preference.layout.manual = [
        ...new Set([
          ...(preference.layout.manual || []),
          ...(current.preference.layout.manual || []).filter((id) => !visible.has(id)),
        ]),
      ];
    }
    const body = { expectedRevision: current.revision, preference };
    retry.current = body;
    setDraft({ value: body.preference });
    let success = false;
    await submission.submit(body, async (saved, requestId) => {
      const receipt = await request(
        url,
        'POST',
        (v): v is { appliedRevision: number; current: Board } =>
          record(v) && Number.isSafeInteger(v.appliedRevision) && isBoard(v.current),
        { ...saved, requestId },
      );
      setReceived(receipt.current);
      success = receipt.current.revision === receipt.appliedRevision;
    });
    setDraft(undefined);
    return success;
  };
  if (remote.error) return <Failure error={remote.error} retry={() => setAttempt((n) => n + 1)} />;
  if (!remote.value || !current) return <Loading />;
  return (
    <>
      {submission.busy && <p role="status">正在保存布局…</p>}
      <SubmitError error={submission.error} uncertain={submission.uncertain} />
      {submission.error &&
        (submission.uncertain ? (
          <Button
            disabled={submission.busy}
            onClick={() => void save(retry.current?.preference || undefined)}
          >
            重试保存布局
          </Button>
        ) : (
          <Button
            onClick={() => {
              setReceived(undefined);
              setAttempt((n) => n + 1);
            }}
          >
            读取账户最新布局
          </Button>
        ))}
      <FollowGrid
        items={items}
        saved={(draft ? draft.value : current.preference) || undefined}
        onSave={save}
        owner={tenant + ':' + board}
        blocked={pending || submission.busy || submission.uncertain}
        onArranging={onArranging}
      />
    </>
  );
}
