/** Only validated server context selects a route; user text never selects a model.
 * Ordinary private Q&A/data tasks use the routine model. Explicit advanced workflows stay on base.
 * This is workflow routing, not a promise to detect arbitrary semantic complexity in user text.
 */
export function useRoutineModel(context: {
  wikiLearning: boolean; wikiGraph: boolean; wikiInsight: boolean;
  publicResearch: boolean; plan: boolean; presentation: boolean; sandbox: boolean;
  briefing: boolean; briefingType: string; briefingUsePrimary?: boolean;
}) {
  if (context.briefing && context.briefingUsePrimary) return false;
  if (context.wikiGraph || context.wikiInsight) return false;
  if (context.wikiLearning) return true;
  if (context.publicResearch || context.plan || context.presentation || context.sandbox) return false;
  if (context.briefing && ['INSIGHT', 'SUGGESTION'].includes(context.briefingType)) return false;
  return true;
}
