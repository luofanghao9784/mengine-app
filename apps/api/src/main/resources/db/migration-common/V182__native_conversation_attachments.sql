CREATE TABLE native_conversation_attachments (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES native_conversations(id) ON DELETE CASCADE,
 request_id uuid NOT NULL, filename text NOT NULL, media_type text NOT NULL,
 sha256 text NOT NULL, content bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id,request_id)
);
