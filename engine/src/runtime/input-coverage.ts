import { isRecord } from './http-json.js';
import { RuntimeError, type Json } from './ports.js';

/** Project platform coverage into a small tool result; do not load the whole version inventory. */
export function inputCoverage(response: Record<string, unknown>): Record<string, Json> {
  if (response.matchStatus === undefined && response.coverage === undefined)
    return { coverage: null, coverageAvailable: false, resultsTruncated: typeof response.hasMore === 'boolean' ? response.hasMore : null };
  const coverage = response.coverage;
  if (
    !['MATCHED', 'NO_MATCH'].includes(String(response.matchStatus)) ||
    !isRecord(coverage) ||
    !['AUTHORIZED_LIBRARY', 'AUTHORIZED_WORKSPACE', 'AUTHORIZED_SHARED', 'SELECTED_VERSIONS'].includes(String(coverage.scope)) ||
    !['EMPTY', 'READY', 'PARTIAL', 'NOT_READY'].includes(String(coverage.status)) ||
    coverage.relevance !== 'NOT_ASSESSED' ||
    typeof coverage.hasMore !== 'boolean' || typeof response.hasMore !== 'boolean' ||
    !Array.isArray(coverage.versions) || coverage.versions.length > 10
  ) throw new RuntimeError('INVALID_SOURCE_RESPONSE');
  const counts: Record<string, number> = {};
  for (const key of ['totalVersions', 'searchableVersions', 'partialVersions', 'notReadyVersions']) {
    const value = coverage[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
      throw new RuntimeError('INVALID_SOURCE_RESPONSE');
    counts[key] = value;
  }
  if (counts.searchableVersions > counts.totalVersions || counts.partialVersions > counts.searchableVersions ||
      counts.searchableVersions + counts.notReadyVersions !== counts.totalVersions) throw new RuntimeError('INVALID_SOURCE_RESPONSE');
  const expectedStatus = counts.totalVersions === 0 ? 'EMPTY' : counts.searchableVersions === 0 ? 'NOT_READY' :
    counts.notReadyVersions > 0 || counts.partialVersions > 0 ? 'PARTIAL' : 'READY';
  if (coverage.status !== expectedStatus) throw new RuntimeError('INVALID_SOURCE_RESPONSE');
  const warnings = new Set<string>();
  for (const version of coverage.versions) {
    if (!isRecord(version) || !Array.isArray(version.warnings) || version.warnings.length > 4)
      throw new RuntimeError('INVALID_SOURCE_RESPONSE');
    for (const warning of version.warnings) {
      if (typeof warning !== 'string' || warning.length > 64)
        throw new RuntimeError('INVALID_SOURCE_RESPONSE');
      if (warnings.size < 5) warnings.add(warning);
    }
  }
  return {
    matchStatus: String(response.matchStatus),
    resultsTruncated: response.hasMore,
    coverageAvailable: true,
    coverage: {
      scope: String(coverage.scope), status: String(coverage.status), ...counts,
      relevance: 'NOT_ASSESSED', warnings: [...warnings],
      inventoryTruncated: coverage.hasMore,
    },
  };
}
