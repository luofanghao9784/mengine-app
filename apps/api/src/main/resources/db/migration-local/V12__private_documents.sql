ALTER TABLE conversation_tasks ADD CONSTRAINT task_conversation_scope UNIQUE(tenant_id,workspace_id,conversation_id,id);
ALTER TABLE conversation_artifacts ADD CONSTRAINT document_artifact_scope UNIQUE(tenant_id,workspace_id,task_id,id);
CREATE TABLE private_documents (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, owner_id uuid NOT NULL,
 workspace_id uuid NOT NULL, source_workspace_id uuid NOT NULL, source_conversation_id uuid NOT NULL,
 source_task_id uuid NOT NULL, source_artifact_id uuid,
 revision integer NOT NULL CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE NULLS NOT DISTINCT(tenant_id,owner_id,source_task_id,source_artifact_id),
 FOREIGN KEY(tenant_id,owner_id) REFERENCES tenant_memberships(tenant_id,account_id),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id),
 FOREIGN KEY(tenant_id,source_workspace_id,source_conversation_id,owner_id) REFERENCES conversations(tenant_id,workspace_id,id,owner_id),
 FOREIGN KEY(tenant_id,source_workspace_id,source_conversation_id,source_task_id) REFERENCES conversation_tasks(tenant_id,workspace_id,conversation_id,id),
 FOREIGN KEY(tenant_id,source_workspace_id,source_task_id,source_artifact_id) REFERENCES conversation_artifacts(tenant_id,workspace_id,task_id,id)
);
CREATE TABLE private_document_versions (
 tenant_id uuid NOT NULL, document_id uuid NOT NULL, number integer NOT NULL CHECK(number>0),
 title varchar(160) NOT NULL, body text NOT NULL CHECK(length(body)<=32768),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(document_id,number), UNIQUE(tenant_id,document_id,number),
 FOREIGN KEY(tenant_id,document_id) REFERENCES private_documents(tenant_id,id)
);
CREATE TABLE private_document_exports (
 tenant_id uuid NOT NULL, document_id uuid NOT NULL, version integer NOT NULL,
 format varchar(8) NOT NULL CHECK(format IN ('docx','pdf')), renderer_version varchar(32) NOT NULL,
 sha256 char(64) NOT NULL, content bytea NOT NULL CHECK(octet_length(content)<=2097152),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(document_id,version,format),
 FOREIGN KEY(tenant_id,document_id,version) REFERENCES private_document_versions(tenant_id,document_id,number)
);
CREATE INDEX private_documents_owner ON private_documents(tenant_id,owner_id,updated_at DESC,id);
CREATE TABLE private_document_writes (
 actor_id uuid NOT NULL, request_id uuid NOT NULL, tenant_id uuid NOT NULL, document_id uuid NOT NULL, version integer NOT NULL,
 PRIMARY KEY(actor_id,request_id),
 FOREIGN KEY(actor_id,request_id) REFERENCES identity_requests(actor_id,request_id),
 FOREIGN KEY(tenant_id,document_id,version) REFERENCES private_document_versions(tenant_id,document_id,number)
);
