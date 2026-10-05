CREATE TABLE news_sources (
 id uuid PRIMARY KEY, name varchar(120) NOT NULL, url varchar(2048) NOT NULL,
 format varchar(16) NOT NULL CHECK(format IN ('PAGE','RSS','ATOM')),
 industry varchar(120) NOT NULL DEFAULT '', region varchar(120) NOT NULL DEFAULT '',
 enabled boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1,
 changed_by uuid NOT NULL REFERENCES accounts(id), changed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(url)
);
CREATE TABLE tenant_news_sources (
 tenant_id uuid NOT NULL REFERENCES tenants(id), source_id uuid NOT NULL REFERENCES news_sources(id),
 enabled boolean NOT NULL, changed_by uuid NOT NULL REFERENCES accounts(id), changed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,source_id)
);
CREATE TABLE news_source_changes (
 id uuid PRIMARY KEY, source_id uuid NOT NULL REFERENCES news_sources(id), tenant_id uuid REFERENCES tenants(id),
 actor_id uuid NOT NULL REFERENCES accounts(id), action varchar(32) NOT NULL, revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE news_article_deliveries (
 tenant_id uuid NOT NULL REFERENCES tenants(id), owner_id uuid NOT NULL REFERENCES accounts(id),
 url varchar(2048) NOT NULL, sha256 varchar(64) NOT NULL, task_id uuid NOT NULL REFERENCES conversation_tasks(id),
 published_at timestamptz, retrieved_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,owner_id,url,sha256)
);
CREATE INDEX conversation_public_source_recent ON conversation_tasks(public_query,created_at DESC) WHERE public_query IS NOT NULL;

CREATE TRIGGER headquarters_support_journal AFTER INSERT OR UPDATE OR DELETE ON tenant_news_sources FOR EACH ROW EXECUTE FUNCTION headquarters_support_journal();
CREATE TRIGGER headquarters_support_journal AFTER INSERT OR UPDATE OR DELETE ON news_source_changes FOR EACH ROW EXECUTE FUNCTION headquarters_support_journal();
CREATE TRIGGER headquarters_support_journal AFTER INSERT OR UPDATE OR DELETE ON news_article_deliveries FOR EACH ROW EXECUTE FUNCTION headquarters_support_journal();
