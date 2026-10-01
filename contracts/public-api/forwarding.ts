export interface ForwardSource {
  publicationId: string;
  workspaceId: string;
  workspaceName: string;
  materialId: string;
  materialVersionId: string;
  materialVersion: number;
  filename: string;
  format: 'docx' | 'pdf';
  sha256: string;
  publishedAt: string;
}
export interface ForwardPerson {
  id: string;
  name: string;
}
export interface ForwardPeople {
  source: ForwardSource;
  items: ForwardPerson[];
  hasMore: boolean;
}
export interface ForwardRecipient {
  receiptId: string;
  accountId: string;
  name: string;
  state: 'ACCEPTED' | 'OPENED';
  openedAt: string | null;
  currentlyAccessible: boolean;
}
export interface ForwardBatch {
  id: string;
  publicationId: string;
  materialVersionId: string;
  requestId: string;
  acceptedAt: string;
  note: string;
  source: ForwardSource;
  recipients: ForwardRecipient[];
}
export interface ForwardDelivery {
  id: string;
  batchId: string;
  senderId: string;
  senderName: string;
  acceptedAt: string;
  openedAt: string | null;
  state: 'ACCEPTED' | 'OPENED';
  note: string;
  source: ForwardSource;
}
export interface ForwardInbox {
  items: ForwardDelivery[];
  hasMore: boolean;
}
export interface ForwardHistory {
  items: ForwardBatch[];
  hasMore: boolean;
}
export interface ForwardRequest {
  publicationId: string;
  materialVersionId: string;
  recipients: string[];
  note: string;
}
