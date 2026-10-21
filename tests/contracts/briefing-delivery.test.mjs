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
