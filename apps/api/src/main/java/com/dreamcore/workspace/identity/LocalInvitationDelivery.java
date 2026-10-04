package com.dreamcore.workspace.identity;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
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

/** Development-only delivery; plaintext tokens never enter database, response bodies or logs. */
@Component
public class LocalInvitationDelivery {
    private final String mode;
    private final Path directory;
    private final boolean local;
    private final JsonMapper json = new JsonMapper();
    public LocalInvitationDelivery(@Value("${dreamcore.invitation.delivery}") String mode,
                                   @Value("${dreamcore.invitation.outbox}") String directory, Environment env) {
        this.mode = mode; this.directory = Path.of(directory).toAbsolutePath().normalize();
        this.local = env.acceptsProfiles(Profiles.of("local"));
    }
    String mode() { return local && "local".equals(mode) ? "LOCAL" : "DISABLED"; }
    public String localToken(UUID id) {
        if (!"LOCAL".equals(mode())) throw new IdentityException(404,"LOCAL_PREVIEW_DISABLED");
        try { return json.readTree(Files.readString(directory.resolve(id + ".json"))).get("token").asString(); }
        catch (IOException failure) { throw new IdentityException(404,"INVITATION_UNAVAILABLE"); }
    }
    public void deliver(UUID id, String email, String token) {
        deliver(id,email,token,"/workspace/#invite=");
    }
    public void deliverPlatform(UUID id,String contact,String token) {
        deliver(id,contact,token,"/platform-admin/#invite=");
    }
    private void deliver(UUID id,String email,String token,String entry) {
        if (!local || !"local".equals(mode)) throw new IdentityException(503, "INVITATION_DELIVERY_UNAVAILABLE");
        Path file = directory.resolve(id + ".json");
        try {
            Files.createDirectories(directory);
            if (Files.isSymbolicLink(directory) || !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)) throw new IOException();
            Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwx------"));
            Files.createFile(file, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCompletion(int status) {
                    if (status != STATUS_COMMITTED) {
                        try { Files.deleteIfExists(file); } catch (IOException ignored) { /* Token is invalid after rollback. */ }
                    }
                }
            });
            Files.writeString(file, json.writeValueAsString(Map.of("invitationId", id, email.startsWith("+") ? "phone" : "email", email, "token", token, "path", entry + token)),
                    StandardCharsets.UTF_8, StandardOpenOption.WRITE);
        } catch (IOException | UnsupportedOperationException failure) { throw new IdentityException(503, "INVITATION_DELIVERY_UNAVAILABLE"); }
    }
}
