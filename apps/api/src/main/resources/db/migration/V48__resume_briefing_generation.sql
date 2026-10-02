-- First-release product simplification: automatic briefing generation is enabled
-- for existing spaces too. Preserve source fingerprints, authority epochs and
-- current batches; the scheduler continues to enforce authorization and budgets.
UPDATE briefing_generation_policies
SET enabled = true, revision = revision + 1
WHERE enabled = false;
