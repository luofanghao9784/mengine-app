-- Metadata only: retain the original anomaly and an idempotent platform retry receipt.
CREATE TABLE platform_engine_retries (
 actor_id uuid NOT NULL REFERENCES accounts(id), request_id uuid NOT NULL,
 tenant_id uuid REFERENCES tenants(id), channel varchar(40) NOT NULL, source_id uuid NOT NULL,
 input_hash varchar(64) NOT NULL, previous_state varchar(40) NOT NULL, previous_code varchar(80),
 result_id uuid, result_state varchar(40) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_id)
);
CREATE INDEX platform_engine_retry_source ON platform_engine_retries(channel,source_id,created_at);
