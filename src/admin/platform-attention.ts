import type { TenantSummary } from '../../contracts/public-api/platform-admin.ts';
import type { EngineTelemetry } from '../../contracts/public-api/engine-telemetry.ts';

export const ownerStateLabel = {
  ASSIGNED: '已接手',
  UNDESIGNATED: '负责人待指定',
  AWAITING_RESPONSIBILITY: '等待接受负责人职责',
  AWAITING_INVITATION: '等待接受邀请',
  INVITATION_INACTIVE: '邀请已失效，待重新邀请',
} as const;

export function overviewAttention(tenants: readonly TenantSummary[], telemetry?: EngineTelemetry) {
  return {
    owners: tenants.slice(0, 20).filter((tenant) => tenant.owner.state !== 'ASSIGNED'),
    moreTenants: tenants.length > 20,
    observedTenants: Math.min(20, tenants.length),
    waiting: telemetry?.channels.reduce((n, channel) => n + channel.waiting, 0),
    unknown: telemetry?.channels.reduce((n, channel) => n + channel.unknown, 0),
    // These are retained attempts, not a count of current service faults or human tasks.
    retainedFailures: telemetry?.channels.reduce((n, channel) => n + channel.failed, 0),
  };
}
