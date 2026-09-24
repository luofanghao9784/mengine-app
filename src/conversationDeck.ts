export const deckLimits: Record<string, [number, number, number]> = {
  list: [208, 340, 240],
  conversation: [420, 1040, 720],
  source: [300, 680, 440],
  file: [320, 680, 400],
};

export const deckSpacing = { gap: 8, spine: 12, padding: 16, minElasticSpine: 8 } as const;

export function deckOrder(available: string[], saved: string[] = []) {
  return [...new Set([...saved, ...available])].filter((id) => available.includes(id));
}

export function conversationDefaultWidth(viewport: number, list: number, companions: number[]) {
  const available = Math.max(420, viewport - list - deckSpacing.gap - deckSpacing.padding * 2);
  const comfortable = Math.max(560, Math.min(880, Math.round(available * 0.68)));
  if (!companions.length) return comfortable;
  return Math.max(
    480,
    Math.min(
      comfortable,
      available - companions.reduce((a, b) => a + b, 0) - companions.length * deckSpacing.gap,
    ),
  );
}
