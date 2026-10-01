-- Per-recipient delivery facts never grant visibility or complete the referenced business task.
CREATE TABLE recommendation_settings (
 tenant_id uuid NOT NULL, actor_id uuid NOT NULL, revision integer NOT NULL DEFAULT 1,
 enabled boolean NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,actor_id), FOREIGN KEY(tenant_id,actor_id) REFERENCES tenant_memberships(tenant_id,account_id)
);
CREATE TABLE delivery_observations (
 tenant_id uuid NOT NULL, actor_id uuid NOT NULL, target_kind varchar(16) NOT NULL CHECK(target_kind IN ('TASK','PUBLICATION')),
 target_id uuid NOT NULL, version_key varchar(120) NOT NULL,
 opened_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,actor_id,target_kind,target_id,version_key),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES tenant_memberships(tenant_id,account_id)
);
CREATE TABLE recommendation_receipts (
 actor_id uuid NOT NULL, request_id uuid NOT NULL, receipt jsonb NOT NULL,
 PRIMARY KEY(actor_id,request_id), FOREIGN KEY(actor_id,request_id) REFERENCES identity_requests(actor_id,request_id)
);
