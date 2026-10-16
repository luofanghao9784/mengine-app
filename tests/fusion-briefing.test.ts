import test from 'node:test';
import assert from 'node:assert/strict';
import {fusionRows,fusionNumber} from '../src/briefing-live/fusion.ts';
import type {FusionEvidence} from '../contracts/public-api/briefing-content.ts';
test('aligns metrics by stable entity keys, preserves missing groups and exact large decimals',()=>{
 const evidence={dimensionLabels:{'["a"]':'同名店','["b"]':'同名店'},results:[{groups:[{dimensions:['a'],value:'9007199254740993.01'}]},{groups:[{dimensions:['b'],value:'0.10'},{dimensions:['a'],value:'0.20'}]}]} as FusionEvidence;
 const rows=fusionRows(evidence);assert.equal(rows.length,2);assert.deepEqual(rows[0].values,['9007199254740993.01','0.20']);assert.deepEqual(rows[1].values,[null,'0.10']);assert.notEqual(rows[0].key,rows[1].key);assert.equal(fusionNumber(rows[0].values[0]!), '9,007,199,254,740,993.01');
});
