-- CT-043-A：仅保存同步规则检查成功完成的任务与结果。
CREATE TABLE qo_check_task (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants (id),
    created_by uuid NOT NULL REFERENCES accounts (id),
    title text,
    material_text text NOT NULL CHECK (char_length(material_text) BETWEEN 1 AND 20000),
    status text NOT NULL CHECK (status = 'COMPLETED'),
    result_json jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
