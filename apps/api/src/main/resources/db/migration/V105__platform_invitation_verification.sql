ALTER TABLE phone_challenges DROP CONSTRAINT phone_challenges_purpose_check;
ALTER TABLE phone_challenges ADD CONSTRAINT phone_challenges_purpose_check CHECK(purpose IN ('JOIN','BIND','RESET','STAFF'));
ALTER TABLE phone_challenges ADD COLUMN staff_invitation_id uuid REFERENCES platform_staff_invitations(id);
