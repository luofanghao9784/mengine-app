import type { WikiDraft } from './wiki-learning';
export type WikiArticleBody = NonNullable<WikiDraft['article']>;
export interface WikiArticle {
  id: string;
  tenantId: string;
  materialId: string;
  revision: number;
  archived: boolean;
  sourceChanged: boolean;
  canMaintain: boolean;
  sourceName: string;
  sourceVersionId: string;
  sourceVersion: number;
  executionClass: 'live' | 'verification';
  modelName: string | null;
  article: WikiArticleBody | null;
}
export interface WikiArticlePage {
  items: WikiArticle[];
  hasMore: boolean;
}
export interface WikiPreparation {
  expectedRevision: number;
  canPublish: boolean;
}
export interface WikiArticleHistory {
  items: {
    revision: number;
    action: 'PUBLISH' | 'EDIT' | 'ARCHIVE' | 'RESTORE';
    actorId: string;
    createdAt: string;
    sourceChanged: boolean;
    article: WikiArticleBody | null;
  }[];
  hasMore: boolean;
}
