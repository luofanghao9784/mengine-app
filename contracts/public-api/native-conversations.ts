/** Native 0.2.1 enterprise boundary; runtime IDs are never enterprise identity. */
export interface NativeConversation {
 id: string; tenantId: string; ownerId: string; workspaceId: string;
 legacyConversationId: string | null; state: 'ACTIVE' | 'STOPPED';
 /** ISO time the session was opened; used for list ordering and labels. */
 createdAt: string;
}
export interface NativeConversationOpen { requestId: string; workspaceId: string; legacyConversationId: string | null }
export interface NativeConversationGrant { session: NativeConversation; token: string; expiresAt: string; launchUrl: string }
export interface NativeArtifact { id: string; filename: string; sha256: string; bytes: number }
export interface NativePublicationRequest { requestId: string; artifactId: string; workspaceId: string; acknowledged: boolean }
export interface NativePublication { artifactId: string; materialId: string; workspaceId: string }

/** Platform cursor spans root, children, interactions and status. Native seq is separate. */
export interface NativeConversationEvent {
 seq: number; type: string; time: number | string; data: unknown;
 sessionId?: string; nativeSeq?: number; surfaceOp?: string; sourceEventSeqs?: number[]; ignorable?: boolean;
}
export interface NativeConversationHistory { items: NativeConversationEvent[]; hasMore: boolean }
export interface NativeConversationBudget {
 usedYuan: number; reservedYuan: number; occupiedYuan: number;
 softYuan: number; hardYuan: number; elapsedMinutes: number; budgetElapsedMinutes: number;
 softMinutes: number; hardMinutes: number; dailyUsedYuan: number; dailyHardYuan: number;
 blocked: string | null; includesReservations: true;
}
export interface NativeConversationStatus {
 available: boolean; state: 'ACTIVE' | 'STOPPED'; reason?: string;
 running?: boolean; budget?: NativeConversationBudget; executionClass?: 'SYNTHETIC' | 'LIVE'; seq?: number; time?: string;
}
export interface NativeMessageRequest { requestId: string; text: string; materials?: {materialId: string; versionId: string}[] }
export interface NativeAnswerRequest { requestId: string; answers: {id: string; selected: string[]; custom?: string}[] }
export interface NativeApprovalRequest { requestId: string; decision: 'ALLOW_ONCE' | 'REJECT' }
export interface NativePlanReviewRequest { requestId: string; decision: 'APPROVE' | 'REVISE'; comment?: string }
export interface NativeFeedbackRequest { requestId: string; messageKey: string; value: 'up' | 'down' }
export interface NativeOperationReceipt { accepted: true; messageId?: string }
/** Deployment switch: false means the native runtime is not configured, so the entry stays hidden. */
export interface NativeAvailability { enabled: boolean }

/** V179: history excludes disposable status. SSE supplies only the latest snapshot;
 * platform seq may have gaps. 503 NATIVE_RUNTIME_NOT_DISPATCHED permits retry with
 * the SAME requestId; unknown outcomes never authorize a fresh ID or redispatch. */
export type NativeDispatchFailure = 'NATIVE_RUNTIME_NOT_DISPATCHED' | 'NATIVE_OPERATION_OUTCOME_UNKNOWN';

/** B8: GET native-conversations?workspaceId=...&query=... returns these rows.
 * query <=200 chars, case-insensitive title/root user+assistant text matching.
 * Authorized rows sorted pinned first then lastActivityAt descending. */
export interface NativeConversationListItem extends NativeConversation {
 title: string; pinned: boolean; lastActivityAt: string;
 pending: ('approval' | 'question' | 'plan')[];
}
/** PATCH .../{id}/metadata. Null title restores automatic title. */
export interface NativeMetadataUpdate { title?: string | null; pinned?: boolean }

/** B5: GET tenants/{t}/native-skills for the employee slash menu. */
export interface NativeSkillSummary { name: string; description: string }
/** GET/PUT tenants/{t}/admin/native-skills[/{name}], tenant admins only.
 * PUT itself records the admin review; markdown is instruction-only SKILL.md
 * with name and description YAML frontmatter. Empty audience = all members. */
export interface NativeSkillPut { markdown: string; published: boolean; audience: string[] }
export interface NativeSkillAdmin extends NativeSkillPut, NativeSkillSummary { revision: number }

/** B7: POST .../{id}/attachments multipart file + requestId UUID. Same ID/content
 * replays receipt; changed content conflicts. GET collection/list and /{attachmentId}
 * download are private to the current owner and recheck session permissions. */
export interface NativeAttachment { id: string; filename: string; mediaType: string; sha256: string; bytes: number }
export interface NativeMessageWithAttachments extends NativeMessageRequest { attachments?: string[] }
