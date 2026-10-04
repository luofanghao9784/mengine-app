-- Independent additive UI preference storage; source cards and permissions remain authoritative.
CREATE TABLE IF NOT EXISTS personal_follow_boards (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  owner_id uuid NOT NULL REFERENCES accounts(id),
  board varchar(20) NOT NULL CHECK (board IN ('PRIVATE', 'PUBLICATIONS')),
  revision integer NOT NULL DEFAULT 0,
  preference jsonb,
  FOREIGN KEY (tenant_id, owner_id) REFERENCES tenant_memberships(tenant_id, account_id),
  PRIMARY KEY (tenant_id, owner_id, board)
);
CREATE TABLE IF NOT EXISTS personal_follow_board_receipts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  board varchar(20) NOT NULL,
  applied_revision integer NOT NULL,
  FOREIGN KEY (tenant_id, owner_id, board) REFERENCES personal_follow_boards(tenant_id, owner_id, board)
);
