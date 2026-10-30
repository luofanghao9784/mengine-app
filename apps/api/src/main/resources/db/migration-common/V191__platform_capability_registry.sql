-- CT-034-A：平台全局登记目录；企业开通另行实现。
CREATE TABLE qo_capability (
    capability_id text PRIMARY KEY,
    name text NOT NULL,
    kind text CHECK (kind IN ('quality_check')),
    enterprise_function text CHECK (enterprise_function IN (
        'document-parse', 'table-compare', 'quality-check',
        'semantic-annotation', 'repair-suggestion'
    )),
    created_at timestamptz NOT NULL DEFAULT now()
);
