ALTER TABLE conversation_attempts ADD COLUMN realtime_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE conversation_attempts ADD COLUMN stop_requested boolean NOT NULL DEFAULT false;
ALTER TABLE conversation_attempts ADD COLUMN stop_action varchar(8) NOT NULL DEFAULT 'CANCEL';
CREATE TABLE conversation_live_output (
 task_id uuid NOT NULL, attempt_number integer NOT NULL, step integer NOT NULL CHECK(step BETWEEN 1 AND 8),
 version integer NOT NULL CHECK(version>0), text varchar(65536) NOT NULL, state varchar(16) NOT NULL CHECK(state IN ('STREAMING','COMPLETE','INTERRUPTED')),
 PRIMARY KEY(task_id,attempt_number,step), FOREIGN KEY(task_id,attempt_number) REFERENCES conversation_attempts(task_id,attempt_number) ON DELETE CASCADE
);
CREATE TABLE conversation_live_inputs (
 id uuid PRIMARY KEY, task_id uuid NOT NULL, attempt_number integer NOT NULL,
 text varchar(2000) NOT NULL, applied boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(task_id,attempt_number) REFERENCES conversation_attempts(task_id,attempt_number) ON DELETE CASCADE
);
CREATE TABLE conversation_live_questions (
 id uuid PRIMARY KEY, task_id uuid NOT NULL, attempt_number integer NOT NULL,
 text varchar(1000) NOT NULL, options jsonb NOT NULL, blocking boolean NOT NULL,
 answered boolean NOT NULL DEFAULT false,
 FOREIGN KEY(task_id,attempt_number) REFERENCES conversation_attempts(task_id,attempt_number) ON DELETE CASCADE,
 UNIQUE(task_id,attempt_number)
);

ALTER TABLE conversation_live_inputs ADD COLUMN question_id uuid REFERENCES conversation_live_questions(id);

-- Existing lifecycle paths scrub attempt input/snapshot rather than deleting its audit identity.
-- Keep provisional answers, questions and user inputs under that same purge boundary.
CREATE FUNCTION scrub_conversation_live_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.snapshot='{}'::jsonb AND NEW.input IN ('内容已按来源生命周期清理','内容已按对象生命周期清理','内容已按资料生命周期清理') THEN
  DELETE FROM conversation_live_inputs WHERE task_id=NEW.task_id AND attempt_number=NEW.attempt_number;
  DELETE FROM conversation_live_questions WHERE task_id=NEW.task_id AND attempt_number=NEW.attempt_number;
  DELETE FROM conversation_live_output WHERE task_id=NEW.task_id AND attempt_number=NEW.attempt_number;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER conversation_live_scrub AFTER UPDATE OF input,snapshot ON conversation_attempts
 FOR EACH ROW EXECUTE FUNCTION scrub_conversation_live_content();
