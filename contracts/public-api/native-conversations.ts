/** Native 0.2.1 enterprise boundary; runtime IDs are never enterprise identity. */
export interface NativeConversation {
 id: string; tenantId: string; ownerId: string; workspaceId: string;
 legacyConversationId: string | null; state: 'ACTIVE' | 'STOPPED';
}
export interface NativeConversationOpen { requestId: string; workspaceId: string; legacyConversationId: string | null }
export interface NativeConversationGrant { session: NativeConversation; token: string; expiresAt: string; launchUrl: string }
export interface NativeArtifact { id: string; filename: string; sha256: string; bytes: number }
export interface NativePublicationRequest { requestId: string; artifactId: string; workspaceId: string; acknowledged: boolean }
export interface NativePublication { artifactId: string; materialId: string; workspaceId: string }
