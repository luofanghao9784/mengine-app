import type { Chat, DemoState, Material, Space } from './model.ts';

export const workspaceKind = (space: Space) =>
  space.kind || (['sales', 'finance'].includes(space.id) ? 'department' : 'business');
export const workspaceKindName = {
  project: '项目工作空间',
  department: '部门工作空间',
  business: '业务工作空间',
};

// Fixed IDs make the one-time demo content upgrade safe to repeat without duplicating work.
function projectExamples(me: string) {
  const examples = [
    {
      id: 'project-delivery',
      name: '客户 A 交付项目',
      owner: '许然',
      members: [me, '陈言', '许然', '周宁'],
      description: '围绕客户 A 的试用与交付，汇集需求、实施计划和跨部门协作。',
      instructions:
        '优先使用本项目已确认的需求与实施计划。报价引用财务部门工作空间，新增方案先保存个人草稿，交付前确认范围和负责人。',
      goal: '完成客户 A 团队试用，交付实施方案与培训材料。',
      phase: '实施准备',
      targetDate: '2026-10-09',
      briefTitle: '客户 A 项目需求与验收范围',
      briefOwner: '陈言',
      brief:
        '一、项目目标\n让客户 A 的销售团队在统一空间完成客户跟进、方案生成与成果共享。\n\n二、验收范围\n10 位试用成员完成一次完整工作流程；交付配置说明、团队培训材料和试用反馈记录。\n\n三、职责分工\n陈言确认客户需求，许然组织试用与培训，周宁核对报价口径，业务负责人确认最终交付。\n\n四、验收依据\n由客户代表确认试用范围及问题清单；培训结束不自动代表全部验收通过。',
      planTitle: '客户 A 实施计划',
      plan: '一、实施安排\n9 月 21 日：核对资料与成员，冻结首轮试用范围。\n9 月 25 日：完成空间配置与演示流程走查。\n9 月 30 日：组织团队培训，收集试用反馈。\n10 月 9 日：交付确认版实施说明与培训材料。\n\n二、交付责任\n许然负责实施与培训，陈言负责客户沟通。报价依据由财务负责人单独确认。\n\n三、当前待确认\n等待客户提供试用名单；未取得名单前不标记培训准备完成。',
      draftTitle: '客户 A 培训与交付计划修订稿',
      extra:
        '四、本轮个人修订建议\n增加一场 30 分钟的资料共享实操；培训后收集三类反馈：资料查找、成果修改和协作交付。此补充尚未同步至项目确认版。',
      prompt: '结合项目验收范围，补充客户 A 的培训与交付安排，先留在我的个人空间。',
      refs: ['price'],
    },
    {
      id: 'project-launch',
      name: '秋季新品发布项目',
      owner: '陈言',
      members: [me, '陈言', '许然'],
      description: '让发布内容、销售准备和客户体验围绕同一个发布日期协同推进。',
      instructions:
        '围绕 10 月 15 日的发布目标组织工作，优先参考本项目产品卖点与发布计划。对外文案和承诺需负责人确认，工作草稿先保存在个人空间。',
      goal: '完成新品发布内容、销售话术与首批客户演示准备。',
      phase: '内容筹备',
      targetDate: '2026-10-15',
      briefTitle: '秋季新品定位与发布范围',
      briefOwner: '陈言',
      brief:
        '一、发布目标\n向现有客户说明新品的核心使用场景，邀请首批客户参与演示。\n\n二、重点信息\n统一表达产品适用人群、三项核心能力与试用方式；未经验证的能力不进入对外宣传。\n\n三、交付范围\n发布长图、产品介绍页、销售问答与客户演示脚本。\n\n四、协作分工\n陈言负责销售表达，许然验证演示与培训步骤，业务负责人确认最终发布内容。',
      planTitle: '秋季新品发布协作计划',
      plan: '一、里程碑\n9 月 25 日：确认产品卖点与内容提纲。\n10 月 5 日：完成介绍页与演示脚本初稿。\n10 月 12 日：组织内部彩排，核对销售问答。\n10 月 15 日：完成发布内容最终确认。\n\n二、交付清单\n一套介绍素材、一份演示脚本、一份销售问答。\n\n三、评审要求\n材料中的功能、试用条件与交付承诺由对应负责人核对后对外使用。',
      draftTitle: '新品演示脚本修订稿',
      extra:
        '四、本轮个人修订建议\n演示从“找到资料并生成客户方案”开始，再呈现团队共享与同事协作；结尾收集试用意向。此脚本仍待内部彩排。',
      prompt: '按照新品发布范围，梳理一版客户演示脚本和内容准备顺序。',
      refs: ['guide'],
    },
    {
      id: 'project-website',
      name: '官网改版项目',
      owner: me,
      members: [me, '许然'],
      description: '集中管理官网的信息结构、页面文案和验收事项，持续打磨客户访问体验。',
      instructions:
        '优先使用已确认的信息架构和页面清单。先澄清访问者与转化目标，再调整文案；页面发布和业务承诺需单独确认。',
      goal: '完成首页、解决方案页与联系入口的改版方案及验收清单。',
      phase: '方案评审',
      targetDate: '2026-10-23',
      briefTitle: '官网改版目标与页面清单',
      briefOwner: me,
      brief:
        '一、改版目标\n帮助来访者快速理解服务内容、适用场景与下一步联系方式。\n\n二、页面范围\n首页：定位、核心服务与联系入口。\n解决方案页：场景、实施步骤与交付内容。\n关于我们：团队职责与服务方式。\n\n三、内容原则\n使用清晰的中文表达，案例内容需有使用许可，不展示虚构客户背书。\n\n四、验收依据\n页面入口可达、文字层级一致、手机端无横向溢出，表单给出明确反馈。',
      planTitle: '官网改版评审与验收计划',
      plan: '一、推进计划\n9 月 24 日：确认信息架构和页面清单。\n10 月 2 日：完成首页与解决方案页文案。\n10 月 16 日：进行桌面与手机端页面走查。\n10 月 23 日：汇总验收问题并确认发布范围。\n\n二、验收重点\n导航与联系入口可用，服务范围表达准确，隐私说明和反馈信息完整。\n\n三、当前阶段\n信息结构正在评审，页面尚未发布；此空间记录方案与验收过程。',
      draftTitle: '官网首页文案与验收修订稿',
      extra:
        '四、本轮个人修订建议\n首屏明确服务对象与可交付内容；每个核心版块提供一个清晰的下一步入口，避免重复行动按钮。待评审后再同步到项目资料库。',
      prompt: '结合官网改版目标，准备首页文案结构，并列出需要一起检查的体验问题。',
      refs: [],
    },
  ];
  const spaces: Space[] = [];
  const materials: Material[] = [];
  const chats: Chat[] = [];
  const activities: DemoState['activities'] = [];
  for (const x of examples) {
    spaces.push({
      id: x.id,
      name: x.name,
      kind: 'project',
      description: x.description,
      instructions: x.instructions,
      owner: x.owner,
      members: [...new Set(x.members)],
      canEdit: true,
      project: { goal: x.goal, phase: x.phase, targetDate: x.targetDate },
    });
    const makeDoc = (
      suffix: string,
      title: string,
      space: string,
      content: string,
      owner: string,
      summary: string,
    ): Material => ({
      id: `${x.id}-${suffix}`,
      title,
      space,
      type: '文档',
      summary,
      status: '使用中',
      tags: [x.name],
      owner,
      visibility: space === 'personal' ? '仅自己' : '空间成员',
      relations: [],
      versions: [
        {
          id: `${x.id}-${suffix}-v1`,
          number: 1,
          content,
          summary,
          note: '项目演示初始版本',
          date: '2026-09-16',
        },
      ],
    });
    const brief = makeDoc(
      'brief',
      x.briefTitle,
      x.id,
      x.brief,
      x.briefOwner,
      `${x.goal}明确工作范围、职责与验收依据。`,
    );
    brief.confirmed = brief.versions[0].id;
    const plan = makeDoc(
      'plan',
      x.planTitle,
      x.id,
      x.plan,
      x.owner,
      `${x.name}的推进节点、交付清单与负责人，目标日期 ${x.targetDate}。`,
    );
    plan.versions.push({
      ...plan.versions[0],
      id: `${x.id}-plan-v2`,
      number: 2,
      note: '补充责任人与交付前确认事项',
      date: '2026-09-17',
    });
    plan.versions[0].content = x.plan.split('\n\n三、')[0];
    plan.confirmed = plan.versions[1].id;
    plan.relations = [brief.id, ...x.refs];
    const draft = makeDoc(
      'draft',
      x.draftTitle,
      'personal',
      `${x.plan}\n\n${x.extra}`,
      me,
      `${x.name}的个人修订建议，确认后可更新同一项目成果。`,
    );
    draft.sourceId = plan.id;
    draft.sourceVersion = plan.versions[1].id;
    draft.relations = [brief.id, plan.id, ...x.refs];
    materials.push(brief, plan, draft);
    chats.push({
      id: `${x.id}-chat`,
      title: x.draftTitle.replace('修订稿', ''),
      space: x.id,
      kind: 'normal',
      archived: false,
      messages: [
        { id: `${x.id}-m1`, role: 'user', text: x.prompt },
        {
          id: `${x.id}-m2`,
          role: 'assistant',
          text: `已参考「${x.briefTitle}」与确认版计划准备个人修订稿。项目目标是：${x.goal}你可以继续调整，再明确共享到项目空间。`,
          doc: draft.id,
          refs: draft.relations,
        },
      ],
    });
    activities.push({
      id: `${x.id}-activity`,
      space: x.id,
      text: `${x.owner}确认了「${x.planTitle}」v2，个人修订稿可继续讨论`,
      date: '今天 09:30',
    });
  }
  return { spaces, materials, chats, activities };
}

export function upgradeWorkspaceExamples(s: DemoState): DemoState {
  if ((s.workspaceExamplesVersion || 0) >= 1) return s;
  for (const space of s.spaces) {
    if (space.id === 'sales') {
      if (space.name === '销售空间') space.name = '销售部门工作空间';
      space.kind ??= 'department';
    }
    if (space.id === 'finance') {
      if (space.name === '财务空间') space.name = '财务部门工作空间';
      space.kind ??= 'department';
    }
  }
  const examples = projectExamples(s.profile.name);
  s.spaces = [...examples.spaces.filter((x) => !s.spaces.some((y) => y.id === x.id)), ...s.spaces];
  s.chats = [...examples.chats.filter((x) => !s.chats.some((y) => y.id === x.id)), ...s.chats];
  s.materials.push(...examples.materials.filter((x) => !s.materials.some((y) => y.id === x.id)));
  s.activities.push(...examples.activities.filter((x) => !s.activities.some((y) => y.id === x.id)));
  s.workspaceExamplesVersion = 1;
  return s;
}
