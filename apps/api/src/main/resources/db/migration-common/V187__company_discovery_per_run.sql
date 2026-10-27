-- Every nonempty chunk of a run has the same company eligibility: the composite
-- foreign key fixes its tenant/workspace/material/version, and eligibility checks
-- the run state plus material-level permissions. Reuse that decision only within
-- this statement. Claim/result checks still consult the live policy separately.
-- Keep company_analysis_current_chunks unchanged for indexed, targeted claim and
-- retry lookups: materialization here deliberately serves only global discovery.
CREATE VIEW company_analysis_discovery_chunks AS
 WITH current_runs AS MATERIALIZED (
   SELECT r.id FROM knowledge_runs r
   JOIN material_versions v ON v.id=r.version_id
   JOIN materials m ON m.id=r.material_id
   WHERE v.number=m.current_version
     AND r.generation=(SELECT max(x.generation) FROM knowledge_runs x WHERE x.version_id=r.version_id)
 ), eligible_runs AS MATERIALIZED (
   SELECT r.id FROM current_runs r
   JOIN LATERAL (
     SELECT c.id FROM knowledge_chunks c
     WHERE c.run_id=r.id AND length(c.content)>0
     ORDER BY c.ordinal LIMIT 1
   ) representative ON true
   WHERE company_chunk_eligible(representative.id)
 )
 SELECT c.id,c.tenant_id FROM eligible_runs r
 JOIN knowledge_chunks c ON c.run_id=r.id
 WHERE length(c.content)>0;
