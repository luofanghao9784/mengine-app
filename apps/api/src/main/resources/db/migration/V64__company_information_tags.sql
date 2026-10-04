-- Stable company fields reuse profile values/versions; no copying of legacy free-form records.
CREATE TABLE company_information_groups (
 tenant_id uuid NOT NULL REFERENCES tenants(id), field varchar(16) NOT NULL CHECK(field IN ('NAME','INDUSTRY','BUSINESS','TERM')),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), manually_cleared boolean NOT NULL DEFAULT false,
 protect_new_inferences boolean NOT NULL DEFAULT false,
 PRIMARY KEY(tenant_id,field)
);
CREATE TABLE company_information_tags (
 profile_id uuid PRIMARY KEY REFERENCES profile_entries(id), tenant_id uuid NOT NULL,
 field varchar(16) NOT NULL, origin varchar(8) NOT NULL CHECK(origin IN ('HUMAN','AI')),
 human_protected boolean NOT NULL DEFAULT false,
 FOREIGN KEY(tenant_id,field) REFERENCES company_information_groups(tenant_id,field),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES profile_entries(tenant_id,id)
);
CREATE INDEX company_information_scope ON company_information_tags(tenant_id,field);
