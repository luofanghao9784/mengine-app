const messages: Record<string, string> = {
  TENANT_SERVICE_SUSPENDED:
    '企业服务暂停，原执行已停止后续动作。已发生的结果仍需核对，恢复服务不会自动重跑本任务。',
  TASK_TENANT_EXIT: '企业退出已生效，任务已中断；已经发生的业务动作仍需按实际记录核对。',
  TASK_MEMBER_OFFBOARDED: '成员离职已生效，原执行授权已停止，任务不会自动恢复。',
  TASK_PLAN_STOPPED: '关联计划已暂停、停止或授权已变化，本次执行已中断。',
  TASK_PLAN_EXPIRED: '关联计划已到期，本次执行已中断。',

  TASK_STATE_CHANGED: '任务状态已变化，已刷新最新状态，请核对后操作。',
  CONVERSATION_BUSY: '本会话已有正在执行的任务，请先停止当前执行，再处理此卡片。',

  MODEL_NOT_CONFIGURED: '模型能力当前关闭，任务已保存。',
  TASK_INPUT_REQUIRED: '请补充本任务需要的信息后继续。',
  TASK_INPUT_LIMIT: '本任务补充信息已达到上限，请另行发起任务。',
  TASK_RESULT_UNKNOWN: '本次执行没有收到完整结果，需要先核对执行影响。',
  TASK_RESULT_RECONCILED: '已依据实际工具范围确认没有业务写入；原执行结果仍未知，可明确重试。',
  TASK_RECONCILIATION_REQUIRED: '现有执行证据不足，不能安全继续，任务保持待核对。',
  TASK_EXECUTION_MODE_CHANGED: '运行模式已变化，不能把联调任务直接切换为真实执行，请重新发起。',

  PUBLIC_WEB_NOT_CONFIGURED: '公开检索服务尚未配置，请联系管理员。',
  TASK_INTERRUPTED: '服务执行中断。可明确重试，系统不会自动重复执行。',
  TASK_SOURCE_UNAVAILABLE: '当前资料权限已变化，任务未交付结果。',
  TASK_FILE_UNSUPPORTED: '当前处理工具不支持这个文件格式。原件已保留，可下载或换用已支持的格式。',
  TASK_FILE_ENCODING: '文件不是有效的 UTF-8 文本，请转换编码后上传新版本。原件未被修改。',
  TASK_FILE_INVALID: '处理参数与文件不匹配，请核对列名、筛选条件或文稿行范围后重新发起任务。',
  TASK_FILE_LIMIT:
    '文件的行列、分组数量或处理结果超过当前工具上限。请缩小处理范围后重试，本次未交付部分结果。',
  TASK_FILE_DATA:
    '文件内容无法按要求完整处理。请检查表格结构、空值和数字格式；公式、金额符号、千分位等不会自动作为数字计算。',
  TASK_TOOL_FAILED: '工具未能完成任务，本次没有交付成功结果。可以调整要求后重新发起。',
  PUBLIC_SEARCH_REQUIRED: '本次要求联网查证，但尚未完成搜索与原文阅读。请重试或取消联网要求。',
  PUBLIC_QUERY_DENIED: '检索词包含不适合公开发送的信息，未执行外部检索。',
  PUBLIC_QUERY_PRIVATE_CONTENT: '检索词涉及内部资料或个人信息，未执行外部检索。',
  TASK_LIMIT: '本次处理达到系统执行上限，未能完成回答。你可以再次尝试。',
};
export const taskErrorMessage = (code: string) => messages[code] ?? '执行服务暂不可用，请稍后重试。';
