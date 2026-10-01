-- Per-person layout is separate from task content, recommendation order and reading facts.
ALTER TABLE briefing_preferences ADD COLUMN focus_position numeric(30,12);
WITH ordered AS (
 SELECT conversation_id,row_number() OVER(PARTITION BY tenant_id,owner_id ORDER BY updated_at DESC,conversation_id)*1024 AS position
 FROM briefing_preferences WHERE pinned
) UPDATE briefing_preferences p SET focus_position=o.position FROM ordered o WHERE o.conversation_id=p.conversation_id;
CREATE TABLE briefing_layouts (
 tenant_id uuid NOT NULL REFERENCES tenants(id), owner_id uuid NOT NULL REFERENCES accounts(id),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,owner_id)
);
INSERT INTO briefing_layouts(tenant_id,owner_id) SELECT DISTINCT tenant_id,owner_id FROM briefing_preferences;
CREATE TABLE briefing_layout_moves (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), owner_id uuid NOT NULL REFERENCES accounts(id),
 conversation_id uuid NOT NULL REFERENCES conversations(id), anchor_id uuid NOT NULL REFERENCES conversations(id),
 direction varchar(8) NOT NULL CHECK(direction IN ('BEFORE','AFTER')),
 applied_revision integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION maintain_briefing_layout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO briefing_layouts(tenant_id,owner_id) VALUES (NEW.tenant_id,NEW.owner_id) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM briefing_layouts WHERE tenant_id=NEW.tenant_id AND owner_id=NEW.owner_id FOR UPDATE;
 IF NEW.pinned AND NEW.focus_position IS NULL THEN
  SELECT coalesce(max(focus_position),0)+1024 INTO NEW.focus_position FROM briefing_preferences WHERE tenant_id=NEW.tenant_id AND owner_id=NEW.owner_id;
 END IF;
 IF TG_OP='INSERT' OR NEW.pinned IS DISTINCT FROM OLD.pinned OR NEW.hidden IS DISTINCT FROM OLD.hidden OR NEW.size IS DISTINCT FROM OLD.size OR NEW.focus_position IS DISTINCT FROM OLD.focus_position THEN
  UPDATE briefing_layouts SET revision=revision+1,updated_at=now() WHERE tenant_id=NEW.tenant_id AND owner_id=NEW.owner_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER maintain_briefing_layout BEFORE INSERT OR UPDATE ON briefing_preferences FOR EACH ROW EXECUTE FUNCTION maintain_briefing_layout();
CREATE INDEX briefing_focus_positions ON briefing_preferences(tenant_id,owner_id,focus_position,conversation_id) WHERE pinned;
