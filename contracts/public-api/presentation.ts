export interface PresentationOptions {
  pages: number;
  theme: 'ocean' | 'ink';
}
export interface PresentationSlide {
  kind: 'cover' | 'bullets' | 'table' | 'chart';
  title: string;
  sourceIds: string[];
  subtitle?: string;
  bullets?: string[];
  headers?: string[];
  rows?: string[][];
  labels?: string[];
  values?: number[];
  series?: string;
  unit?: string;
}
export interface PresentationSpec {
  title: string;
  theme: 'ocean' | 'ink';
  slides: PresentationSlide[];
}
export interface PresentationDraft {
  state: 'NONE' | 'REQUESTED' | 'DRAFT' | 'CONFIRMED';
  revision?: number;
  spec?: PresentationSpec | null;
  options?: Partial<PresentationOptions>;
}
export interface PresentationConfirmation {
  expectedRevision: number;
  draftRevision: number;
  title: string;
  theme: 'ocean' | 'ink';
  slides: { index: number; title: string }[];
}
