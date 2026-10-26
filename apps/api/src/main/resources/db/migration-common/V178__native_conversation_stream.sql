CREATE TABLE native_conversation_events (
 session_id uuid NOT NULL REFERENCES native_conversations(id),
 seq bigint NOT NULL,
 receipt_key text NOT NULL,
 event jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(session_id,seq), UNIQUE(session_id,receipt_key)
);
CREATE TABLE native_conversation_operations (
 session_id uuid NOT NULL REFERENCES native_conversations(id),
 request_id uuid NOT NULL,
 action text NOT NULL,
 payload jsonb NOT NULL,
 result jsonb,
 PRIMARY KEY(session_id,request_id)
);

-- Native opinions share the existing private, versioned feedback ledger.
ALTER TABLE feedback_entries ADD COLUMN native_session_id uuid REFERENCES native_conversations(id);
ALTER TABLE feedback_entries ADD COLUMN native_event_seq bigint;
ALTER TABLE feedback_entries ADD CONSTRAINT native_feedback_event FOREIGN KEY(native_session_id,native_event_seq) REFERENCES native_conversation_events(session_id,seq);
ALTER TABLE feedback_entries DROP CONSTRAINT feedback_entries_kind_check;
ALTER TABLE feedback_entries ADD CONSTRAINT feedback_entries_kind_check CHECK(kind IN ('BRIEFING','TASK','PUBLICATION','NATIVE'));
ALTER TABLE feedback_entries DROP CONSTRAINT feedback_target_shape;
ALTER TABLE feedback_entries ADD CONSTRAINT feedback_target_shape CHECK(
 (kind='NATIVE' AND task_id IS NULL AND publication_id IS NULL AND material_version_id IS NULL AND native_session_id IS NOT NULL AND native_event_seq IS NOT NULL AND presentation_version='task-v1' AND task_revision=0 AND attempt=0 AND presentation_revision=0)
 OR (kind='PUBLICATION' AND task_id IS NULL AND task_revision=0 AND attempt=0 AND publication_id IS NOT NULL AND material_version_id IS NOT NULL AND material_version>0 AND presentation_version='recommendation-v1' AND presentation_revision>0 AND native_session_id IS NULL AND native_event_seq IS NULL)
 OR (kind IN('BRIEFING','TASK') AND task_id IS NOT NULL AND publication_id IS NULL AND material_version_id IS NULL AND material_version IS NULL AND native_session_id IS NULL AND native_event_seq IS NULL));
CREATE UNIQUE INDEX native_feedback_exact ON feedback_entries(actor_id,native_session_id,native_event_seq) WHERE kind='NATIVE';
