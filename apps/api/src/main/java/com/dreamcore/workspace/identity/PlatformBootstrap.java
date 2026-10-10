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
    private final PlatformStaffService staff;
    public PlatformBootstrap(IdentityService identities, Environment environment,PlatformStaffService staff) { this.identities = identities; this.environment = environment;this.staff=staff; }
    public void run() throws Exception {
        boolean activation=environment.containsProperty("BOOTSTRAP_PHONE");
        Path file = Path.of(environment.getRequiredProperty(activation?"BOOTSTRAP_ACTIVATION_FILE":"BOOTSTRAP_PASSWORD_FILE"));
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || !Files.getPosixFilePermissions(file).equals(PosixFilePermissions.fromString("rw-------"))
                || Files.size(file) > 512) throw new IllegalArgumentException("Bootstrap password file must be a regular owner-only file (0600)");
        String password = Files.readString(file).stripTrailing();
        if(activation){staff.initialize(environment.getRequiredProperty("BOOTSTRAP_PHONE"),password);return;}
        identities.bootstrap(environment.getRequiredProperty("BOOTSTRAP_EMAIL"), environment.getProperty("BOOTSTRAP_NAME","平台管理员"),password);
    }
}
