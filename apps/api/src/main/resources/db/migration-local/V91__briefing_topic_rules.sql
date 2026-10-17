ALTER TABLE expression_rule_books DROP CONSTRAINT expression_rule_books_target_check;
ALTER TABLE expression_rule_books ADD CONSTRAINT expression_rule_books_target_check CHECK(target IN ('ALL','BRIEFING','TOPICS'));
CREATE TABLE briefing_topic_selections (
 task_id uuid PRIMARY KEY REFERENCES conversation_tasks(id) ON DELETE CASCADE,
 candidates jsonb NOT NULL,
 selected_index integer NOT NULL CHECK(selected_index BETWEEN 0 AND 2),
 strategy_version varchar(16) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
