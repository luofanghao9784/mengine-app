/** Required path for successfully published data; exceptions stay within these stages. */
export const flowStages = [
  { id: "received", label: "数据接入", title: "接收资料 · 建立处理任务" },
  { id: "parsing", label: "内容解析", title: "解析正文 · 识别知识结构" },
  { id: "scanning", label: "治理校验", title: "治理扫描 · 检查敏感内容" },
  { id: "published", label: "知识发布", title: "知识已发布 · 指标同步更新" },
] as const;
export type StageId = typeof flowStages[number]["id"];
export type StageState = "waiting" | "current" | "done" | "skipped" | "blocked" | "failed" | "unknown" | "stopped" | "rejected";
export type Stage = { id: StageId; label: string; title: string; state: StageState; status: string; description: string; at?: string };
export type FlowRecord = { seq: number; event: string; status: string; at: string };
export type FlowTaskState = {
  structured?: {total:number|null;ready:number|null;isolated:number|null;fields:number;dictionary:string;generatedAt?:string;warnings:number;run:string;runAt?:string};
  status: string; phase: string; events: FlowRecord[]; milestones?: FlowRecord[];
  permissionReview?: { state: string; count: number; requestedAt?: string; resolvedAt?: string };
};

/** Real steps are evidence-driven; selecting a step never advances the business task. */
export function realWorkflow(item?: FlowTaskState, live = true) {
  const stages: Stage[] = flowStages.map(stage => ({ ...stage, state: "waiting", status: live ? "等待任务" : "等待同步", description: live ? "导入资料后开始追踪当前授权范围内的任务。" : "连接恢复后重新校验权限与服务端状态。" }));
  let current: StageId | null = null;
  const set = (id: StageId, state: StageState, status: string, description: string, at?: string) => Object.assign(stages.find(step => step.id === id)!, { state, status, description, at });
  if (!item || !live) return { stages, current };
  if(item.structured){
    const s=item.structured,records=item.milestones||item.events;
    const at=(event:string)=>records.filter(r=>r.event===event).sort((a,b)=>b.seq-a.seq)[0]?.at;
    Object.assign(stages[0],{label:'结构入库',title:'源结构已保存'});
    Object.assign(stages[1],{label:'记录校验',title:'逐行校验 · 隔离异常记录'});
    Object.assign(stages[2],{label:'AI 字段与口径',title:'模型学习 · 生成只读业务口径'});
    Object.assign(stages[3],{label:'受控使用',title:'结构化数据 · 按权限使用'});
    set('received','done','结构已保存',`已保存 ${s.fields} 个源字段；这是当前结构状态，不代表持续同步外部数据库。`,at('structure-stored'));
    set('parsing',s.isolated?'blocked':s.total?'done':'waiting',s.total===null?'按权限隐藏':s.isolated?`${s.isolated} 条已隔离`:s.total?`${s.ready} 条可用`:'等待数据记录',s.total===null?'记录数量仅向具有内容权限的账号开放。':`当前 ${s.total} 条记录，${s.ready} 条可用，${s.isolated} 条隔离。校验类型、必填、唯一性等规则；不补造历史阶段时间。`,at('records-checked'));
    const queued=s.run==='dictionary-queued',syncing=s.run==='sync-started',running=s.run==='dictionary-generating',failed=['dictionary-failed','dictionary-interrupted'].includes(s.run),generated=s.dictionary==='generated';
    set('scanning',running||queued?'current':failed?'failed':generated?'done':'waiting',queued?'后台排队中':running?'模型生成中':failed?'生成未完成':generated?'已自动生效':s.dictionary==='changed'?'口径待更新':'等待模型生成',queued?'数据已保存并校验，模型任务已自动排队，关闭页面不会中止任务。':running?'模型正在分析源结构和注释，生成字段解释、口径与关联；无需人工审批。':failed?'本次生成失败或服务重启中断。原始记录和历史口径保留，可在数据底座重新生成。':generated?`模型口径已生效；${s.warnings?`${s.warnings} 项关联或查询规则未纳入，详情见数据底座。`:'已通过格式、字段和授权校验。'}不等于业务事实已被核验。`:'导入和质量校验完成后自动进入后台生成队列；历史数据可在数据底座重新生成。',running||failed?s.runAt:s.generatedAt);
    set('published',item.status==='ready'?'done':'blocked',item.status==='ready'?'授权查询已开放':'当前不可查询',item.status==='ready'?`基础记录已按当前权限开放，隔离记录不向普通读者开放。${generated?'Agent 可使用已生效的模型口径。':'模型口径尚未就绪，不能视为已完成 AI 学习。'}数据表不会自动成为 Wiki 知识正文。`:'资料状态未开放，模型结果不会绕过归档、治理或权限约束。');
    current=running||queued||failed||!generated?'scanning':s.isolated?'parsing':'published';
    if(syncing){current='received';set('received','current','源库同步中','正在只读获取源表，完成校验后原子更新；同步期间保留上次可用数据。',s.runAt);}
    if(s.run==='sync-failed'){current='received';set('received','failed','同步失败','本次同步未覆盖数据，上次可用快照保留。请检查连接与同步任务记录。',s.runAt);}
    if(item.status==='archived'){current=null;for(const stage of stages)Object.assign(stage,{state:'stopped',status:'已停止追踪',description:'数据集已归档，历史记录不代表当前可查询。'});}
    return {stages,current};
  }
  const records = item.milestones || item.events;
  const latest = (...names: string[]) => records.filter(record => names.includes(record.event)).sort((a, b) => b.seq - a.seq)[0];
  const received = latest("received", "retry"), parsed = latest("parsing"), scan = latest("scanning");
  const published = latest("published", "remediated", "edited", "rescanned");
  const ready = item.status === "ready", isolated = item.status === "quarantined";
  const processing = ["queued", "processing"].includes(item.status);
  const stopped = item.status === "archived", failed = item.status === "failed";
  for (const [id, event] of [["received", received], ["parsing", parsed], ["scanning", scan]] as const) {
    const active = item.phase === id;
    const notReached = !event && (processing || failed);
    set(id, active ? "current" : event ? "done" : notReached ? "waiting" : "unknown",
      active ? id === "received" ? "已接收 · 排队中" : "处理中" : event ? "已确认" : notReached ? "尚未执行" : "无历史记录",
      active ? ({ received: "原件已保存，等待解析任务执行。", parsing: "正在提取正文与文档结构，发布前不开放阅读与检索。", scanning: "正在检查敏感内容、业务标签与复核日期。" }[id]) : event ? "该阶段已由服务端记录，可查看下方确认时间。" : notReached ? "前序阶段尚未完成，本阶段没有执行记录。" : "没有独立的阶段记录，不补造处理时间或历史结果。", event?.at);
    if (active) current = id;
  }
  set("published", ready ? "done" : isolated || failed ? "blocked" : "waiting", ready ? "当前已发布" : isolated || failed ? "发布已阻断" : "等待上游完成",
    ready ? "内容按当前岗位、部门、密级及文档授权开放；指标仅统计当前账号可读的已发布资料。" : "只有解析与治理校验完成，且风险已处理后才开放阅读和检索。", ready ? published?.at : undefined);
  if (isolated) {
    current = "scanning";
    set("scanning", "blocked", "未通过 · 已隔离", "治理校验发现敏感内容，资料已隔离，等待授权治理人员处理；复核通过后才能发布。", latest("quarantined")?.at);
  }
  if (ready) {
    current = "published";
    const reviewed = latest("remediated", "rescanned");
    if (reviewed) set("scanning", "done", "复核已通过", "治理复核已通过，按既有规则恢复或保持发布。复检不改写来源正文；仍存在敏感问题时保持隔离。", reviewed.at);
  }
  if (failed) {
    current = scan && (!parsed || scan.seq > parsed.seq) ? "scanning" : "parsing";
    set(current, "failed", "处理失败", "后续阶段已停止，可由有管理权限的成员在资料库查看原因并重试。", latest("failed")?.at);
  }
  if (stopped) {
    current = null;
    for (const stage of stages) { if (stage.state !== "done") Object.assign(stage, { state: "stopped", status: "已停止追踪", description: "资料已归档，已退出阅读与检索。历史记录不代表当前仍可用。" }); }
    set("published", "stopped", "已退出检索", "资料已归档，发布与检索已停止。", latest("archived")?.at);
  }
  return { stages, current };
}
