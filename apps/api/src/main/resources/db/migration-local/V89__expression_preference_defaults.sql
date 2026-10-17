-- Headquarters expression defaults are versioned; personal/tenant preferences retain profile provenance.
CREATE TABLE expression_preference_defaults (
 preference_key varchar(40) NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 choice varchar(40) NOT NULL,
 changed_by uuid NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now(),
 request_id uuid NOT NULL UNIQUE,
 PRIMARY KEY(preference_key,revision)
);
ALTER TABLE task_preference_saves DROP CONSTRAINT task_preference_saves_category_check;
ALTER TABLE task_preference_saves DROP CONSTRAINT task_preference_saves_check;
ALTER TABLE task_preference_saves ADD CONSTRAINT task_preference_saves_category_check CHECK(category IN ('RESPONSE_LENGTH','RESPONSE_FORMAT','TONE','BRIEFING_ORDER'));
ALTER TABLE task_preference_saves ADD CONSTRAINT task_preference_saves_check CHECK(
 (category='RESPONSE_LENGTH' AND choice IN ('CONCISE','DETAILED')) OR
 (category='RESPONSE_FORMAT' AND choice IN ('PARAGRAPHS','BULLETS')) OR
 (category='TONE' AND choice IN ('DIRECT','FRIENDLY')) OR
 (category='BRIEFING_ORDER' AND choice IN ('CONCLUSION_FIRST','EVIDENCE_FIRST')));
