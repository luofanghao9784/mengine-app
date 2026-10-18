package com.dreamcore.workspace.profile;

import com.dreamcore.workspace.identity.IdentityException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** Read-through internal source. No copied background, credentials or broadened permissions. */
@Service
public class CompanyBackgroundSourceService {
    public record Entry(UUID id, UUID versionId, int revision, CompanyInformationService.Field field,
                        String label, String meaning, String origin, boolean humanProtected,
                        String provenance, Instant updatedAt) {}
    public record Source(UUID tenantId, String sourceId, String type, String state, String version,
                         String knowledgeIntegration, List<Entry> entries) {}
    private final CompanyInformationService information;
    private final ProfileService profiles;
    public CompanyBackgroundSourceService(CompanyInformationService information, ProfileService profiles) {
        this.information=information; this.profiles=profiles;
    }
    // Existing permission checks take shared locks, so this cannot use a read-only DB transaction.
    @Transactional(isolation=Isolation.REPEATABLE_READ)
    public Source get(UUID actor, UUID tenant) {
        var page=information.get(actor,tenant);
        var entries=new ArrayList<Entry>();
        for(var group:page.groups()) for(var tag:group.tags()) {
            var value=profiles.get(actor,tenant,tag.id(),tag.revision());
            // The profile service enforces source permissions and lifecycle visibility as well.
            if(!"ACTIVE".equals(value.effectiveStatus())) continue;
            entries.add(new Entry(tag.id(),value.versionId(),tag.revision(),group.field(),tag.label(),
                tag.meaning(),tag.origin(),tag.humanProtected(),value.provenance(),tag.updatedAt()));
        }
        entries.sort(Comparator.comparing(e->e.id().toString()));
        String fingerprint=tenant+":"+entries.stream().map(e->e.id()+":"+e.versionId()).toList();
        String version;
        try { version=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(fingerprint.getBytes(StandardCharsets.UTF_8))); }
        catch(java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
        return new Source(tenant,"company-background:"+tenant,"COMPANY_BACKGROUND",
            entries.isEmpty()?"NO_READABLE_ENTRIES":"AVAILABLE",version,"REFERENCE_READY",List.copyOf(entries));
    }
    @Transactional(isolation=Isolation.REPEATABLE_READ)
    public Entry entry(UUID actor,UUID tenant,UUID id,Integer expectedRevision) {
        if(expectedRevision!=null&&expectedRevision<1) throw IdentityException.invalid();
        var entry=get(actor,tenant).entries().stream().filter(e->e.id().equals(id)).findFirst()
            .orElseThrow(()->new IdentityException(404,"COMPANY_BACKGROUND_NOT_FOUND"));
        if(expectedRevision!=null&&entry.revision()!=expectedRevision)
            throw new IdentityException(409,"COMPANY_BACKGROUND_VERSION_CHANGED");
        return entry;
    }
}
