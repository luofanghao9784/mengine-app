import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { assertObjectJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';
import { briefingDeliveryTool } from '../dist/runtime/briefing-delivery.js';
const tool = (available) =>
  briefingDeliveryTool({
    presentationAvailable: available,
    authorize: async () => {},
    invoke: async () => ({}),
  });
const presentation = {
  version: 'briefing-presentation-v1',
  layout: 'KEY_METRIC',
  chartStyle: 'DUMBBELL',
  focusGroup: '甲',
  focusValue: 'DIFFERENCE',
  sections: [],
};
const args = {
  businessType: 'DATA',
  title: '核验两期对比',
  summary: '两期实际变化，需要结合业务背景解读。',
  analysis: ['依据核验的固定快照形成两期对比。', '缺失期间不作为零值，也不虚构原因。'],
  presentation,
};
test('new capability exposes bounded layout choices and disallows model-supplied values or code', () => {
  const validate = new Ajv({ strict: false }).compile(tool(true).parameters);
  assert.equal(validate(args), true);
  for (const extra of [
    { number: 123 },
    { html: '<script>alert(1)</script>' },
    { css: 'body{}' },
    { imageUrl: 'https://example.test/private' },
  ])
    assert.equal(validate({ ...args, presentation: { ...presentation, ...extra } }), false);
  assert.equal(validate({ ...args, presentation: { ...presentation, chartStyle: 'PIE' } }), false);
  assert.equal(
    validate({
      ...args,
      presentation: { ...presentation, sections: [{ role: 'ACTION', paragraphIndex: 4 }] },
    }),
    false,
  );
});
test('old platforms cannot silently ignore the new composition', () => {
  const schema = tool(false).parameters;
  assert.equal(Object.hasOwn(schema.properties, 'presentation'), false);
  const validate = new Ajv({ strict: false }).compile(schema);
  assert.equal(validate(args), false);
  const { presentation: ignored, ...legacy } = args;
  assert.equal(validate(legacy), true);
  assert.match(tool(true).description, /not random decoration/);
});

test('schema uses the actual Harness subset and validates structured nullable arguments', () => {
  const schema = tool(true).parameters;
  assert.doesNotThrow(() => assertObjectJsonSchema(schema));
  assert.deepEqual(validateJsonSchemaValue(schema, args), []);
  assert.ok(
    validateJsonSchemaValue(schema, { ...args, presentation: { ...presentation, number: 123 } }).length,
  );
});

test('default summary follows verified artifact while explicit table and malformed choices are preserved', () => {
 const t=briefingDeliveryTool({presentationAvailable:true,isSummaryCalculation:id=>id==='verified-summary',authorize:async()=>{},invoke:async()=>({})});
 const {presentation: ignored,...body}=args;
 assert.equal(t.normalizeArguments({...body,calculationArtifactId:'verified-summary'}).presentation.chartStyle,'CURRENT_BAR');
 assert.equal(t.normalizeArguments(body).presentation.chartStyle,'GROUPED_BAR');
 assert.equal(t.normalizeArguments({...body,presentation:{...presentation,chartStyle:'TABLE'}}).presentation.chartStyle,'TABLE');
 assert.match(t.description,/up to 6 groups.*slope chart/);
 assert.match(t.description,/DUMBBELL has the same card face/);
 assert.match(t.description,/two or more explicit recommended actions/);
});
