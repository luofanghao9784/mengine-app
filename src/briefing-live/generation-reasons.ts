/** Shared explanations for the server's checks before an automatic analysis starts. */
export const businessReadinessReasons: Record<string, string> = {
  WORK_GOAL_REQUIRED: '请先填写岗位职责或经营目标，保存后会继续分析。',
  SOURCE_GOVERNANCE_REQUIRED: '来源口径尚未发布或已经变化，请先完成治理确认。',
  SOURCE_FIELDS_UNCONFIRMED: '来源仍有字段口径待确认，请在数据基座核对字段依据。',
  SOURCE_CONSTRAINTS_REQUIRED: '缺少来源约束，请补齐检查范围后继续。',
  SOURCE_RECEIPT_REQUIRED: '缺少当前批次的有效采集核验，请等待来源重新采集。',
  SOURCE_VALIDATION_FAILED: '当前批次未通过来源规则检查，请在数据基座查看问题。',
  SOURCE_RELATION_UNVERIFIED: '来源关联尚未通过核验，请先核对关联数据。',
  SOURCE_ANALYSIS_PLAN_INVALID: '固定统计方法与当前字段口径不符，需要维护者核对配置。',
  SOURCE_COVERAGE_TOO_OLD: '来源覆盖时间不足以支持本次分析，请等待更新。',
  ANALYSIS_RETRY_REQUIRED: '同一批数据的上次分析未完成，请先查看失败原因，再明确重试。',
};
