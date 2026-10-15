"""One-time delegated metric authorization and current-version parser recovery.
No old outcomes are rewritten; normal workers enforce permissions again.
"""
import json,pathlib,subprocess,urllib.request
E=pathlib.Path('/var/lib/dreamcore/deploy-evidence/reliability-20261016')
PG=['docker','exec','dreamcore-app-check-20261010','psql','-U','dreamcore_migration_check','-d','dreamcore_trial','-At','-v','ON_ERROR_STOP=1','-c']
with urllib.request.urlopen('http://127.0.0.1:18481/actuator/health',timeout=10) as response:assert response.status==200
assert subprocess.check_output(PG+["SELECT max(version::int) FROM flyway_schema_history WHERE success AND version IS NOT NULL"],text=True).strip()=='144'
sql="""
BEGIN;
SELECT pg_advisory_xact_lock(20261016,144);
DO $$ DECLARE tenant uuid='951228cb-58d8-474f-b784-55f5b946e81a'; actor uuid;
 request uuid='9bbe08ef-47a0-437b-886d-85fe4780a68e';
BEGIN
 IF EXISTS(SELECT 1 FROM identity_audit WHERE request_id=request) THEN RETURN; END IF;
 SELECT maintainer_id INTO STRICT actor FROM scene_bindings WHERE tenant_id=tenant AND governance_valid_until>now();
 INSERT INTO metric_generation_settings(tenant_id,auto_publish) VALUES(tenant,true)
 ON CONFLICT(tenant_id) DO UPDATE SET auto_publish=true;
 INSERT INTO identity_audit(actor_id,tenant_id,action,target_id,outcome,request_id)
 VALUES(actor,tenant,'METRIC_DELEGATED_DEFINITION_ENABLED',tenant,'SUCCESS',request);
 PERFORM v.id FROM material_versions v JOIN active_materials m ON m.id=v.material_id AND m.current_version=v.number
 WHERE m.tenant_id=tenant AND m.in_library FOR UPDATE OF v;
 WITH candidates AS (
 SELECT gen_random_uuid() id,m.tenant_id,m.workspace_id,m.id material_id,v.id version_id,r.generation+1 generation
 FROM active_materials m JOIN material_versions v ON v.material_id=m.id AND v.number=m.current_version
 JOIN LATERAL(SELECT * FROM knowledge_runs k WHERE k.version_id=v.id ORDER BY generation DESC LIMIT 1) r ON true
 WHERE m.tenant_id=tenant AND m.in_library AND r.status='FAILED' AND r.warnings='PARSER_UNAVAILABLE_OR_LIMIT'
 AND (library_mask(actor,m.tenant_id,'MATERIAL',m.id)&2)=2
 ), inserted AS (
 INSERT INTO knowledge_runs(id,tenant_id,workspace_id,material_id,version_id,generation,requested_by,status)
 SELECT id,tenant_id,workspace_id,material_id,version_id,generation,actor,'QUEUED' FROM candidates RETURNING id,tenant_id
 )
 INSERT INTO identity_audit(actor_id,tenant_id,action,target_id,outcome,request_id)
 SELECT actor,tenant_id,'KNOWLEDGE_QUEUE',id,'SUCCESS',request FROM inserted;
END $$;
COMMIT;
SELECT json_build_object('queued',count(*) FILTER(WHERE action='KNOWLEDGE_QUEUE'),'delegationAudit',count(*) FILTER(WHERE action='METRIC_DELEGATED_DEFINITION_ENABLED')) FROM identity_audit WHERE request_id='9bbe08ef-47a0-437b-886d-85fe4780a68e';
"""
result=subprocess.check_output(PG+[sql],text=True)
report=json.loads(result.strip().splitlines()[-1]);(E/'recovery.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
