-- Explicit in-app forwarding of exact independent shared copies. No private provenance or body cache.
CREATE TABLE publication_forward_batches (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), sender_id uuid NOT NULL REFERENCES accounts(id),
 publication_id uuid NOT NULL REFERENCES document_publications(id), material_version_id uuid NOT NULL REFERENCES material_versions(id),
 request_id uuid NOT NULL, request_hash varchar(64) NOT NULL, note varchar(500) NOT NULL DEFAULT '',
 accepted_at timestamptz NOT NULL DEFAULT now(), scrubbed boolean NOT NULL DEFAULT false,
 UNIQUE(sender_id,request_id)
);
CREATE TABLE publication_forward_receipts (
 id uuid PRIMARY KEY, batch_id uuid NOT NULL REFERENCES publication_forward_batches(id), recipient_id uuid NOT NULL REFERENCES accounts(id),
 opened_at timestamptz, UNIQUE(batch_id,recipient_id)
);
CREATE INDEX publication_forward_inbox ON publication_forward_receipts(recipient_id,batch_id);
CREATE INDEX publication_forward_sender ON publication_forward_batches(tenant_id,sender_id,accepted_at DESC,id);
CREATE INDEX publication_forward_source ON publication_forward_batches(material_version_id);
-- Additional current-access filter is applied before pagination/counting. Ordinary content gates still run.
CREATE FUNCTION forwarding_publication_readable(actor uuid,target_tenant uuid,publication uuid,version uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM document_publications p JOIN active_materials m ON m.id=p.material_id AND m.tenant_id=p.tenant_id
 JOIN material_versions v ON v.id=p.material_version_id AND v.material_id=m.id
 JOIN workspaces w ON w.id=p.workspace_id AND w.kind='SHARED'
 JOIN tenants t ON t.id=p.tenant_id AND t.status='ACTIVE'
 JOIN accounts a ON a.id=actor AND a.status='ACTIVE'
 JOIN tenant_memberships tm ON tm.tenant_id=t.id AND tm.account_id=a.id AND tm.status='ACTIVE'
 JOIN workspace_members wm ON wm.tenant_id=t.id AND wm.workspace_id=w.id AND wm.account_id=a.id
 WHERE p.id=publication AND p.tenant_id=target_tenant AND p.material_version_id=version
 AND departure_content_readable(actor,target_tenant,w.id)
 AND NOT EXISTS(SELECT 1 FROM departure_executions d WHERE d.tenant_id=target_tenant AND d.kind='TENANT_EXIT' AND d.state<>'CANCELLED'));
$$;
CREATE FUNCTION scrub_forwarding_material_version(target uuid) RETURNS void LANGUAGE sql AS $$
 UPDATE publication_forward_batches SET note='',scrubbed=true WHERE material_version_id=target;
$$;
CREATE FUNCTION scrub_forwarding_scope(target_tenant uuid,target_owner uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE affected integer;
BEGIN
 UPDATE publication_forward_batches SET note='',scrubbed=true WHERE id IN
 (SELECT id FROM publication_forward_batches WHERE tenant_id=target_tenant AND (target_owner IS NULL OR sender_id=target_owner)
 AND (note<>'' OR NOT scrubbed) ORDER BY id LIMIT 100);
 GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected;
END $$;
-- Material cleanup changes filename only after original blobs and derived content are physically removed.
CREATE FUNCTION forwarding_material_scrub() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.filename='内容已清理' THEN PERFORM scrub_forwarding_material_version(NEW.id); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER forwarding_material_scrub AFTER UPDATE OF filename ON material_versions FOR EACH ROW EXECUTE FUNCTION forwarding_material_scrub();
