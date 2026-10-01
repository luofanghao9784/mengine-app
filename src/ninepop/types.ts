import type { SourcePhoto } from '../model.ts';

export type ResearchCard = {
  id: string;
  type: '数据' | '洞察' | '建议' | '成果' | '资讯';
  space: string;
  title: string;
  summary: string;
  generated_at: string;
  data_period: string;
  priority: string;
  facts: string[];
  ai_analysis: string;
  recommended_actions: string[];
  boundaries: string[];
  source_refs: string[];
  suggested_owner_role: string;
  execution_status: string;
  data: Record<string, string>[];
  editorial?: {
    source_label: string;
    display_date: string;
    date?: string;
    period?: string;
    photo?: SourcePhoto;
  };
  artifact?: {
    title: string;
    sections?: { title: string; body: string }[];
    columns?: string[];
    rules?: string[];
    rows?: Record<string, string>[];
  } | null;
};
export type NinepopPackage = {
  schema_version: 1;
  dataset_id: string;
  generated_at: string;
  spaces: string[];
  cards: ResearchCard[];
  suggested_first_screen: string[];
  materials: {
    id: string;
    title: string;
    content: string;
    boundary: string;
    status: string;
    url?: string;
    publishedAt?: string;
    eventDate?: string;
  }[];
};
