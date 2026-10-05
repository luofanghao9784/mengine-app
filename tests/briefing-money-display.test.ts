import test from 'node:test';
import assert from 'node:assert/strict';
import {displayAmount} from '../src/briefing-live/money-display.ts';
test('currency display converts cents exactly without mutating receipts or losing sign/precision',()=>{
 assert.equal(displayAmount('309100','分'),'3091');assert.equal(displayAmount('1','分'),'0.01');assert.equal(displayAmount('-25','分'),'-0.25');assert.equal(displayAmount('12345678901234567890123456.78','分'),'123456789012345678901234.5678');assert.equal(displayAmount(null,'分'),null);assert.equal(displayAmount('309100','元'),'309100');
});
