import assert from 'node:assert/strict';
import test from 'node:test';
import { generationBlocked } from '../src/briefing-live/generation-reasons.ts';

test('generationBlocked marks waiting statuses, not running or queued', () => {
  assert.equal(generationBlocked('WAITING_DATA'), true);
  assert.equal(generationBlocked('WAITING_RESOURCE'), true);
  assert.equal(generationBlocked('WAITING_CAPABILITY'), true);
  assert.equal(generationBlocked('RUNNING'), false);
  assert.equal(generationBlocked('QUEUED'), false);
  assert.equal(generationBlocked('SUCCEEDED'), false);
});
