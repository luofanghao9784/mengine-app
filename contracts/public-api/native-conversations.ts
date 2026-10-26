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
/** Deployment switch: false means the native runtime is not configured, so the entry stays hidden. */
export interface NativeAvailability { enabled: boolean }
