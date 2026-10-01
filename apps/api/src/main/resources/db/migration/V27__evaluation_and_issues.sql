CREATE TABLE evaluation_assets (
 id uuid PRIMARY KEY, tenant_id uuid REFERENCES tenants(id), workspace_id uuid,
 kind varchar(12) NOT NULL CHECK(kind IN ('STANDARD','SAMPLE')),
 revision integer NOT NULL DEFAULT 1, status varchar(12) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','WITHDRAWN')),
 created_by uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((tenant_id IS NULL)=(workspace_id IS NULL)), FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id)
);
CREATE INDEX evaluation_asset_scope ON evaluation_assets(tenant_id,workspace_id,created_at DESC,id);
CREATE TABLE evaluation_asset_versions (
 id uuid PRIMARY KEY, asset_id uuid NOT NULL REFERENCES evaluation_assets(id), revision integer NOT NULL,
 content jsonb NOT NULL, evidence jsonb NOT NULL DEFAULT '[]', origin_key varchar(100) NOT NULL,
 mode varchar(20) NOT NULL CHECK(mode IN ('SYNTHETIC','NO_MODEL','VERIFICATION','LIVE','UNKNOWN')),
 scrubbed boolean NOT NULL DEFAULT false, created_by uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(asset_id,revision)
);
CREATE TABLE evaluation_runs (
 id uuid PRIMARY KEY, tenant_id uuid REFERENCES tenants(id), workspace_id uuid,
 standard_version uuid NOT NULL REFERENCES evaluation_asset_versions(id), supersedes uuid REFERENCES evaluation_runs(id),
 created_by uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id)
);
CREATE INDEX evaluation_run_scope ON evaluation_runs(tenant_id,workspace_id,created_at DESC,id);
CREATE TABLE evaluation_run_samples (
 run_id uuid NOT NULL REFERENCES evaluation_runs(id), version_id uuid NOT NULL REFERENCES evaluation_asset_versions(id),
 PRIMARY KEY(run_id,version_id)
);
CREATE TABLE evaluation_findings (
 run_id uuid NOT NULL REFERENCES evaluation_runs(id), sample_version uuid NOT NULL REFERENCES evaluation_asset_versions(id),
 criterion varchar(40) NOT NULL, dimension varchar(24) NOT NULL, strength varchar(12) NOT NULL,
 verdict varchar(12) NOT NULL CHECK(verdict IN ('PASS','FAIL','UNKNOWN')),
 basis varchar(16) NOT NULL CHECK(basis IN ('PROGRAM','HUMAN','MISSING')),
 note varchar(2000) NOT NULL, PRIMARY KEY(run_id,sample_version,criterion)
);
CREATE TABLE evaluation_issues (
 id uuid PRIMARY KEY, tenant_id uuid REFERENCES tenants(id), workspace_id uuid,
 sample_version uuid NOT NULL REFERENCES evaluation_asset_versions(id), evaluation_id uuid REFERENCES evaluation_runs(id),
 title varchar(180) NOT NULL, category varchar(24) NOT NULL CHECK(category IN ('DATA','CONTENT','PREFERENCE','TECHNICAL','AUTHORIZATION','METHOD')),
 impact varchar(2000) NOT NULL, next_action varchar(1000) NOT NULL, revision integer NOT NULL DEFAULT 1,
 status varchar(16) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','IN_PROGRESS','WAITING','REVIEW','CLOSED')),
 assignee uuid REFERENCES accounts(id), outcome varchar(32), scrubbed boolean NOT NULL DEFAULT false, created_by uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id)
);
CREATE INDEX evaluation_issue_scope ON evaluation_issues(tenant_id,workspace_id,created_at DESC,id);
CREATE TABLE evaluation_issue_events (
 id uuid PRIMARY KEY, issue_id uuid NOT NULL REFERENCES evaluation_issues(id), revision integer NOT NULL,
 status varchar(16) NOT NULL, assignee uuid REFERENCES accounts(id), outcome varchar(32),
 basis varchar(24), note varchar(2000) NOT NULL, evidence jsonb NOT NULL DEFAULT '[]',
 actor_id uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(issue_id,revision)
);
-- References contain identifiers and exact revisions, not copied source bodies. All reads revalidate them.
CREATE TABLE evaluation_source_versions (
 asset_version uuid NOT NULL REFERENCES evaluation_asset_versions(id), material_version uuid NOT NULL REFERENCES material_versions(id),
 PRIMARY KEY(asset_version,material_version)
);
CREATE INDEX evaluation_source_material ON evaluation_source_versions(material_version);
CREATE TABLE evaluation_issue_sources (
 issue_id uuid NOT NULL REFERENCES evaluation_issues(id),material_version uuid NOT NULL REFERENCES material_versions(id),
 PRIMARY KEY(issue_id,material_version)
);
CREATE FUNCTION scrub_evaluation_material(target uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE evaluation_asset_versions v SET scrubbed=true,content='{}'::jsonb
 WHERE EXISTS(SELECT 1 FROM evaluation_source_versions s JOIN material_versions m ON m.id=s.material_version WHERE s.asset_version=v.id AND m.material_id=target);
 UPDATE evaluation_findings f SET note='' WHERE EXISTS(SELECT 1 FROM evaluation_asset_versions v WHERE v.id=f.sample_version AND v.scrubbed)
 OR EXISTS(SELECT 1 FROM evaluation_runs r JOIN evaluation_asset_versions v ON v.id=r.standard_version WHERE r.id=f.run_id AND v.scrubbed);
 UPDATE evaluation_issues i SET scrubbed=true,title='内容已清理',impact='',next_action='' WHERE EXISTS(SELECT 1 FROM evaluation_asset_versions v WHERE v.id=i.sample_version AND v.scrubbed)
 OR EXISTS(SELECT 1 FROM evaluation_issue_sources s JOIN material_versions v ON v.id=s.material_version WHERE s.issue_id=i.id AND v.material_id=target)
 OR EXISTS(SELECT 1 FROM evaluation_runs r JOIN evaluation_asset_versions v ON v.id=r.standard_version WHERE r.id=i.evaluation_id AND v.scrubbed);
 UPDATE evaluation_issue_events e SET note='' WHERE EXISTS(SELECT 1 FROM evaluation_issues i WHERE i.id=e.issue_id AND i.scrubbed);
END $$;
CREATE FUNCTION scrub_evaluation_task(target uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE evaluation_asset_versions v SET scrubbed=true,content='{}'::jsonb
 WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(v.evidence->'items') e
  WHERE (e->>'kind'='TASK' AND e->>'id'=target::text)
  OR (e->>'kind'='FEEDBACK' AND EXISTS(SELECT 1 FROM feedback_entries f WHERE f.id::text=e->>'id' AND f.task_id=target)));
 UPDATE evaluation_findings f SET note='' WHERE EXISTS(SELECT 1 FROM evaluation_asset_versions v WHERE v.id=f.sample_version AND v.scrubbed)
 OR EXISTS(SELECT 1 FROM evaluation_runs r JOIN evaluation_asset_versions v ON v.id=r.standard_version WHERE r.id=f.run_id AND v.scrubbed);
 UPDATE evaluation_issues i SET scrubbed=true,title='内容已清理',impact='',next_action='' WHERE EXISTS(SELECT 1 FROM evaluation_asset_versions v WHERE v.id=i.sample_version AND v.scrubbed)
 OR EXISTS(SELECT 1 FROM evaluation_runs r JOIN evaluation_asset_versions v ON v.id=r.standard_version WHERE r.id=i.evaluation_id AND v.scrubbed)
 OR EXISTS(SELECT 1 FROM evaluation_issue_events h CROSS JOIN LATERAL jsonb_array_elements(h.evidence->'items') e WHERE h.issue_id=i.id AND ((e->>'kind'='TASK' AND e->>'id'=target::text) OR (e->>'kind'='FEEDBACK' AND EXISTS(SELECT 1 FROM feedback_entries f WHERE f.id::text=e->>'id' AND f.task_id=target))));
 UPDATE evaluation_issue_events e SET note='' WHERE EXISTS(SELECT 1 FROM evaluation_issues i WHERE i.id=e.issue_id AND i.scrubbed);
END $$;
CREATE FUNCTION scrub_evaluation_feedback(target uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE evaluation_asset_versions v SET scrubbed=true,content='{}'::jsonb WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(v.evidence->'items') e WHERE e->>'kind'='FEEDBACK' AND e->>'id'=target::text);
 UPDATE evaluation_findings f SET note='' WHERE EXISTS(SELECT 1 FROM evaluation_asset_versions v WHERE v.id=f.sample_version AND v.scrubbed)
 OR EXISTS(SELECT 1 FROM evaluation_runs r JOIN evaluation_asset_versions v ON v.id=r.standard_version WHERE r.id=f.run_id AND v.scrubbed);
 UPDATE evaluation_issues i SET scrubbed=true,title='内容已清理',impact='',next_action='' WHERE EXISTS(SELECT 1 FROM evaluation_asset_versions v WHERE v.id=i.sample_version AND v.scrubbed)
 OR EXISTS(SELECT 1 FROM evaluation_runs r JOIN evaluation_asset_versions v ON v.id=r.standard_version WHERE r.id=i.evaluation_id AND v.scrubbed)
 OR EXISTS(SELECT 1 FROM evaluation_issue_events h CROSS JOIN LATERAL jsonb_array_elements(h.evidence->'items') e WHERE h.issue_id=i.id AND e->>'kind'='FEEDBACK' AND e->>'id'=target::text);
 UPDATE evaluation_issue_events e SET note='' WHERE EXISTS(SELECT 1 FROM evaluation_issues i WHERE i.id=e.issue_id AND i.scrubbed);
END $$;
