-- The additional stable structure checksum is derived metadata, not a new permission or metric scope.
CREATE OR REPLACE FUNCTION scene_table_scope(meta jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT (meta - 'dictionarySchemaFingerprint' - 'version' - 'updatedAt' - 'sourceBasis' - 'governance') ||
  CASE WHEN meta ? 'sourceBasis' THEN jsonb_build_object('sourceBasis',
   (SELECT coalesce(jsonb_agg(item - 'version' - 'sha256' - 'collectedAt' ORDER BY item->>'id'),'[]'::jsonb)
    FROM jsonb_array_elements(meta->'sourceBasis') item)) ELSE '{}'::jsonb END ||
  CASE WHEN meta ? 'governance' THEN jsonb_build_object('governance',(meta->'governance') - 'sourceVersion' - 'policyDigest' - 'sourcePolicyDigests') ELSE '{}'::jsonb END
$$;
