-- Temporary, owner-only export archives; business assets retain their own versions/lifecycle.
CREATE TABLE export_batches (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,owner_id uuid NOT NULL,workspace_id uuid NOT NULL,
 scope varchar(12) NOT NULL CHECK(scope IN ('PRIVATE','ENTERPRISE')),
 retention_days integer NOT NULL CHECK(retention_days BETWEEN 1 AND 7),
 state varchar(16) NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','GENERATING','READY','PARTIAL','FAILED','EXPIRED','REVOKED','REMOVED')),
 revision integer NOT NULL DEFAULT 1,requested_count integer NOT NULL CHECK(requested_count BETWEEN 1 AND 50),
 lease_token uuid,lease_until timestamptz,generation uuid,attempts integer NOT NULL DEFAULT 0,
 bytes bigint NOT NULL DEFAULT 0,sha256 varchar(64),error_code varchar(80),
 created_at timestamptz NOT NULL DEFAULT now(),generated_at timestamptz,expires_at timestamptz,
 cleanup_state varchar(12) NOT NULL DEFAULT 'NONE' CHECK(cleanup_state IN ('NONE','PENDING','FAILED','COMPLETE')),
 cleanup_attempts integer NOT NULL DEFAULT 0,cleanup_reason varchar(32),cleaned_at timestamptz,removed_bytes bigint NOT NULL DEFAULT 0,
 FOREIGN KEY(tenant_id,owner_id) REFERENCES tenant_memberships(tenant_id,account_id),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id)
);
CREATE INDEX export_owner_batches ON export_batches(tenant_id,owner_id,created_at DESC,id);
CREATE INDEX export_due_batches ON export_batches(expires_at) WHERE cleaned_at IS NULL;
CREATE TABLE export_batch_items (
 batch_id uuid NOT NULL REFERENCES export_batches(id),ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 50),
 object_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),format varchar(8) NOT NULL CHECK(format IN ('docx','pdf')),
 state varchar(12) NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','WRITING','INCLUDED','FAILED')),
 title varchar(180),version_id uuid,archive_path varchar(150),bytes bigint,sha256 varchar(64),error_code varchar(80),
 PRIMARY KEY(batch_id,ordinal),UNIQUE(batch_id,object_id,version,format)
);
CREATE TABLE export_item_sources (
 batch_id uuid NOT NULL,ordinal integer NOT NULL,version_id uuid NOT NULL REFERENCES material_versions(id),
 PRIMARY KEY(batch_id,ordinal,version_id),FOREIGN KEY(batch_id,ordinal) REFERENCES export_batch_items(batch_id,ordinal)
);
CREATE INDEX export_sources_version ON export_item_sources(version_id);
CREATE TABLE export_archive_chunks (
 batch_id uuid NOT NULL REFERENCES export_batches(id),generation uuid NOT NULL,ordinal integer NOT NULL CHECK(ordinal>=0),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 65536),
 PRIMARY KEY(batch_id,generation,ordinal)
);
-- Call while material version IDs still exist. Online chunks are removed in this transaction.
-- This receipt does not claim old PostgreSQL snapshots/backups were physically erased.
CREATE FUNCTION scrub_export_material(target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b uuid;removed bigint;
BEGIN
 FOR b IN SELECT DISTINCT s.batch_id FROM export_item_sources s JOIN material_versions v ON v.id=s.version_id WHERE v.material_id=target LOOP
  PERFORM id FROM export_batches WHERE id=b FOR UPDATE;
  SELECT coalesce(sum(octet_length(content)),0) INTO removed FROM export_archive_chunks WHERE batch_id=b;
  DELETE FROM export_archive_chunks WHERE batch_id=b;
  UPDATE export_batch_items SET title=NULL,archive_path=NULL,sha256=NULL WHERE batch_id=b;
  UPDATE export_batches SET state='REVOKED',revision=revision+1,error_code='EXPORT_SOURCE_REMOVED',lease_token=NULL,lease_until=NULL,cleanup_state='COMPLETE',cleanup_reason='SOURCE_PURGED',cleaned_at=coalesce(cleaned_at,now()),removed_bytes=removed_bytes+removed WHERE id=b;
 END LOOP;
END $$;
CREATE INDEX publication_export_workspace ON document_publications(tenant_id,workspace_id,material_id,material_version DESC);
-- Internal lifecycle hook for explicit offboarding/tenant cleanup; no public admin download route.
-- Passing an owner limits cleanup to that owner's temporary packages; null covers the tenant.
CREATE FUNCTION scrub_export_scope(target_tenant uuid,target_owner uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b uuid;removed bigint;
BEGIN
 FOR b IN SELECT id FROM export_batches WHERE tenant_id=target_tenant AND (target_owner IS NULL OR owner_id=target_owner) LOOP
  PERFORM id FROM export_batches WHERE id=b FOR UPDATE;
  SELECT coalesce(sum(octet_length(content)),0) INTO removed FROM export_archive_chunks WHERE batch_id=b;
  DELETE FROM export_archive_chunks WHERE batch_id=b;
  UPDATE export_batch_items SET title=NULL,archive_path=NULL,sha256=NULL WHERE batch_id=b;
  UPDATE export_batches SET state='REVOKED',revision=revision+1,error_code='EXPORT_SCOPE_REMOVED',lease_token=NULL,lease_until=NULL,cleanup_state='COMPLETE',cleanup_reason='SCOPE_PURGED',cleaned_at=coalesce(cleaned_at,now()),removed_bytes=removed_bytes+removed WHERE id=b;
 END LOOP;
END $$;
