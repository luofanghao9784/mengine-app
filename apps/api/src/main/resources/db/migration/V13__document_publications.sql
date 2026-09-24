ALTER TABLE private_documents ADD CONSTRAINT publication_document_owner UNIQUE(tenant_id,id,owner_id);
CREATE TABLE document_publications (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, actor_id uuid NOT NULL,
 document_id uuid NOT NULL, document_version integer NOT NULL,
 workspace_id uuid NOT NULL, folder_id uuid, destination_folder_id uuid, update_material_id uuid,
 material_id uuid NOT NULL, material_version_id uuid NOT NULL, material_version integer NOT NULL,
 format varchar(8) NOT NULL CHECK(format IN ('docx','pdf')), filename varchar(180) NOT NULL, sha256 char(64) NOT NULL,
 published_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE NULLS NOT DISTINCT(tenant_id,actor_id,document_id,document_version,workspace_id,folder_id,update_material_id,format),
 UNIQUE(material_version_id),
 FOREIGN KEY(tenant_id,document_id,actor_id) REFERENCES private_documents(tenant_id,id,owner_id),
 FOREIGN KEY(tenant_id,document_id,document_version) REFERENCES private_document_versions(tenant_id,document_id,number),
 FOREIGN KEY(tenant_id,workspace_id,destination_folder_id) REFERENCES material_folders(tenant_id,workspace_id,id),
 FOREIGN KEY(tenant_id,workspace_id,folder_id) REFERENCES material_folders(tenant_id,workspace_id,id),
 FOREIGN KEY(tenant_id,workspace_id,update_material_id) REFERENCES materials(tenant_id,workspace_id,id),
 FOREIGN KEY(tenant_id,workspace_id,material_id,material_version_id) REFERENCES material_versions(tenant_id,workspace_id,material_id,id)
);
CREATE INDEX document_publication_history ON document_publications(tenant_id,actor_id,document_id,published_at DESC,id);
