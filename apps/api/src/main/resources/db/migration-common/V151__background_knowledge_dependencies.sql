-- Background knowledge is a versioned projection of the original company profile,
-- not a second editable copy. Only explicitly bound metric versions depend on it.
CREATE FUNCTION background_version_current(target_tenant uuid, target_version uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM company_information_tags tag
  JOIN profile_entries e ON e.id=tag.profile_id AND e.tenant_id=tag.tenant_id
  JOIN profile_versions v ON v.entry_id=e.id AND v.revision=e.revision AND v.tenant_id=e.tenant_id
  WHERE tag.tenant_id=target_tenant AND v.id=target_version AND e.scope='TENANT'
   AND v.status='ACTIVE' AND NOT v.scrubbed
   AND (v.expires_at IS NULL OR v.expires_at>clock_timestamp())
   AND object_is_active('PROFILE_VERSION',v.id) AND company_profile_readable(v.id)
 )
$$;
CREATE FUNCTION metric_background_current(target uuid, revision integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (SELECT 1 FROM scene_metric_versions v JOIN scene_metrics m ON m.id=v.metric_id
  WHERE m.id=target AND v.version=revision AND NOT EXISTS (
   SELECT 1 FROM jsonb_array_elements_text(coalesce(v.definition->'backgroundVersionIds','[]'::jsonb)) r(id)
   WHERE NOT background_version_current(m.tenant_id,r.id::uuid)))
$$;
ALTER FUNCTION task_datasets_readable(uuid) RENAME TO task_datasets_readable_before_background;
CREATE FUNCTION task_datasets_readable(task uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT task_datasets_readable_before_background(task) AND NOT EXISTS (
  SELECT 1 FROM task_metric_dependencies(task) d WHERE NOT metric_background_current(d.metric_id,d.version))
$$;
-- Record a permanent fence when a background revision changes, so an in-flight
-- task cannot be revived by restoring an earlier value or reauthorizing a source.
CREATE FUNCTION fence_background_metric_tasks() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.revision IS DISTINCT FROM NEW.revision THEN
  INSERT INTO task_dataset_fences(task_id,attempt_number,reason)
  SELECT t.id,t.attempt,'BACKGROUND_VERSION_CHANGED' FROM conversation_tasks t
  WHERE t.tenant_id=NEW.tenant_id AND t.status='RUNNING' AND t.attempt>0 AND EXISTS (
   SELECT 1 FROM task_metric_dependencies(t.id) d JOIN scene_metric_versions mv ON mv.metric_id=d.metric_id AND mv.version=d.version
   JOIN profile_versions pv ON pv.entry_id=NEW.id
   WHERE mv.definition->'backgroundVersionIds' ? pv.id::text)
  ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END
$$;
CREATE TRIGGER background_metric_fence AFTER UPDATE OF revision ON profile_entries FOR EACH ROW EXECUTE FUNCTION fence_background_metric_tasks();
