const messages: Record<string, string> = {
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
  TASK_LIMIT: '任务达到本次执行上限，未交付成功结果。可以缩小要求后重新发起。',
};
export const taskErrorMessage = (code: string) => messages[code] ?? '执行服务暂不可用，请稍后重试。';
