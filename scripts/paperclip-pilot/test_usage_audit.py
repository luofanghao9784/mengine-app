import copy
import unittest
from usage_audit import extract

SID = '11111111-1111-4111-8111-111111111111'
START = '2026-11-01T00:00:00Z'
END = '2026-11-01T00:00:09Z'


def event(t, kind, payload):
    return {'timestamp': f'2026-11-01T00:00:0{t}Z', 'type': kind, 'payload': payload}


def fixture():
    usage = dict(input_tokens=100, cached_input_tokens=80, cache_write_input_tokens=0,
                 output_tokens=10, reasoning_output_tokens=2, total_tokens=110)
    return [event(0, 'session_meta', {'id': SID}),
            event(1, 'event_msg', {'type': 'task_started', 'turn_id': 'turn'}),
            event(1, 'turn_context', {'turn_id': 'turn', 'root_turn_id': 'turn', 'model': 'fixture-model'}),
            event(3, 'token_usage_record', {'session_id': SID, 'thread_id': SID,
                  'root_turn_id': 'turn', 'response_id': 'response', 'usage': usage,
                  'turn_token_usage': copy.deepcopy(usage)}),
            event(4, 'event_msg', {'type': 'turn_aborted', 'turn_id': 'turn'})]


class UsageAuditTests(unittest.TestCase):
    def test_cancelled_usage_preserves_cache_and_reasoning_is_not_added_twice(self):
        r = extract(fixture(), SID, START, END)
        self.assertEqual(r['usage'], dict(inputTokens=20, cachedInputTokens=80, outputTokens=10))
        self.assertEqual(r['reasoningOutputTokens'], 2)

    def test_identical_provider_replay_is_deduplicated(self):
        rows = fixture()
        rows.insert(4, copy.deepcopy(rows[3]))
        self.assertEqual(extract(rows, SID, START, END)['providerResponses'], 1)

    def test_conflicting_response_id_is_rejected(self):
        rows = fixture()
        changed = copy.deepcopy(rows[3])
        changed['payload']['usage']['output_tokens'] = 11
        changed['payload']['usage']['total_tokens'] = 111
        rows.insert(4, changed)
        with self.assertRaisesRegex(ValueError, 'Conflicting'):
            extract(rows, SID, START, END)

    def test_missing_closed_boundary_is_not_a_free_run(self):
        with self.assertRaisesRegex(ValueError, 'not closed'):
            extract(fixture()[:-1], SID, START, END)

    def test_missing_request_is_rejected_by_turn_total(self):
        rows = fixture()
        rows[3]['payload']['turn_token_usage']['input_tokens'] += 100
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            extract(rows, SID, START, END)

    def test_foreign_thread_is_rejected(self):
        rows = fixture()
        rows[3]['payload']['thread_id'] = 'foreign'
        with self.assertRaisesRegex(ValueError, 'Foreign'):
            extract(rows, SID, START, END)

    def test_shared_session_does_not_double_count_other_turn(self):
        rows = fixture()
        other = copy.deepcopy(rows[3])
        other['timestamp'] = '2026-11-01T00:01:00Z'
        other['payload']['root_turn_id'] = 'next-turn'
        rows.append(other)
        self.assertEqual(extract(rows, SID, START, END)['usage']['inputTokens'], 20)

    def test_invalid_tokens_and_naive_timestamps_rejected(self):
        for value in (-1, 1.5, True):
            rows = fixture()
            rows[3]['payload']['usage']['input_tokens'] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                extract(rows, SID, START, END)
        with self.assertRaisesRegex(ValueError, 'Timezone'):
            extract(fixture(), SID, START.removesuffix('Z'), END)


if __name__ == '__main__':
    unittest.main()
