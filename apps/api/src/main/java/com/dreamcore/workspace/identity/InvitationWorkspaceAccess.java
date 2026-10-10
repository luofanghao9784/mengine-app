package com.dreamcore.workspace.identity;

import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InvitationWorkspaceAccess {
    private final JdbcTemplate db;
    private final IdentityService identities;
    private final ObjectProvider<TenantAdminService> admins;
    public InvitationWorkspaceAccess(JdbcTemplate db,IdentityService identities,ObjectProvider<TenantAdminService> admins) {
        this.db=db;this.identities=identities;this.admins=admins;
    }
    @Transactional
    public IdentityService.Invitation create(UUID actor,UUID tenant,UUID key,String phone,List<UUID> supplied) {
        if(supplied!=null && supplied.stream().anyMatch(java.util.Objects::isNull))throw IdentityException.invalid();
        var spaces=supplied==null?List.<UUID>of():supplied.stream().distinct().sorted().toList();
        if(spaces.size()>20)throw IdentityException.invalid();
        if(!spaces.isEmpty() && phone.contains("@"))throw new IdentityException(400,"PHONE_VERIFICATION_REQUIRED");
        var invitation=identities.invite(actor,tenant,key,phone);
        String fingerprint=IdentityService.hash(spaces.toString());
        var previous=db.queryForList("SELECT fingerprint FROM invitation_space_plans WHERE invitation_id=?",String.class,invitation.id());
        if(!previous.isEmpty()) {
            if(!previous.getFirst().equals(fingerprint))throw new IdentityException(409,"REQUEST_KEY_REUSED");
            return invitation;
        }
        if(!"PENDING".equals(invitation.status()))throw new IdentityException(409,"INVITATION_UNAVAILABLE");
        for(UUID space:spaces)admins.getObject().spaceInfo(actor,tenant,space);
        db.update("INSERT INTO invitation_space_plans(invitation_id,fingerprint) VALUES (?,?)",invitation.id(),fingerprint);
        for(UUID space:spaces)db.update("INSERT INTO invitation_initial_spaces(invitation_id,tenant_id,workspace_id) VALUES (?,?,?)",invitation.id(),tenant,space);
        return invitation;
    }
    public void apply(UUID invitation,UUID account) {
        var row=db.queryForMap("SELECT tenant_id,created_by,role FROM invitations WHERE id=?",invitation);
        if(!"MEMBER".equals(row.get("role")))return;
        UUID tenant=(UUID)row.get("tenant_id"),actor=(UUID)row.get("created_by");
        identities.member(actor,tenant,true);
        for(UUID space:db.queryForList("SELECT workspace_id FROM invitation_initial_spaces WHERE invitation_id=? ORDER BY workspace_id",UUID.class,invitation)) {
            var admin=admins.getObject();var current=admin.spaceInfo(actor,tenant,space);
            UUID key=UUID.nameUUIDFromBytes((invitation+":"+space).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            admin.grant(actor,tenant,space,account,key,current.version(),true);
        }
    }
}
