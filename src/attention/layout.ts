export type AttentionDisplay = 'preview' | 'expanded' | 'collapsed';
export function previewCapacity(width: number) {
  return Math.min(3, Math.max(1, Math.floor((Math.max(0, width) + 12) / 272))) * 2;
}
