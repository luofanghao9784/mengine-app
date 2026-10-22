/** User-approved legacy editorial overrides, not semantic inference from arbitrary titles.
 * Keep immutable artifacts untouched; new cards retain the standard sizing/fit pipeline.
 */
export function legacyEditorialLayout(title: string): '1×2' | '2×1' | undefined {
  if (title === '万象汇这笔退款，先补证再汇报') return '1×2';
  if (title === '荔星3笔收款，按这两步接续复核') return '2×1';
  return undefined;
}

export function isInternalBriefingArtifact(filename: string) {
  return /^(briefing-(data|text|dataset|chain|fusion)([.-])|dataset-comparison-|business-plan\.json$|chain-calculation\.json$)/.test(filename);
}

/** User-requested verification editions (2026-10-21), including the topic refresh; not a generic sizing heuristic. */
const verificationEditionSizes: Record<string, '1×1' | '1×2' | '2×1' | '2×2'> = {
  "荔星履约复盘先按营业日，别把跨日上课错算": "1×1",
  "万象汇体验课有不同周期，跟进节奏应分开": "2×1",
  "世纪金源课程到期日与在用状态需合看": "1×1",
  "金融城合同有补签流转，先查当前状态": "1×2",
  "梵华里请假记录已结束，复课服务值得回看": "2×1",
  "金融城特殊课权益，先核可用再谈兑现": "1×1",
  "万象汇教练等级有历史区间，复盘应按发生时点": "1×1",
  "世纪金源转店有撤回，交接前先核有效状态": "2×1",
  "荔星分期包含未来开放日期，服务接续先分时点": "1×1",
  "梵华里产品含停用项，推荐前先核在售范围": "2×1",
  "两店各差800元，先验证收款归属再催收": "2×2",
  "影视话题能否带动运动需求？先小范围验证": "2×1",
  "客户诉求先在门店接住，复杂客诉交运营接续": "1×2",
  "课程培训落地，先对齐教练执行再复盘": "2×1",
  "设备维修交职能保障，门店同步调整安排": "1×1",
  "五店10月销售与收款：同额不等于逐笔结清": "2×2",
  "梵华里4笔历史收款记录待核对": "2×2",
  "户外赛事引入北斗，先核查活动安全准备": "2×1",
  "荔星已确认收款不能直接作为分红额度": "1×1",
  "万象汇退款缺证，暂不判断资金损失": "1×1",
  "金融城扩店判断还缺履约与成本依据": "1×1",
  "梵华里收退款不能直接推算营销回报": "1×1",
  "世纪金源历史取消项需与催收分开": "1×1",
  "荔星凭证已上传，先核状态再补缺项": "2×1",
  "万象汇退款先补出款依据，再做汇报": "1×2",
  "金融城两笔历史收款，先复核再联系": "2×1",
  "财务交接先写核对结果，再列材料缺项": "1×2",
  "梵华里核查已分开确认项与补证项": "1×1",
  "世纪金源核查保留待审项与历史解释": "1×1",
  "万象汇退款核查已区分已识别与缺证项": "1×1"
};
export function verificationEditionSize(title: string) { return verificationEditionSizes[title]; }
