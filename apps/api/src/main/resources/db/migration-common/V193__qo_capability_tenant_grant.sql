-- CT-040：第四端将已登记的企业功能开通给指定企业。
CREATE TABLE qo_capability_tenant_grant (
    tenant_id uuid NOT NULL REFERENCES tenants (id),
    enterprise_function text NOT NULL CHECK (enterprise_function IN (
        'document-parse', 'table-compare', 'quality-check',
        'semantic-annotation', 'repair-suggestion'
    )),
    capability_id text NOT NULL REFERENCES qo_capability (capability_id),
    granted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, enterprise_function)
);
