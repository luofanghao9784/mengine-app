import { isRecord } from './http-json.js';
import { RuntimeError } from './ports.js';

/** One explicit request, two reads. This grants budget, never source authority. */
export class BriefingEvidenceBudget {
  private requested = false;
  private remaining = 0;
  canRequest(enabled: boolean, closed: boolean) { return enabled && closed && !this.requested; }
  get open() { return this.remaining > 0; }
  request(args: unknown) {
    if (this.requested) throw new RuntimeError('BRIEFING_SUPPLEMENT_EXHAUSTED');
    if (!isRecord(args) || typeof args.reason !== 'string' || !args.reason.trim() || args.reason.length > 300)
      throw new RuntimeError('INVALID_TOOL_ARGUMENTS');
    this.requested = true;
    this.remaining = 2;
    return { reason: args.reason.trim(), remainingReads: 2, authority: false,
      scope: 'EXISTING_TASK_GRANTS', calculationAllowed: false, topicChangeAllowed: false };
  }
  allows(name: string, args?: unknown) {
    if (!this.open) return false;
    if (name === 'search_sources' || name === 'read_source') return true;
    return name === 'task_context' && (args === undefined || isRecord(args) &&
      ['profiles','profile_read','dataset_search','dataset_read'].includes(String(args.action)));
  }
  consume(name: string, args: unknown) {
    if (!this.allows(name,args)) throw new RuntimeError('BRIEFING_RETRIEVAL_LIMIT');
    this.remaining--;
  }
}
