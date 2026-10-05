CREATE TABLE briefing_news_search_scope (
 task_id uuid PRIMARY KEY REFERENCES conversation_tasks(id),tenant_id uuid NOT NULL REFERENCES tenants(id),
 provider varchar(16) NOT NULL CHECK(provider IN ('bing-rss','searx')),scope jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE briefing_news_search_queries (
 task_id uuid NOT NULL REFERENCES briefing_news_search_scope(task_id),topic_id varchar(32) NOT NULL,
 query varchar(200) NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(task_id,topic_id)
);
CREATE TRIGGER headquarters_support_journal AFTER INSERT OR UPDATE OR DELETE ON briefing_news_search_scope FOR EACH ROW EXECUTE FUNCTION headquarters_support_journal();
