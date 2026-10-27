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
