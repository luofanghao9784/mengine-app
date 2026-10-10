import { isRecord } from './http-json.js';
import { RuntimeError, type Json } from './ports.js';

/** A bounded fallback for a current-company overview, never a wider authorization scope. */
export function sourceQueries(prompt: string, query: string, continuity?: Json): string[] {
  const context = isRecord(continuity) && isRecord(continuity.result) ? continuity.result : undefined;
  const selected =
    context && Array.isArray(context.selectedMaterials) && context.selectedMaterials.length > 0;
  const organization = context && isRecord(context.organization) ? context.organization : undefined;
  const name = organization?.name;
  const overview =
    /^(?:你好[，,！!。\s]*|请|帮我|简单|详细|\s)*(?:介绍|概述|介绍一下)(?:一下)?(?:当前|我们|本)(?:的)?(?:企业|公司)[。？?！!\s]*$/.test(
      prompt.trim(),
    );
  const canFallback =
    overview &&
    context?.sourceScope === 'AUTHORIZED_LIBRARY' &&
    !selected &&
    typeof name === 'string' &&
    name.trim().length > 0 &&
    name.length <= 200 &&
    name.trim().split(/\s+/).length <= 8;
  const trimmed = query.trim();
  if (!trimmed && context && !selected) {
    if (canFallback) return [name.trim()];
    throw new RuntimeError('SEARCH_QUERY_REQUIRED', 'No selected files: supply a short literal keyword from the current request, such as 员工守则 or 寄养. Do not repeat an empty query. This error does not mean the library is empty.');
  }
  if (
    canFallback &&
    /^(?:企业|公司|当前企业|当前公司|企业介绍|公司介绍|企业简介|公司简介)$/.test(trimmed) &&
    trimmed !== name.trim()
  )
    return [trimmed, name.trim()];
  return [query];
}
