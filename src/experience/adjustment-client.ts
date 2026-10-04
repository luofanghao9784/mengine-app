import type {
  ExperienceAdjustment,
  ExperienceAdjustments,
  ExperienceProposal,
} from '../../contracts/public-api/experience.ts';
import { createIdentityRequest, IdentityError, record, uuid } from '../identity/client.ts';
import { processingLabels } from './management-client.ts';
export const isAdjustment = (v: unknown): v is ExperienceAdjustment =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.versionId) &&
  typeof v.state === 'string' &&
  Object.hasOwn(processingLabels, v.state) &&
  (v.resultVersionId === null || uuid(v.resultVersionId)) &&
  typeof v.createdAt === 'string' &&
  Number.isFinite(Date.parse(v.createdAt)) &&
  Object.keys(v).every((k) => ['id', 'versionId', 'state', 'resultVersionId', 'createdAt'].includes(k));
export function createExperienceAdjustmentClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const root = (t: string, w: string, e: string) => {
    if (![t, w, e].every(uuid)) throw new IdentityError('INVALID_REQUEST', 400);
    return `/api/v1/tenants/${t}/workspaces/${w}/experiences/${e}/adjustments`;
  };
  return {
    list(t: string, w: string, e: string, signal?: AbortSignal) {
      return request(
        root(t, w, e),
        'GET',
        (v): v is ExperienceAdjustments =>
          record(v) &&
          typeof v.enabled === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 10 &&
          v.items.every(isAdjustment),
        undefined,
        signal,
      );
    },
    async submit(
      t: string,
      w: string,
      e: string,
      body: { requestId: string; expectedRevision: number; versionId: string; proposal: ExperienceProposal },
    ) {
      try {
        return await request(
          root(t, w, e),
          'POST',
          (v): v is ExperienceAdjustment => isAdjustment(v) && v.versionId === body.versionId,
          body,
        );
      } catch (error) {
        if (error instanceof IdentityError) {
          if (error.code === 'EXPERIENCE_ADJUSTMENT_PENDING')
            error.message = '这条经验已有调整正在自动处理，请等待结果。';
          if (error.code === 'EXPERIENCE_STATE_CHANGED')
            error.message = '经验版本或状态已变化，请刷新后重新调整。';
        }
        throw error;
      }
    },
  };
}
export const experienceAdjustmentClient = createExperienceAdjustmentClient();
