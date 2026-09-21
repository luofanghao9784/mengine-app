import {
  addChat,
  addMessage,
  activity,
  createMaterial,
  latest,
  today,
  uid,
  type DemoState,
  type Material,
} from './model.ts';

export const COLLEAGUE_LABEL = '同事智能体';
export const departments = [
  { id: 'business', name: '业务团队', parent: '', description: '从客户需求到服务交付，让合作持续向前。' },
  { id: 'sales-team', name: '销售部', parent: 'business', description: '负责客户沟通、需求梳理与合作方案。' },
  { id: 'success-team', name: '客户成功', parent: 'business', description: '负责团队试用、培训与交付跟进。' },
  { id: 'finance-team', name: '财务部', parent: '', description: '维护财务口径，支持业务分析与经营决策。' },
];
export const colleagues = [
  {
    id: 'zhou',
    name: '周宁',
    department: 'finance-team',
    role: '财务负责人',
    about: '负责经营数据分析、服务定价与财务资料维护。',
    initials: '周',
  },
  {
    id: 'chen',
    name: '陈言',
    department: 'sales-team',
    role: '客户顾问',
    about: '把客户沟通整理为清晰需求，帮助团队接续合作。',
    initials: '陈',
  },
  {
    id: 'xu',
    name: '许然',
    department: 'success-team',
    role: '客户成功顾问',
    about: '负责客户试用与团队培训，推动方案落地。',
    initials: '许',
  },
  {
    id: 'me',
    name: '曹鸿健',
    department: 'sales-team',
    role: '业务负责人',
    about: '负责客户合作方案与团队业务协作。',
    initials: '曹',
  },
];
export const capabilities = [
  {
    id: 'finance-report',
    colleague: 'zhou',
    name: '月度经营报表',
    description: '汇总收入、成本与业务变化，交付一份有口径的经营简报。',
    inputs: '月份、业务范围和使用目的',
    output: '经营数据汇总与解读',
    source: '财务侧合成月度数据；不交付底层明细',
  },
  {
    id: 'pricing',
    colleague: 'zhou',
    name: '服务报价说明',
    description: '结合现有服务价格表，梳理适用条件与需确认的报价事项。',
    inputs: '服务范围、月份和使用目的',
    output: '报价口径与待确认事项',
    source: '当前可见的服务价格表',
  },
  {
    id: 'requirements',
    colleague: 'chen',
    name: '客户需求梳理',
    description: '整理目标、优先级和待澄清问题，方便团队继续推进。',
    inputs: '业务范围、月份和使用目的',
    output: '需求概要与澄清清单',
    source: '合成客户需求场景',
  },
  {
    id: 'training',
    colleague: 'xu',
    name: '团队试用计划',
    description: '将试用目标拆成准备、体验与复盘三个阶段。',
    inputs: '试用范围、月份和使用目的',
    output: '试用安排与培训计划',
    source: '合成团队试用场景',
  },
  {
    id: 'proposal-help',
    colleague: 'me',
    name: '合作方案准备',
    description: '结合业务目标，准备实施安排与交付内容。',
    inputs: '合作范围、月份和使用目的',
    output: '合作方案草稿',
    source: '合成合作方案场景',
  },
];
export type CollaborationStatus =
  | 'draft'
  | 'pending'
  | 'changes_requested'
  | 'authorized'
  | 'review'
  | 'delivered'
  | 'rejected'
  | 'cancelled';
export type Brief = { month: string; scope: '公司整体' | '销售业务'; purpose: string };
export type Collaboration = {
  id: string;
  chatId: string;
  capabilityId: string;
  colleagueId: string;
  requester: string;
  status: CollaborationStatus;
  brief: Brief;
  authorizedBrief?: Brief;
  revision: number;
  feedback?: string;
  draftContent?: string;
  resultDocId?: string;
  events: { id: string; actor: string; text: string; date: string }[];
};
export const collaborationStatus: Record<CollaborationStatus, string> = {
  draft: '待补充需求',
  pending: '等待同事授权',
  changes_requested: '需要补充',
  authorized: '已授权，待生成',
  review: '等待交付确认',
  delivered: '已交付',
  rejected: '未获授权',
  cancelled: '已取消',
};
export const isCollaborationOpen = (r: Collaboration) =>
  !['delivered', 'rejected', 'cancelled'].includes(r.status);
export const colleagueName = (s: DemoState, id: string) =>
  id === 'me' ? s.profile.name : colleagues.find((c) => c.id === id)?.name || '同事';
export const colleagueSpaceIds = (s: DemoState, id: string) =>
  s.spaces
    .filter((space) => space.members.includes(colleagueName(s, id)) && space.members.includes(s.profile.name))
    .map((space) => space.id);
export function departmentIncludes(parent: string, child: string): boolean {
  if (parent === 'all' || parent === child) return true;
  const node = departments.find((d) => d.id === child);
  return !!node?.parent && departmentIncludes(parent, node.parent);
}
// This is a view over existing materials, not a second library or a security boundary.
export function colleagueMaterials(s: DemoState, id: string): Material[] {
  const name = colleagueName(s, id);
  return s.materials.filter((d) => {
    const space = s.spaces.find((x) => x.id === d.space);
    return (
      d.owner === name &&
      !!space &&
      space.members.includes(s.profile.name) &&
      (d.visibility === '空间成员' || (d.visibility === '仅空间负责人' && space.owner === s.profile.name))
    );
  });
}
function event(s: DemoState, r: Collaboration, actor: string, text: string) {
  r.events.push({
    id: uid(),
    actor,
    text,
    date: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
  });
  const chat = s.chats.find((c) => c.id === r.chatId);
  if (chat) addMessage(chat, 'assistant', `${actor}：${text}`);
}
export function startCollaboration(s: DemoState, capabilityId: string, chatId?: string, prompt?: string) {
  const capability = capabilities.find((c) => c.id === capabilityId);
  if (!capability) throw new Error('这项能力暂不可用');
  let chat = chatId ? s.chats.find((c) => c.id === chatId) : undefined;
  // Reopening a prepared request in the same conversation does not duplicate it.
  const existing = s.collaborations.find(
    (r) => r.chatId === chat?.id && r.capabilityId === capabilityId && isCollaborationOpen(r),
  );
  if (existing) return existing;
  chat ||= addChat(
    s,
    `与${colleagueName(s, capability.colleague)}协作 · ${capability.name}`,
    'none',
    'colleague',
  );
  const r: Collaboration = {
    id: uid(),
    chatId: chat.id,
    capabilityId,
    colleagueId: capability.colleague,
    requester: s.profile.name,
    status: 'draft',
    revision: 1,
    brief: { month: '2026-08', scope: '公司整体', purpose: '用于月度经营复盘' },
    events: [],
  };
  if (prompt) updateBriefFromText(r, prompt);
  s.collaborations.unshift(r);
  if (!chat.messages.length)
    addMessage(
      chat,
      'user',
      `请${colleagueName(s, capability.colleague)}的智能体协助准备${capability.name}。`,
    );
  event(
    s,
    r,
    'AI 助手',
    `已准备${capability.name}的协作需求卡。补齐需求后发送给${colleagueName(s, capability.colleague)}，对方授权后开始处理。`,
  );
  return r;
}
export function updateBriefFromText(r: Collaboration, text: string) {
  if (!['draft', 'changes_requested'].includes(r.status)) return;
  const month = text.match(/(20\d{2})[-年\/](\d{1,2})/) || text.match(/(?:^|\D)(\d{1,2})月/);
  if (month) {
    const y = month.length === 3 ? month[1] : r.brief.month.slice(0, 4);
    const m = Number(month.length === 3 ? month[2] : month[1]);
    if (m >= 1 && m <= 12) r.brief.month = `${y}-${String(m).padStart(2, '0')}`;
  }
  if (/销售/.test(text)) r.brief.scope = '销售业务';
  if (/全公司|公司整体/.test(text)) r.brief.scope = '公司整体';
  r.brief.purpose = text.slice(0, 500);
}
export function submitCollaboration(s: DemoState, id: string, brief: Brief) {
  const r = s.collaborations.find((x) => x.id === id);
  if (
    !r ||
    !['draft', 'changes_requested'].includes(r.status) ||
    !/^20\d{2}-(0[1-9]|1[0-2])$/.test(brief.month) ||
    !['公司整体', '销售业务'].includes(brief.scope) ||
    !brief.purpose.trim()
  )
    return false;
  if (r.status === 'changes_requested') r.revision++;
  r.brief = { ...brief, purpose: brief.purpose.trim().slice(0, 500) };
  r.status = 'pending';
  r.feedback = undefined;
  event(
    s,
    r,
    r.requester,
    `已发送第 ${r.revision} 版需求：${r.brief.month} · ${r.brief.scope} · ${r.brief.purpose}。等待同事授权。`,
  );
  return true;
}
export type CollaborationAction = 'authorize' | 'clarify' | 'reject' | 'generate' | 'deliver' | 'cancel';
export function actOnCollaboration(
  s: DemoState,
  id: string,
  action: CollaborationAction,
  actor: 'requester' | 'receiver',
  note = '',
) {
  const r = s.collaborations.find((x) => x.id === id);
  if (!r || !isCollaborationOpen(r)) return false;
  const name = colleagueName(s, r.colleagueId);
  const cap = capabilities.find((c) => c.id === r.capabilityId)!;
  if (action === 'cancel' && actor === 'requester') {
    r.status = 'cancelled';
    r.draftContent = undefined;
    event(s, r, r.requester, '已取消协作，未交付的结果不进入资料库。');
    return true;
  }
  if (actor !== 'receiver') return false;
  if (action === 'clarify' && r.status === 'pending' && note.trim()) {
    r.status = 'changes_requested';
    r.feedback = note.trim().slice(0, 500);
    event(s, r, `${name} · 演示`, `请补充需求：${r.feedback}`);
  } else if (action === 'reject' && r.status === 'pending') {
    r.status = 'rejected';
    r.feedback = note.trim() || '当前请求未获授权，可与负责人明确范围后重新发起。';
    event(s, r, `${name} · 演示`, r.feedback);
  } else if (action === 'authorize' && r.status === 'pending') {
    r.authorizedBrief = structuredClone(r.brief);
    r.status = 'authorized';
    event(s, r, `${name} · 演示`, `已授权本次${cap.name}，仅限第 ${r.revision} 版需求。交付前仍需确认。`);
  } else if (action === 'generate' && r.status === 'authorized' && r.authorizedBrief) {
    r.draftContent = prepareResult(r);
    r.status = 'review';
    event(s, r, `${name}的智能体 · 演示`, '结果已生成，等待负责人审阅交付。请求方尚不可见结果正文。');
  } else if (action === 'deliver' && r.status === 'review' && r.draftContent && r.authorizedBrief) {
    const doc = createMaterial(
      s,
      `${r.authorizedBrief.month} ${cap.name}`,
      r.draftContent,
      `${name}确认交付的${cap.output}，范围：${r.authorizedBrief.scope}。合成演示数据。`,
    );
    doc.confirmed = latest(doc).id;
    doc.tags = ['同事协作', name];
    r.resultDocId = doc.id;
    r.status = 'delivered';
    event(
      s,
      r,
      `${name} · 演示`,
      `已确认并交付给${r.requester}，结果保存到请求方的个人空间。原始资料权限保持不变。`,
    );
    const chat = s.chats.find((c) => c.id === r.chatId);
    if (chat)
      addMessage(chat, 'assistant', '协作成果已送达，你可以预览、继续修改，或明确共享给团队。', doc.id);
    activity(s, 'personal', `${name}交付了「${doc.title}」`);
  } else return false;
  return true;
}
function prepareResult(r: Collaboration) {
  const b = r.authorizedBrief!;
  const cap = capabilities.find((c) => c.id === r.capabilityId)!;
  let content = '';
  if (r.capabilityId === 'finance-report') {
    const revenue = b.scope === '销售业务' ? 180000 : 240000;
    const cost = b.scope === '销售业务' ? 108000 : 156000;
    content = `二、经营汇总\n营业收入：${revenue.toLocaleString('zh-CN')} 元\n对应成本：${cost.toLocaleString('zh-CN')} 元\n毛利：${(revenue - cost).toLocaleString('zh-CN')} 元\n毛利率：${Math.round(((revenue - cost) / revenue) * 100)}%\n\n三、解读与下一步\n建议结合项目进度复核收入确认时点，并跟进成本构成。以上为固定合成样例，随业务范围变化，用于演示报表交付流程，不代表真实经营结果。`;
  } else if (r.capabilityId === 'pricing') {
    content =
      '二、报价口径\n基础服务包括企业资料梳理与团队培训。实施服务按空间及业务复杂度评估。\n\n三、待确认事项\n确认服务人数、工作空间和交付清单后，由负责人核定最终金额。此演示不生成有约束力的报价。';
  } else if (r.capabilityId === 'training') {
    content =
      '二、试用安排\n准备：明确试用目标、参与成员与所需资料。\n体验：完成一项真实工作并记录反馈。\n复盘：检查成果是否可复用，安排后续培训。\n\n三、交付清单\n试用步骤、反馈记录和培训安排。';
  } else {
    content =
      '二、工作建议\n明确业务目标与使用人，梳理已有资料和待澄清问题。\n按需求确认、方案准备、体验反馈三个阶段推进。\n\n三、交付清单\n目标说明、需求优先级与下一步负责人。';
  }
  return `一、请求与口径\n月份：${b.month}\n业务范围：${b.scope}\n用途：${b.purpose}\n交付内容：${cap.output}\n\n${content}\n\n四、交付说明\n本结果使用合成演示资料，由接收方确认后交付。仅提供本次请求的汇总结果，不包含底层明细、私人会话或个人记忆。\n生成日期：${today()}`;
}
