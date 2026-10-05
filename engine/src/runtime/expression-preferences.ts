import { RuntimeError } from './ports.js';
const catalog: Record<string, Record<string, string>> = {
  RESPONSE_LENGTH: {
    CONCISE: '简洁，优先写关键发现和必要依据',
    DETAILED: '详细展开依据、影响及必要的限制，避免重复',
  },
  RESPONSE_FORMAT: { PARAGRAPHS: '使用简短自然段', BULLETS: '使用清晰要点列表' },
  TONE: { DIRECT: '语气直接、清楚', FRIENDLY: '语气友好、自然，避免夸张和奉承' },
  BRIEFING_ORDER: {
    CONCLUSION_FIRST: '画报先给业务结论，再展开依据',
    EVIDENCE_FIRST: '画报先列关键业务依据，再给结论',
  },
};
export function expressionInstructions(value: unknown, briefing: boolean): string {
  if (value === undefined) return ''; // Compatibility with older verification fixtures.
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RuntimeError('TASK_ACCESS_DENIED');
  const entries = Object.entries(value);
  if (entries.length !== 4) throw new RuntimeError('TASK_ACCESS_DENIED');
  const rules: string[] = [];
  for (const [key, raw] of entries) {
    const setting = raw as { choice?: string; source?: string; revision?: number };
    if (
      !setting ||
      !catalog[key]?.[setting.choice ?? ''] ||
      !['SYSTEM', 'GLOBAL', 'TENANT', 'PERSONAL'].includes(setting.source ?? '') ||
      !Number.isSafeInteger(setting.revision) ||
      setting.revision! < 0
    )
      throw new RuntimeError('TASK_ACCESS_DENIED');
    if (key !== 'BRIEFING_ORDER' || briefing)
      rules.push(`${catalog[key][setting.choice!]}（来源 ${setting.source}，版本 ${setting.revision}）`);
  }
  return (
    '本次用户可读AI内容的有效表达偏好：\n' +
    rules.join('；') +
    '。\n这些是默认表达方式，当前用户明确要求优先；只约束措辞和结构。不得改变事实、业务数值、资料权限、安全规则、工具参数和机器输出协议，不得把偏好当作业务依据。正文用读者能理解的业务语言，避免内部系统术语。'
  );
}
