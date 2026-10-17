ALTER TABLE conversations
 ADD COLUMN management_revision integer NOT NULL DEFAULT 0 CHECK (management_revision >= 0),
 ADD COLUMN trashed_at timestamptz,
 ADD COLUMN reply_revision bigint NOT NULL DEFAULT 0 CHECK (reply_revision >= 0),
 ADD COLUMN read_reply_revision bigint NOT NULL DEFAULT 0 CHECK (read_reply_revision >= 0 AND read_reply_revision <= reply_revision),
 ADD COLUMN latest_reply_task_id uuid REFERENCES conversation_tasks(id);
CREATE INDEX conversation_owner_trash ON conversations(tenant_id,owner_id,trashed_at) WHERE trashed_at IS NOT NULL;

-- Existing history starts read. Only an accepted new AI answer/question advances unread.
CREATE FUNCTION conversation_record_reply() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.origin='USER' AND NEW.status IN ('SUCCEEDED','PARTIAL','WAITING_INPUT','WAITING_CAPABILITY')
  AND (coalesce(NEW.reply,'')<>'' OR coalesce(NEW.required_input,'')<>'')
  AND (OLD.reply IS DISTINCT FROM NEW.reply OR OLD.required_input IS DISTINCT FROM NEW.required_input
       OR OLD.attempt IS DISTINCT FROM NEW.attempt OR OLD.status IN ('QUEUED','RUNNING')) THEN
  UPDATE conversations SET reply_revision=reply_revision+1,latest_reply_task_id=NEW.id
   WHERE id=NEW.conversation_id AND trashed_at IS NULL;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER conversation_reply_receipt AFTER UPDATE OF reply,required_input,status ON conversation_tasks
 FOR EACH ROW EXECUTE FUNCTION conversation_record_reply();
