-- Content relevance is separate from membership, space access and source confidentiality.
CREATE TABLE work_role_profiles (
 tenant_id uuid NOT NULL REFERENCES tenants(id), account_id uuid NOT NULL REFERENCES accounts(id),
 department text NOT NULL DEFAULT '' CHECK(length(department)<=100),
 job_title text NOT NULL DEFAULT '' CHECK(length(job_title)<=100),
 responsibilities text NOT NULL DEFAULT '' CHECK(length(responsibilities)<=1200),
 focus jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(focus)='array' AND jsonb_array_length(focus)<=8),
 revision integer NOT NULL CHECK(revision>0), changed_by uuid NOT NULL REFERENCES accounts(id), changed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,account_id), FOREIGN KEY(tenant_id,account_id) REFERENCES tenant_memberships(tenant_id,account_id)
);
CREATE FUNCTION work_audience_key(t uuid,a uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT md5(jsonb_build_array('work-audience-v1',m.role,m.status,g.owner_id,
   p.department,p.job_title,p.responsibilities,p.focus,p.revision)::text)
 FROM tenant_memberships m LEFT JOIN tenant_governance g ON g.tenant_id=m.tenant_id
 LEFT JOIN work_role_profiles p ON p.tenant_id=m.tenant_id AND p.account_id=m.account_id
 WHERE m.tenant_id=t AND m.account_id=a
$$;
CREATE TABLE task_audience_snapshots (
 task_id uuid NOT NULL REFERENCES conversation_tasks(id) ON DELETE CASCADE,
 attempt_number integer NOT NULL, audience_key text NOT NULL, context jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(task_id,attempt_number)
);
ALTER TABLE briefing_generation_batches ADD COLUMN audience_key text;
-- Preserve existing cards until their actual recipient's work context changes.
UPDATE briefing_generation_batches SET audience_key=work_audience_key(tenant_id,owner_id) WHERE task_id IS NOT NULL;
CREATE FUNCTION task_audience_current(t uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM conversation_tasks c
   LEFT JOIN task_audience_snapshots s ON s.task_id=c.id AND s.attempt_number=c.attempt
   LEFT JOIN briefing_generation_batches b ON b.task_id=c.id
   WHERE c.id=t AND ((s.task_id IS NOT NULL AND s.audience_key IS DISTINCT FROM work_audience_key(c.tenant_id,c.requested_by))
    OR (b.task_id IS NOT NULL AND b.audience_key IS DISTINCT FROM work_audience_key(c.tenant_id,c.requested_by))))
$$;
