-- Engine conclusions retain the authority of every input, including inputs not quoted.
CREATE TABLE company_inference_runs (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), actor_id uuid NOT NULL REFERENCES accounts(id),
 state varchar(16) NOT NULL CHECK(state IN ('RUNNING','SUCCEEDED','FAILED','CANCELLED')),
 lease_token uuid NOT NULL, lease_until timestamptz NOT NULL,
 group_revisions jsonb NOT NULL, fenced boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 UNIQUE(tenant_id,id)
);
CREATE TABLE company_inference_inputs (
 run_id uuid NOT NULL REFERENCES company_inference_runs(id), chunk_id uuid NOT NULL REFERENCES knowledge_chunks(id), model_visible boolean NOT NULL DEFAULT true,
 PRIMARY KEY(run_id,chunk_id)
);
CREATE INDEX company_inference_chunk ON company_inference_inputs(chunk_id);
CREATE TABLE company_information_suggestions (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), run_id uuid NOT NULL,
 field varchar(16) NOT NULL CHECK(field IN ('NAME','INDUSTRY','BUSINESS','TERM')),
 target_id uuid, label varchar(160) NOT NULL, meaning varchar(1000) NOT NULL,
 state varchar(16) NOT NULL CHECK(state IN ('PENDING','APPLIED','KEPT','SUPERSEDED')),
 revision integer NOT NULL DEFAULT 1, scrubbed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,run_id) REFERENCES company_inference_runs(tenant_id,id),
 FOREIGN KEY(tenant_id,target_id) REFERENCES profile_entries(tenant_id,id)
);
CREATE INDEX company_suggestion_queue ON company_information_suggestions(tenant_id,field,state);
CREATE TABLE company_suggestion_evidence (
 suggestion_id uuid NOT NULL REFERENCES company_information_suggestions(id), chunk_id uuid NOT NULL REFERENCES knowledge_chunks(id),
 quote_start integer NOT NULL CHECK(quote_start>=0), quote_length integer NOT NULL CHECK(quote_length BETWEEN 1 AND 1000),
 PRIMARY KEY(suggestion_id,chunk_id)
);
CREATE TABLE company_profile_inferences (
 version_id uuid NOT NULL REFERENCES profile_versions(id), run_id uuid NOT NULL REFERENCES company_inference_runs(id),
 PRIMARY KEY(version_id,run_id)
);
CREATE INDEX company_profile_run ON company_profile_inferences(run_id);

CREATE FUNCTION company_chunk_eligible(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM knowledge_chunks c JOIN knowledge_runs r ON r.id=c.run_id
 JOIN active_materials m ON m.id=c.material_id JOIN workspaces w ON w.id=m.workspace_id
 JOIN tenants t ON t.id=m.tenant_id
 WHERE c.id=target AND m.in_library AND w.kind='SHARED' AND t.status='ACTIVE' AND length(c.content)>0
 AND r.status IN ('READY','PARTIAL')
 AND EXISTS(SELECT 1 FROM tenant_memberships a WHERE a.tenant_id=t.id AND a.status='ACTIVE')
 AND NOT EXISTS(SELECT 1 FROM tenant_memberships a WHERE a.tenant_id=t.id AND a.status='ACTIVE'
   AND NOT EXISTS(SELECT 1 FROM workspace_members g WHERE g.tenant_id=t.id AND g.workspace_id=w.id AND g.account_id=a.account_id)))
$$;
CREATE FUNCTION company_inference_readable(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM company_inference_runs r WHERE r.id=target AND NOT r.fenced AND r.state IN ('RUNNING','SUCCEEDED'))
 AND EXISTS(SELECT 1 FROM company_inference_inputs i WHERE i.run_id=target)
 AND NOT EXISTS(SELECT 1 FROM company_inference_inputs i WHERE i.run_id=target AND NOT company_chunk_eligible(i.chunk_id))
$$;
CREATE FUNCTION company_profile_readable(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM company_profile_inferences p WHERE p.version_id=target AND NOT company_inference_readable(p.run_id))
$$;

-- Permission changes permanently fence old inference runs; a later grant cannot revive them.
CREATE FUNCTION fence_company_inference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tenant uuid;
BEGIN
 IF TG_TABLE_NAME='tenant_memberships' THEN
  IF TG_OP='UPDATE' AND (OLD.tenant_id,OLD.account_id,OLD.status) IS NOT DISTINCT FROM (NEW.tenant_id,NEW.account_id,NEW.status) THEN RETURN NULL; END IF;
  tenant:=CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  UPDATE company_inference_runs r SET fenced=true WHERE r.tenant_id=tenant AND NOT r.fenced AND
   (EXISTS(SELECT 1 FROM company_inference_inputs i WHERE i.run_id=r.id AND NOT company_chunk_eligible(i.chunk_id)) OR
    (r.state='RUNNING' AND NOT EXISTS(SELECT 1 FROM tenant_memberships a WHERE a.tenant_id=r.tenant_id AND a.account_id=r.actor_id AND a.status='ACTIVE')));
 ELSIF TG_TABLE_NAME='workspace_members' THEN
  IF TG_OP='UPDATE' AND (OLD.tenant_id,OLD.workspace_id,OLD.account_id) IS NOT DISTINCT FROM (NEW.tenant_id,NEW.workspace_id,NEW.account_id) THEN RETURN NULL; END IF;
  UPDATE company_inference_runs r SET fenced=true WHERE NOT r.fenced AND EXISTS(
   SELECT 1 FROM company_inference_inputs i JOIN knowledge_chunks c ON c.id=i.chunk_id WHERE i.run_id=r.id AND c.workspace_id=OLD.workspace_id AND NOT company_chunk_eligible(c.id));
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER company_member_fence AFTER INSERT OR UPDATE OR DELETE ON tenant_memberships FOR EACH ROW EXECUTE FUNCTION fence_company_inference();
CREATE TRIGGER company_space_fence AFTER UPDATE OR DELETE ON workspace_members FOR EACH ROW EXECUTE FUNCTION fence_company_inference();

CREATE FUNCTION fence_company_material() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='content_lifecycle' THEN
  IF NEW.state<>'ACTIVE' THEN UPDATE company_inference_runs r SET fenced=true WHERE r.tenant_id=NEW.tenant_id AND NOT r.fenced AND EXISTS(SELECT 1 FROM company_inference_inputs i WHERE i.run_id=r.id AND NOT company_chunk_eligible(i.chunk_id)); END IF;
 ELSIF TG_TABLE_NAME='materials' THEN
  IF NOT NEW.in_library OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
   UPDATE company_inference_runs r SET fenced=true WHERE NOT r.fenced AND EXISTS(SELECT 1 FROM company_inference_inputs i JOIN knowledge_chunks c ON c.id=i.chunk_id WHERE i.run_id=r.id AND c.material_id=NEW.id);
  END IF;
 ELSE
  IF NEW.status<>'ACTIVE' THEN UPDATE company_inference_runs SET fenced=true WHERE tenant_id=NEW.id AND state='RUNNING' AND NOT fenced; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER company_material_lifecycle_fence AFTER INSERT OR UPDATE ON content_lifecycle FOR EACH ROW EXECUTE FUNCTION fence_company_material();
CREATE TRIGGER company_material_scope_fence AFTER UPDATE OF in_library,workspace_id ON materials FOR EACH ROW EXECUTE FUNCTION fence_company_material();
CREATE TRIGGER company_service_fence AFTER UPDATE OF status ON tenants FOR EACH ROW EXECUTE FUNCTION fence_company_material();

-- Physical source erasure also erases inferred labels and their existing task dependants.
CREATE FUNCTION scrub_company_inference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version uuid;
BEGIN
 IF NEW.content='' AND OLD.content<>'' THEN
  UPDATE company_inference_runs r SET fenced=true WHERE EXISTS(SELECT 1 FROM company_inference_inputs i WHERE i.run_id=r.id AND i.chunk_id=NEW.id);
  UPDATE company_information_suggestions s SET label='',meaning='',scrubbed=true WHERE EXISTS(SELECT 1 FROM company_inference_inputs i WHERE i.run_id=s.run_id AND i.chunk_id=NEW.id);
  FOR version IN SELECT DISTINCT p.version_id FROM company_profile_inferences p JOIN company_inference_inputs i ON i.run_id=p.run_id WHERE i.chunk_id=NEW.id ORDER BY p.version_id LOOP
   PERFORM scrub_lifecycle_object_internal('PROFILE_VERSION',version,ARRAY[]::text[]);
  END LOOP;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER company_source_scrub AFTER UPDATE OF content ON knowledge_chunks FOR EACH ROW EXECUTE FUNCTION scrub_company_inference();
