-- A Wiki article is an attached interpretation of one shared material, never a new audience/grant.
CREATE TABLE wiki_articles (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 material_id uuid NOT NULL REFERENCES materials(id),
 revision integer NOT NULL CHECK(revision>0),
 archived boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,material_id)
);
CREATE TABLE wiki_article_versions (
 article_id uuid NOT NULL REFERENCES wiki_articles(id),
 revision integer NOT NULL CHECK(revision>0),
 source_version_id uuid NOT NULL REFERENCES material_versions(id),
 source_run_id uuid NOT NULL REFERENCES knowledge_runs(id),
 draft_id uuid NOT NULL REFERENCES wiki_learning_drafts(id),
 article jsonb,
 execution_class text NOT NULL CHECK(execution_class IN ('live','verification')),
 model_name text,
 action text NOT NULL CHECK(action IN ('PUBLISH','EDIT','ARCHIVE','RESTORE')),
 actor_id uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(article_id,revision)
);
CREATE INDEX wiki_articles_tenant ON wiki_articles(tenant_id,updated_at DESC,id);
CREATE FUNCTION scrub_wiki_material(target uuid) RETURNS void LANGUAGE sql AS $$
 UPDATE wiki_article_versions SET article=NULL,model_name=NULL
 WHERE article_id IN (SELECT id FROM wiki_articles WHERE material_id=target)
$$;
