import { addMessage, createMaterial, latest, type Chat, type DemoState } from './model.ts';
import { canReadMaterial } from './libraryModel.ts';

const topics = {
  operations: {
    title: '空谷经营复盘草稿',
    refs: ['D01', 'D02', 'D05'],
    body: '记录显示\n9/13—9/19零售48,178元，1,307单，每单36.86元；上一可比7天42,788元，增长12.6%。两场已履约活动11,400元，综合销售59,578元。\n\n分析\n订单和客单能够解释金额的数学构成，不能直接证明营销带来增长。活动套餐未重复计入零售；本期活动收款10,500元中有2,400元属于未来订金。\n\n下一步\n补逐时订单、促销记录和活动占用，再讨论排班与渠道收益。3,300元活动余款9/22到期，当前未逾期。',
  },
  product: {
    title: '空谷下一轮新品验证计划',
    refs: ['S07', 'D08', 'D09', 'D10', 'D11'],
    body: '依据\n真实行业报道提供贵州风味方向；40份合成问卷中16份提到更低甜度。刺梨冷萃的12人合成试饮中9人偏好V2，拟价34元，配方原料估算8.90元。\n\n分析\n这支持继续小样验证，不证明75%的真实顾客会购买，也不证明拟价能被接受。原料成本不包含人工、租金与完整损耗，不能当作实际毛利。\n\n下一轮\n平衡V1/V2试饮顺序，记录甜度感受、反对理由、价格接受、出杯用时与异常。先核对制作稳定性和原料信息，再由负责人决定是否试售。未组织真实试饮，未发布新品。',
  },
  customers: {
    title: '空谷客户分析与回访草稿',
    refs: ['D06', 'D07', 'D08'],
    body: '依据\n本期840笔会员订单对应640位购买会员，另有467笔未识别订单。独立的8月首购队列180人中54人在30天内再次购买，复购率30%。\n\n分析\n额外订单数不是复购人数；会员数也不是全店客流。问卷是自愿小样本，多选次数不能相加当作人数。\n\n回访草稿\n“我们在整理秋季饮品方向，想听听你喜欢更清爽还是更醇厚的口味。欢迎下次来店时给我们一点建议。”\n\n下一步\n先核对联系范围与真实活动安排，再讨论采用文案。120位只是合成候选，发送量仍为0。',
  },
  events: {
    title: '空谷30人读书会筹备方案',
    refs: ['D05', 'D13', 'D20'],
    body: '需求\n合成企业D拟于9/25举办30人读书会，金额6,000元，订金情境2,400元。拟13:00布置、14:00—16:00活动、16:30前撤场。\n\n待确认\n300㎡是室内外合计，不能推定真实座位或容量。核对区域、设备、雨天安排、散客影响与服务范围，再确认档期。\n\n方案\n先比较独立区域与整体包场；将布置、活动、撤场都列为占用时间。以场地3,200、协调1,200、30份饮品900、物料700元展示6,000元的合成报价。\n\n状态\n这份方案未对外发送，也不代表已批准档期或真实合同。',
  },
  finance: {
    title: '空谷采购与资金口径核对',
    refs: ['D05', 'D11', 'S06'],
    body: '先分清口径\n农小蜂报告中的生豆行情不是本店烘焙豆报价。合成烘焙豆128→136元/kg，以18g配方、额外损耗4%计算，单杯原料增加约0.15元。\n\n备货情景\n未来7天假设820杯，需要15.3504kg，现存6.8kg，缺口8.5504kg；均匀需求下约够3.1天。还没有加入活动增量和安全库存，因此不是采购订单。\n\n资金核对\n本期活动履约11,400元，已收8,100元，未收3,300元；另收未来订金2,400元。10,500元收款与11,400元收入不能混算。',
  },
  brand: {
    title: '空谷资料与行业信息核对清单',
    refs: ['D17', 'D18'],
    body: '企业语境\n本次采用用户提供的300㎡室内外空间、30—40元客单范围。现行菜单、营业时段、人员规模和具体容量尚未确认。\n\n信息整合\n真实新闻保留原文日期与链接，历史活动明确为回顾。内部经营资料均为合成情境；其他品牌的产品照片不当作空谷新品。\n\n下一步\n把每个判断连接到资料版本，区分事实、假设和建议。先验证具体工作，不以资料数量或AI自述衡量经营成果。',
  },
};
type Topic = keyof typeof topics;
function topicFor(text: string, chat: Chat): Topic {
  if (/新品|试饮|配方|甜度|刺梨|抹茶|研发/.test(text)) return 'product';
  if (/会员|复购|客群|回访|反馈/.test(text)) return 'customers';
  if (/豆价|库存|补货|采购|订金|收款|到账|余款/.test(text)) return 'finance';
  if (/活动|读书会|包场|档期|报价/.test(text)) return 'events';
  if (/销售|经营|增长|客单|周报|复盘|排班/.test(text)) return 'operations';
  const linked = chat.messages.findLast((m) => m.role === 'user' && m.refs?.length)?.refs || [];
  if (linked.some((id) => ['kg-D09', 'kg-D10', 'kg-D19', 'kg-S07'].includes(id))) return 'product';
  if (linked.some((id) => ['kg-D05', 'kg-D11'].includes(id))) return 'finance';
  return chat.space in topics ? (chat.space as Topic) : 'brand';
}

export function replyKonggu(state: DemoState, chat: Chat, text: string): string | null {
  const snapshot = chat.briefingContext?.snapshot;
  if (snapshot?.authoredAt && snapshot.authoredAt.slice(0, 10) < '2026-09-20') {
    const refs = snapshot.refs || [];
    if (!refs.every((id) => state.materials.some((m) => m.id === id && canReadMaterial(state, m)))) {
      addMessage(chat, 'assistant', '这条留存内容的来源已不可访问，请先恢复可读资料再继续核对。');
      return null;
    }
    const body = `按这期编写的演示情境：${snapshot.fact}\n\n分析与下一步\n${snapshot.advice}\n\n请结合下面的留存资料与原文核对。这里没有补入之后日期的经营结果；尚未执行采购、营销或客户通知。`;
    const doc = /生成|整理|起草|计划|清单|方案/.test(text)
      ? createMaterial(
          state,
          `${snapshot.title} · 核对草稿`,
          body,
          '基于选定画报情境编写的核对草稿，待审阅。',
        )
      : null;
    if (doc) doc.relations = [...refs];
    addMessage(chat, 'assistant', body, doc?.id, refs);
    chat.messages.at(-1)!.refVersions = Object.fromEntries(
      refs.map((id) => [id, state.materials.find((m) => m.id === id)!.versions[0].id]),
    );
    return doc?.id || null;
  }
  const selectedMessage = chat.messages.findLast((m) => m.role === 'user');
  const selected = selectedMessage?.refs || [];
  if (
    selected.some((id) => {
      const doc = state.materials.find((m) => m.id === id && canReadMaterial(state, m));
      return (
        !doc ||
        (selectedMessage?.refVersions?.[id] &&
          !doc.versions.some((v) => v.id === selectedMessage.refVersions![id]))
      );
    })
  ) {
    addMessage(chat, 'assistant', '所选资料或引用版本已不可用，请重新选择可读取的来源。');
    return null;
  }
  if (selected.some((id) => !/^kg-[DS]\d{2}$/.test(id))) {
    const readable = selected.filter((id) =>
      state.materials.some((m) => m.id === id && canReadMaterial(state, m)),
    );
    addMessage(
      chat,
      'assistant',
      '已保留所选资料及版本。这份内容不属于内置分析样例，当前Demo不会自动推算或改写其中数据。可以打开原文核对，或从经营、新品、活动三个预设会话继续体验。',
      undefined,
      readable,
    );
    chat.messages.at(-1)!.refVersions = selectedMessage?.refVersions;
    return null;
  }
  const topic = topics[topicFor(text, chat)];
  const refs = [...new Set([...topic.refs.map((id) => `kg-${id}`), ...(snapshot?.refs || []), ...selected])];
  const docs = refs.map((id) => state.materials.find((m) => m.id === id && canReadMaterial(state, m)));
  if (docs.some((d) => !d)) {
    addMessage(
      chat,
      'assistant',
      '本次分析需要的资料已删除或不在当前可见范围，请先补齐来源。未根据缺失资料输出新的数字。',
    );
    return null;
  }
  if (docs.some((d) => latest(d!).number !== 1)) {
    addMessage(
      chat,
      'assistant',
      '关联资料已有新版本。内置分析只对应初始演示底表，不能自动把旧结论当成更新后的结果；请先核对变更与统计口径。',
      undefined,
      refs,
    );
    return null;
  }
  const context = snapshot ? `本条画报\n${snapshot.fact}\n${snapshot.advice}\n\n` : '';
  const body = `以下是根据内置情境编写的分析样例，内部经营数字为模拟，尚未调用真实模型。\n\n${context}${topic.body}`;
  const doc = /生成|整理|起草|计划|方案|清单|复盘|精简|补充|修改|完善/.test(text)
    ? createMaterial(state, topic.title, body, '基于空谷演示资料形成的待审稿；没有对外发送或实际执行。')
    : null;
  if (doc) doc.relations = refs;
  addMessage(chat, 'assistant', body, doc?.id, refs);
  chat.messages.at(-1)!.refVersions = Object.fromEntries(docs.map((d) => [d!.id, latest(d!).id]));
  return doc?.id || null;
}
