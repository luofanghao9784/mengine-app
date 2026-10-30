import { roleLabel } from '../identity/role-labels.ts';
import { auditActions } from '../tenant/audit-labels.ts';

/** Display-only whitelist. Never use these labels for permissions or request values. */
export const recordLabels: Readonly<Record<string, string>> = {
  '9POP': '9POP',
  '9POP 管理系统': '9POP 管理系统',
  businessConfirmed: '业务已确认收款（收款日期）',
  financeConfirmedByReceiptDate: '其中：财务已核对（收款日期）',
  financeReviewedByReviewDate: '期间完成财务核对（核对日期）',
  cashRefund: '已知现金退款（出款日期）',
  voucher_uploaded: '凭证已上传，交郑西核对',
  confirmed_pending_voucher: '成交教练补凭证，店长负责',
  finance_rejected: '财务退回，店长与财务核对',
  PARENT_CANCELED_OR_DELETED: '主订单已取消或删除，保留历史并排除有效金额',
  PARENT_UNAVAILABLE: '获准快照内找不到主订单',
  REFUND_PAYOUT_UNKNOWN: '实际出款未知，由郑西后续补证',
  REFUND_PAYMENT_DATE_MISSING_OR_INVALID: '退款出款日期缺失或无效',
  RECEIPT_DATE_MISSING_OR_INVALID: '收款日期缺失或无效',
  REFUND_APPLIED_DATE_MISSING_OR_INVALID: '退款处理日期缺失或无效',
  ORDER_RELATION_UNPROVEN: '退款关联订单尚不能唯一确认',
  ZERO_CASH_SETTLEMENT: '零现金结算，不计现金退款',
  REFUND_NOT_APPLIED: '退款尚未处理完成',
  STATUS_NOT_INCLUDED: '状态未纳入金额口径',
  funnel_stage: '线索漏斗阶段',
  internal_material: '内部资料',
  INPUT: '输入',
  PROCESS: '处理',
  OUTPUT: '输出',
  ENGINE: '引擎',
  EVOLUTION: '自进化',
  EVOLVE: '自进化',
  部署治理: '来源',
  'Codex-CT027-B': '总部整理',
  'Codex-CT027-B（部署治理）': '总部整理',
  '来源 Codex-CT027-B（部署治理）': '总部整理',
  'synth_demo.sqlite 字段说明 v1': '演示数据字段说明 · 第 1 版',
  TEXT: '文字',
  TABLE: '表格',
  OCR: '识别文字',
  text: '文字',
  string: '文字',
  number: '数字',
  integer: '整数',
  boolean: '是否',
  date: '日期',
  datetime: '日期时间',
  timestamp: '日期时间',
  id: '编号',
  content: '正文',
  locator: '原文位置',
  method: '解析方式',
  page: '页码',
  amount: '金额',
  amount_cents: '金额（分）',
  status: '状态',
  SOURCE_COLUMN: '来源原有字段',
  PARSER_OUTPUT: '解析生成字段',
  SOURCE_METADATA: '来源追溯字段',
  SOURCE_DOCUMENTED: '来源有据',
  MODEL_DETERMINED: '模型判定',
  DEPLOYMENT_INFERRED: '部署推断',
  UNKNOWN: '尚不明确',
  WAITING_MODEL: '等待模型',
  VALIDATING: '校验中',
  DRAFT_READY: '草稿完成',
  KEEP_SOURCE_DOCUMENTED: '保留来源说明',
  CORRECT: '调整口径',
  DATASET: '数据表',
  MATERIAL: '内部资料',
  READY: '已完成',
  PARTIAL: '部分完成',
  WAITING: '尚未完成',
  NOT_STARTED: '尚未开始',
  QUEUED: '排队中',
  RUNNING: '处理中',
  FAILED: '失败',
  UNSUPPORTED: '格式不支持',
  CANCELLED: '已取消',
  ATTENTION: '需核对',
  CHECKED: '已检查',
  SUCCEEDED: '已完成',
  INTERRUPTED: '已中断',
  NOT_PUBLISHED: '尚未发布',
  PUBLISHED: '已发布',
  ARCHIVED: '已下架',
  STALE: '来源已变化',
  queued: '排队中',
  running: '生成中',
  retry_wait: '等待重试',
  succeeded: '已完成',
  failed: '失败',
  received: '接入',
  parsing: '解析中',
  scanning: '检查中',
  published: '已发布',
  quarantined: '已隔离',
  retry: '重新解析',
  resumed: '已恢复',
  edited: '已更新',
  rescanned: '已复检',
  remediated: '治理处理完成',
  'dictionary-queued': '口径已排队',
  'dictionary-generating': '模型生成口径',
  'dictionary-generated': '口径已生效',
  'dictionary-failed': '口径生成失败',
  'dictionary-interrupted': '口径任务中断',
  'sync-started': '取数开始',
  'sync-completed': '取数完成',
  'sync-failed': '取数失败',
  'structure-stored': '结构已保存',
  'records-checked': '记录已检查',
};
export const actionLabels: Readonly<Record<string, string>> = {
  ...auditActions,
  PERMISSION_CHANGE: '修改权限',
  PERMISSION_IMPACT: '权限变更影响',
  ROLE_GRANT_REVOKED: '调岗撤销个人授权',
  MATERIAL_UPLOAD: '上传文件',
  MATERIAL_VERSION: '上传新版本',
  MATERIAL_DOWNLOAD: '下载文件',
  MATERIAL_PREVIEW: '预览文件',
  PERMISSION_MODEL_MIGRATION: '权限规则迁移',
  MATERIAL_TRASH: '删除文件',
  MATERIAL_RESTORE: '恢复文件',
  MATERIAL_CITATION_READ: '查看引用片段',
  TASK_ORIGINAL_READ: 'AI 读取原件',
  MATERIAL_FOLDER_CREATE: '创建文件夹',
  MATERIAL_MOVE: '移动资料',
  MOVE_PERMISSION_CHANGE: '移动引起的权限变化',
  REQUEST_DOWNLOAD: '下载请求',
  REQUEST_READ: '阅读请求',
  REQUEST_PERMISSIONS: '权限请求',
  REQUEST_PREVIEW: '预览请求',
  REQUEST_MOVE: '移动请求',
  REQUEST_AUDIT_READ: '查看操作记录',
  'deployment.governance.applied': '更新数据口径',
  'database.pulled': '更新数据',
  allow: '确认可以提供',
  retry: '重试解析',
  dictionary: '重新生成口径',
  recheck: '重新校验',
  remediate: '规则治理',
  analyze: '智能研判',
  sync: '立即取数',
  handle: '记录处理措施',
  approve: '人工校验通过',
  定期同步更新: '定期同步更新',
  数据库快照拉取: '数据库快照拉取',
  人工校验通过: '人工校验通过',
  记录处理措施: '记录处理措施',
  SYNC_INPUTS: '同步数据口径',
  GENERATE_METRICS: '生成指标草稿',
  '/scene-knowledge/sync': '整理知识',
};
const own = (dictionary: Readonly<Record<string, string>>, value?: string | null) =>
  value && Object.hasOwn(dictionary, value) ? dictionary[value] : undefined;

export function versionLabel(value: number | string | null | undefined): string {
  const digits = String(value ?? '').match(/^(?:v)?(\d+)$/)?.[1];
  return digits ? `第 ${Number(digits)} 版` : '尚无版本';
}
export function settingsLabel(value: number): string {
  return value === 0 ? '尚未修改过设置，按企业分别保存。' : `${versionLabel(value)}设置，按企业分别保存。`;
}
export function timeZoneLabel(value?: string): string {
  return value === 'Asia/Shanghai' ? '北京时间' : '其他记录';
}

/** Prose/title boundary: normalize approved legacy copy and versions, conceal unknown machine tokens. */
export function displayText(value?: string | null): string {
  if (!value) return '';
  const exact = own(recordLabels, value);
  if (exact) return exact;
  return value
    .replace(/synth_demo\.sqlite 字段说明 v1/g, '演示数据字段说明 · 第 1 版')
    .replace(/来源\s*Codex-CT027-B（部署治理）/g, '总部整理')
    .replace(/专业\s*DLP\s*检查/g, '专业防泄密检查')
    .replace(/OCR\s*文字需核对原件/g, '识别出的文字需核对原件')
    .replace(/Asia\/Shanghai/g, '北京时间')
    .replace(/(来源|知识|权限|口径|源数据)\s+v(\d+)\b/g, (_, label, n) => `${label}${versionLabel(n)}`)
    .replace(/(^|[^a-zA-Z0-9_])v(\d+)\b/g, (_, before, n) => `${before}${versionLabel(n)}`)
    .replace(
      /[A-Za-z0-9]*[A-Za-z][A-Za-z0-9_.:/-]*/g,
      (token) => own(recordLabels, token) ?? (token === 'AI' ? 'AI' : '其他记录'),
    );
}
export function recordLabel(code?: string | null, metadata?: { title?: string | null }): string {
  return metadata?.title?.trim() ? displayText(metadata.title) : (own(recordLabels, code) ?? '其他记录');
}
export function actionLabel(code?: string | null, metadata?: { title?: string | null }): string {
  return metadata?.title?.trim() ? displayText(metadata.title) : (own(actionLabels, code) ?? '其他操作');
}
/** Human field labels are titles; never fall back to the technical field name. */
export function fieldLabel(code?: string | null, title?: string | null): string {
  return recordLabel(code, { title: title || (code && /[\u3400-\u9fff]/.test(code) ? code : undefined) });
}

export function auditDetail(action: string, detail?: string | null): string {
  if (action === 'deployment.governance.applied') {
    const count = detail?.match(/(?:全量)?检查\s*(\d+)\s*条/)?.[1];
    return count ? `检查 ${count} 条，异常记录已隔离` : '异常记录已隔离';
  }
  return displayText(detail);
}
/** Deployment identifiers are omitted as whole blocks, including unknown future package IDs. */
export function isDeploymentIdentifier(value: string | readonly string[]): boolean {
  const parts = typeof value === 'string' ? [value] : value;
  const identifier = /^部署\s+[A-Za-z0-9_-]+(?:\s|$|[；;])/;
  return parts.some((part) => identifier.test(part)) || identifier.test(parts.join(' '));
}
export function classificationLabel(value: number): string {
  return ['公开', '企业内部', '机密', '严格受限'][value] ?? '其他记录';
}

type ActorIdentity = Parameters<typeof roleLabel>[0];
export function actorLabel(name: string, identity: ActorIdentity = {}): string {
  if (['系统', 'system', 'SYSTEM', '系统自动操作', '自动任务'].includes(name)) return '系统';
  // Older audit payloads append role codes to a display name. Only remove that suffix;
  // never trim, split on spaces, or otherwise shorten the actual displayName.
  const suffix = name.match(/^(.*?)[（(]([A-Za-z0-9_+]+)[）)]$/s);
  const match =
    suffix &&
    suffix[2]
      .split('+')
      .every((code) => /^[A-Z][A-Z0-9_]*$/.test(code) || ['owner', 'can_maintain'].includes(code))
      ? suffix
      : null;
  const displayName = match ? match[1] : name;
  const codes = match?.[2].split('+') ?? [];
  const label = roleLabel({
    role: codes.find((code) => code !== 'owner' && code !== 'can_maintain'),
    owner: codes.includes('owner') || undefined,
    platformAdmin: codes.includes('PLATFORM_ADMIN') || undefined,
    canMaintain: codes.includes('can_maintain') || undefined,
    ...identity,
  });
  return label ? `${displayName}（${label}）` : displayName;
}
