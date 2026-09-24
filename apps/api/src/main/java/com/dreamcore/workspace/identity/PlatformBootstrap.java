package com.dreamcore.workspace.identity;

import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
public class PlatformBootstrap {
    private final IdentityService identities;
    private final Environment environment;
    public PlatformBootstrap(IdentityService identities, Environment environment) { this.identities = identities; this.environment = environment; }
    public void run() throws Exception {
        Path file = Path.of(environment.getRequiredProperty("BOOTSTRAP_PASSWORD_FILE"));
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || !Files.getPosixFilePermissions(file).equals(PosixFilePermissions.fromString("rw-------"))
                || Files.size(file) > 512) throw new IllegalArgumentException("Bootstrap password file must be a regular owner-only file (0600)");
        String password = Files.readString(file).stripTrailing();
        identities.bootstrap(environment.getRequiredProperty("BOOTSTRAP_EMAIL"), environment.getProperty("BOOTSTRAP_NAME","平台管理员"),password);
    }
}
