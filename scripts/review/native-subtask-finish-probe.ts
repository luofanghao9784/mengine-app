/** Read-only reproduction for #166 review: final selected output must outrank child history. */
import { buildWorkState } from '../../src/native-conversation/chat/work.ts';
import type { NativeEvent } from '../../src/native-conversation/chat/events.ts';
const event = (seq: number, type: string, data: unknown, sessionId?: string): NativeEvent => ({ seq, time: seq, type, data, ...(sessionId ? { sessionId } : {}) });
const result = buildWorkState([
 event(1, 'subagent.started', { parentSessionId: 'root', childSessionId: 'child' }),
 event(3, 'subagent.finished', { childSessionId: 'child', status: 'ok', lastAssistantMessage: [{ type: 'text', text: 'selected final output' }] }),
], [event(2, 'assistant/message', { message: { content: [{ type: 'text', text: 'previous child reply' }] } }, 'child')]);
const expected = 'selected final output', actual = result.subtasks[0].output;
console.log(JSON.stringify({ expected, actual, matches: expected === actual }));
if (expected !== actual) process.exitCode = 1;
