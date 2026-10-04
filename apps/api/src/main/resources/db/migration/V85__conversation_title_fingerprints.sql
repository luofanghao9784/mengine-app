-- Keep only a concurrency fingerprint; do not duplicate private prompt/title text in auxiliary jobs.
ALTER TABLE conversation_titles ADD COLUMN fallback_hash varchar(64);
UPDATE conversation_titles SET fallback_hash=encode(sha256(convert_to(fallback_title,'UTF8')),'hex');
ALTER TABLE conversation_titles ALTER COLUMN fallback_hash SET NOT NULL;
ALTER TABLE conversation_titles DROP COLUMN fallback_title;
