package com.dreamcore.workspace.identity;

import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.json.JsonMapper;

/** Explicit local simulation. No provider, network send, public inbox or production fallback. */
@Component
public class LocalPhoneDelivery {
    private final boolean local;
    private final boolean preview;
    private final Path directory;
    private final JsonMapper json = new JsonMapper();
    public LocalPhoneDelivery(Environment env,
            @Value("${dreamcore.phone.delivery:disabled}") String mode,
            @Value("${dreamcore.phone.local-preview:false}") boolean preview,
            @Value("${dreamcore.phone.outbox:./.local/phone-outbox}") String outbox) {
        this.local = env.acceptsProfiles(Profiles.of("local")) && "local".equals(mode);
        this.preview = preview;
        this.directory = Path.of(outbox).toAbsolutePath().normalize();
    }
    public String mode() { return local ? "LOCAL" : "DISABLED"; }
    public boolean previewEnabled(String address) {
        return local && preview && ("127.0.0.1".equals(address) || "0:0:0:0:0:0:0:1".equals(address) || "::1".equals(address));
    }
    public void requireEnabled() {
        if (!local) throw new IdentityException(503,"SMS_UNAVAILABLE");
    }
    public void deliver(UUID id, String phone, String code) {
        requireEnabled();
        Path file = directory.resolve(id + ".json");
        try {
            Files.createDirectories(directory);
            if (Files.isSymbolicLink(directory) || !Files.isDirectory(directory,LinkOption.NOFOLLOW_LINKS)) throw new java.io.IOException();
            Files.setPosixFilePermissions(directory,PosixFilePermissions.fromString("rwx------"));
            Files.createFile(file,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCompletion(int status) {
                    if (status != STATUS_COMMITTED) { try { Files.deleteIfExists(file); } catch (java.io.IOException ignored) {} }
                }
            });
            Files.writeString(file,json.writeValueAsString(Map.of("mode","LOCAL","challengeId",id,"phone",phone,"code",code)),StandardOpenOption.WRITE);
        } catch (java.io.IOException | UnsupportedOperationException error) { throw new IdentityException(503,"SMS_UNAVAILABLE"); }
    }
    public String localCode(UUID id, String address) {
        if (!previewEnabled(address)) throw new IdentityException(404,"LOCAL_PREVIEW_DISABLED");
        try { return json.readTree(Files.readString(directory.resolve(id + ".json"))).get("code").asString(); }
        catch (java.io.IOException error) { throw new IdentityException(404,"CODE_UNAVAILABLE"); }
    }
}
