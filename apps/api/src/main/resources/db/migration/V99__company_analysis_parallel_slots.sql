-- Two independent inference batches may run; group revisions still serialize application.
-- Existing active attempts retain slot 1 and their original recovery semantics.
ALTER TABLE company_analysis_attempts ADD COLUMN dispatch_slot smallint NOT NULL DEFAULT 1 CHECK(dispatch_slot BETWEEN 1 AND 2);
DROP INDEX company_analysis_one_tenant;
CREATE UNIQUE INDEX company_analysis_tenant_slot ON company_analysis_attempts(tenant_id,dispatch_slot) WHERE state IN ('CLAIMED','DISPATCHED');
