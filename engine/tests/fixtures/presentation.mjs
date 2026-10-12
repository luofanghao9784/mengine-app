// Explicit synthetic content for renderer and integration tests; no customer data or model claims.
export const presentationFixture = (sourceIds = []) => ({
  title: '季度经营复盘（合成示例）',
  theme: 'ocean',
  slides: [
    { kind: 'cover', title: '季度经营复盘', subtitle: '合成示例：销售进展与下一季度安排', sourceIds: [] },
    {
      kind: 'bullets',
      title: '本季度进展',
      bullets: [
        '重点客户试点已完成，当前进入续约讨论。',
        '月度营收逐月增加，详细数据见后两页。',
        '下季度先处理交付周期，再扩大试点范围。',
      ],
      sourceIds,
    },
    {
      kind: 'table',
      title: '月度经营数据',
      headers: ['月份', '营收（万元）', '客户数'],
      rows: [
        ['一月', '120', '40'],
        ['二月', '150', '45'],
        ['三月', '180', '52'],
      ],
      sourceIds,
    },
    {
      kind: 'chart',
      title: '营收变化',
      labels: ['一月', '二月', '三月'],
      values: [120, 150, 180],
      series: '月度营收',
      unit: '万元',
      sourceIds,
    },
    {
      kind: 'bullets',
      title: '下一季度安排',
      bullets: [
        '客户负责人核对续约需求和交付日期。',
        '产品团队整理试点中重复出现的问题。',
        '运营团队每月更新经营数据与来源。',
      ],
      sourceIds: [],
    },
    {
      kind: 'bullets',
      title: '待确认事项',
      bullets: ['确认下一季度的交付排期。', '对齐试点范围与验收标准。'],
      sourceIds: [],
    },
  ],
});
export const presentationModel = (sourceId) => {
  let step = 0;
  return {
    lastUsage: null,
    usage: null,
    async *generate(request) {
      const names = request.tools.map((t) => t.name);
      const commands = [
        ['activate_skill', { id: 'pptx-generator', version: '1.0.0' }],
        ['search_sources', { query: '营收' }],
        ['render_presentation', presentationFixture(sourceId ? [sourceId] : [])],
      ];
      if (step < commands.length) {
        const [name, args] = commands[step++];
        if (!names.includes(name)) throw new Error(`Synthetic fixture missing tool: ${name}`);
        yield { type: 'tool_call', id: `ppt-${step}`, name, arguments: JSON.stringify(name === 'render_presentation' && Object.keys(request.tools.find(t => t.name === name)?.parameters.properties ?? {}).length === 0 ? {} : args) };
        yield { type: 'finish', reason: 'tool_calls' };
      } else {
        throw new Error('Verified PPT draft/delivery must conclude without another model call');
      }
    },
  };
};
