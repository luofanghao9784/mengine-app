CREATE TABLE native_conversation_metadata (
 session_id uuid PRIMARY KEY REFERENCES native_conversations(id) ON DELETE CASCADE,
 title text, manual_title text, pinned boolean NOT NULL DEFAULT false,
 pending jsonb NOT NULL DEFAULT '{}'::jsonb,
 last_seq bigint NOT NULL DEFAULT 0, last_activity_at timestamptz NOT NULL DEFAULT now()
);
