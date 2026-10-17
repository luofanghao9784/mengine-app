-- Administrative reset markers retain every generation batch and model usage receipt.
-- A reset applies only to this tenant/account within the UTC quota day; tenant limits remain unchanged.
CREATE TABLE briefing_quota_resets (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 owner_id uuid NOT NULL,
 reset_at timestamptz NOT NULL DEFAULT now(),
 reason varchar(255) NOT NULL CHECK (length(trim(reason)) > 0),
 FOREIGN KEY (tenant_id,owner_id) REFERENCES tenant_memberships(tenant_id,account_id)
);
CREATE INDEX briefing_quota_resets_scope ON briefing_quota_resets(tenant_id,owner_id,reset_at DESC);
