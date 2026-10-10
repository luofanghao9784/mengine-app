-- A singleton receipt makes initial activation permanently one-time, including after role revocation.
CREATE TABLE platform_initialization (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 invitation_id uuid UNIQUE REFERENCES platform_staff_invitations(id),
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_initialization(singleton,completed_at)
 SELECT true,now() WHERE EXISTS(SELECT 1 FROM platform_accounts)
 OR EXISTS(SELECT 1 FROM platform_roles);
