import type { UsageDay } from '../../contracts/public-api/usage';

/** Unknown maintenance calls stay unknown even when every known daily count is zero. */
export function usageTrendState(days: readonly UsageDay[]) {
  return {
    hasKnownActivity: days.some(
      (day) => day.workRequests > 0 || (day.maintenanceCalls !== null && day.maintenanceCalls > 0),
    ),
    hasUnknownMaintenance: days.some(
      (day) => day.maintenanceCalls === null || day.unknownMaintenanceRuns > 0,
    ),
    unknownMaintenanceRuns: days.reduce((total, day) => total + day.unknownMaintenanceRuns, 0),
  };
}
