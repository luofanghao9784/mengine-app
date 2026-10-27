ALTER TABLE native_conversations ADD COLUMN event_seq bigint NOT NULL DEFAULT 0;
UPDATE native_conversations s SET event_seq=coalesce((SELECT max(seq) FROM native_conversation_events e WHERE e.session_id=s.id),0);
CREATE TABLE native_conversation_status (
 session_id uuid PRIMARY KEY REFERENCES native_conversations(id) ON DELETE CASCADE,
 seq bigint NOT NULL, receipt_key text NOT NULL, event jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO native_conversation_status(session_id,seq,receipt_key,event,created_at)
 SELECT DISTINCT ON(session_id) session_id,seq,receipt_key,event,created_at
 FROM native_conversation_events WHERE event->>'type'='status' ORDER BY session_id,seq DESC;
DELETE FROM native_conversation_events WHERE event->>'type'='status';
