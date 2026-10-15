-- Receipt storage is private to the authenticated engine transport, never a content API.
CREATE TABLE engine_execution_receipts (
 kind varchar(16) NOT NULL CHECK(kind IN ('AGENT','COMPANY')),
 task_id uuid NOT NULL, attempt_id uuid NOT NULL,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 input_hash varchar(64) NOT NULL, engine_version varchar(100) NOT NULL,
 state varchar(16) NOT NULL CHECK(state IN ('ACCEPTED','COMPLETED')),
 recovery_checked_at timestamptz, recovery_error_code varchar(64),
 result jsonb, accepted_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 PRIMARY KEY(kind,task_id,attempt_id),
 CHECK(result IS NULL OR jsonb_typeof(result)='object')
);
CREATE INDEX engine_receipts_tenant ON engine_execution_receipts(tenant_id,accepted_at);
CREATE INDEX engine_receipts_recovery ON engine_execution_receipts(kind,completed_at) WHERE result IS NOT NULL;
CREATE INDEX engine_receipts_retention ON engine_execution_receipts(accepted_at) WHERE result IS NOT NULL;

-- Tool starts are durable before execution: an unobserved finish is still potentially a write.
CREATE FUNCTION task_retry_is_safe(target uuid, attempt_number_value integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM conversation_attempts a
 WHERE a.task_id=target AND a.attempt_number=attempt_number_value
 AND a.execution_policy IN ('READ_ONLY_PRIVATE_V1','SCOPED_PRIVATE_V2')
 AND jsonb_typeof(a.allowed_tools)='array'
 AND NOT EXISTS(SELECT 1 FROM conversation_tool_receipts t WHERE t.task_id=a.task_id AND t.attempt_number=a.attempt_number
   AND (NOT (a.allowed_tools ? t.name) OR t.name NOT IN ('search_sources','task_context','find_skills','activate_skill','read_skill_resource','public_search','read_public_page','list_originals','read_original')))
 AND NOT EXISTS(SELECT 1 FROM engine_execution_receipts r WHERE r.kind='AGENT' AND r.task_id=a.task_id AND r.attempt_id=a.attempt_id AND r.state='COMPLETED'));
$$;
