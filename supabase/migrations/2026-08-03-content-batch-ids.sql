-- Additive only: nullable batch scope for content_items.
-- Empty/null = shared across all batches of assigned course(s) (fail-open entitlement).
ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS batch_ids jsonb DEFAULT NULL;

COMMENT ON COLUMN content_items.batch_ids IS
  'Optional CourseBatch.id array. When non-empty, only students enrolled in an intersecting batch may see/play this item. Null/[] = course-level (shared).';
