import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const schema = JSON.parse(
  await readFile(
    new URL('../../contracts/engine-api/briefing-delivery.schema.json', import.meta.url),
    'utf8',
  ),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } });
ajv.addSchema(schema);
test('model submits prose and receipt identity, never authoritative chart values', () => {
  const check = ajv.compile({ $ref: schema.$id + '#/$defs/request' });
  const value = {
    calculationArtifactId: '00000000-0000-4000-8000-000000000001',
    title: '合成经营变化画报',
    summary: '根据计算回执生成完整的经营分析摘要。',
    analysis: ['这是一条包含完整口径的合成分析结论。', '这是一条区分推断和证据的合成分析结论。'],
  };
  assert.ok(check(value));
  for (const bad of [
    { ...value, chart: { current: 999 } },
    { ...value, tenantId: value.calculationArtifactId },
    { ...value, calculationArtifactId: undefined },
    { ...value, analysis: [] },
    { ...value, summary: '过短' },
  ])
    assert.equal(check(bad), false);
});

test('text types may attach calculation evidence; INFO and model-authored chart values remain rejected', () => {
 const check=ajv.compile({$ref:schema.$id+'#/$defs/request'});
 const card={title:'两店收款需要核对',summary:'本次确认收款保留原统计范围，建议核对凭证。',analysis:['建议按已核验的期间与门店核对凭证。','系统确认不等于银行到账，仍需后续核查。'],calculationArtifactId:'00000000-0000-4000-8000-000000000001'};
 for(const businessType of ['INSIGHT','SUGGESTION','RESULT'])assert.ok(check({...card,businessType}));
 assert.equal(check({...card,businessType:'INFO'}),false);
 assert.equal(check({...card,businessType:'SUGGESTION',chart:{current:999}}),false);
});

test('shared writing contract distinguishes measured zero from missing values and keeps its review export aligned', async () => {
  const contract = JSON.parse(await readFile(new URL('../../engine/src/runtime/briefing-contract.json', import.meta.url), 'utf8'));
  assert.equal(contract.version, '1.5.9');
  assert.match(contract.rules, /实际匹配记录中的有效零值可以交付为有价值业务基线/);
  assert.match(contract.rules, /没有匹配记录、必需数值为NULL或缺失时不能补零/);
  assert.match(contract.rules, /缺失期间保留为缺失/);
  assert.match(contract.rules, /回执title为实际保存标题/);
  assert.match(contract.rules, /旧画报不因规则升级重新生成或改写/);
  assert.doesNotMatch(contract.rules, /并非全部为零|全部为0或缺失时不交付/);
  const review = await readFile(new URL('../../docs/技术/画报生成规则-审阅稿.md', import.meta.url), 'utf8');
  assert.ok(review.includes(`表达版本 **${contract.version}**`));
  assert.ok(review.includes(contract.rules.split('\n').join('\n\n')));
});


test('supporting calculations are bounded immutable receipts rather than model-provided numeric prose', async () => {
 const request=ajv.compile({$ref:schema.$id+'#/$defs/request'});
 const valid={calculationArtifactId:'00000000-0000-4000-8000-000000000001',title:'按月登记事实对照',summary:'两个自然月分别计算，保留各自登记口径。',analysis:['两个自然月使用各自固定日期范围与来源计算。','不同月份合计保留独立结果，不合并为收入。'],supportingCalculationArtifactIds:['00000000-0000-4000-8000-000000000002']};
 assert.ok(request(valid));assert.equal(request({...valid,supportingCalculationArtifactIds:Array(3).fill(valid.supportingCalculationArtifactIds[0])}),false);
 assert.equal(request({...valid,calculationArtifactId:undefined,businessType:'INSIGHT'}),false);
 const supporting=ajv.compile({$ref:schema.$id+'#/$defs/supportingCalculation'});
 const doc=JSON.parse(await readFile(new URL('../../contracts/fixtures/dataset-briefing.json',import.meta.url),'utf8'));
 const value={artifactId:valid.supportingCalculationArtifactIds[0],sha256:'d'.repeat(64),unit:'元',receipt:{datasetSource:doc.content.datasetSource,calculation:{recipeVersion:'dataset-summary-1',status:'COMPUTED',request:{dateFrom:'2026-09-01'},inputSha256:'b'.repeat(64),matchedRows:2,ignoredRows:4,rows:[{group:['甲'],value:'0',records:2}],total:'0'}}};
 assert.ok(supporting(value));assert.equal(supporting({...value,receipt:{datasetSource:doc.content.datasetSource}}),false);
 assert.equal(supporting({...value,sha256:'invented'}),false);
});
