ALTER TABLE conversation_tasks DROP CONSTRAINT conversation_tasks_execution_class_check;
ALTER TABLE conversation_tasks ADD CONSTRAINT conversation_tasks_execution_class_check
 CHECK(execution_class IN ('live','verification','external'));
CREATE TABLE briefing_bootstrap_scopes (
 policy_id uuid NOT NULL REFERENCES briefing_generation_policies(id),
 dataset_key varchar(160) NOT NULL,
 PRIMARY KEY(policy_id,dataset_key)
);
