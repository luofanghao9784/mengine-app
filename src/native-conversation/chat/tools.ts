/** Plain-language names for DH 0.2.1 tools and the 梦擎 enterprise tools; unknown tools keep their own name. */
const labels: Record<string, string> = {
  enterprise_search: '检索企业资料',
  enterprise_read: '读取企业资料',
  enterprise_save: '保存为私人成果',
  enterprise_history: '读取旧会话记录',
  read: '读取文件',
  read_image: '查看图片',
  write: '写入文件',
  edit: '修改文件',
  str_replace_editor: '修改文件',
  glob: '查找文件',
  grep: '搜索文件内容',
  bash: '执行命令',
  web_search: '搜索网页',
  web_fetch: '读取网页',
  todo_write: '更新待办',
  present: '交付文件',
  skill: '加载技能',
  schedule_create: '创建定时任务',
  schedule_update: '修改定时任务',
  schedule_delete: '删除定时任务',
  schedule_list: '查看定时任务',
  job_list: '查看后台任务',
  job_output: '读取后台任务输出',
  job_kill: '停止后台任务',
  create_goal: '设定目标',
  update_goal: '更新目标',
  get_goal: '查看目标',
  session_search: '搜索会话',
  session_event_search: '搜索会话记录',
  session_event_read: '读取会话记录',
  ralph: '分轮推进任务',
  working_directory: '切换工作目录',
};
export const toolLabel = (name: string) => labels[name] ?? name;

/** Shows a short, readable summary of tool arguments instead of raw JSON where a field is obvious. */
export function toolSummary(name: string, args: string) {
  try {
    const value = JSON.parse(args) as Record<string, unknown>;
    const pick = (...keys: string[]) => keys.map((k) => value[k]).find((v) => typeof v === 'string' && v);
    const summary = pick(
      'query',
      'path',
      'file_path',
      'filename',
      'pattern',
      'url',
      'command',
      'title',
      'name',
    );
    if (typeof summary === 'string') return summary.length > 120 ? summary.slice(0, 120) + '…' : summary;
  } catch {
    /* fall through to the raw text */
  }
  return name === 'bash' ? args.slice(0, 120) : '';
}
