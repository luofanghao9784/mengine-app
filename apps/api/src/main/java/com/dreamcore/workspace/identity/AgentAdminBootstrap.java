package com.dreamcore.workspace.identity;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Arrays;
import java.util.Set;
import java.util.UUID;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Explicit CLI provisioning for synthetic preview accounts; never runs on application startup. */
@Component
public class AgentAdminBootstrap {
    private final JdbcTemplate db;
    private final PasswordEncoder passwords;
    private final IdentityAudit audit;
    private final Environment environment;

    public AgentAdminBootstrap(JdbcTemplate db, PasswordEncoder passwords, IdentityAudit audit, Environment environment) {
        this.db = db;
        this.passwords = passwords;
        this.audit = audit;
        this.environment = environment;
    }

    private static void requirePreview(Environment environment) {
        String[] profiles = environment.getActiveProfiles();
        if (!"true".equals(environment.getProperty("DREAMCORE_PREVIEW_AGENT_BOOTSTRAP"))
                || profiles.length == 0 || !Arrays.stream(profiles).allMatch(Set.of("local", "trial")::contains)) {
            throw new IdentityException(403, "AGENT_BOOTSTRAP_REQUIRES_EXPLICIT_PREVIEW_AND_LOCAL_TRIAL");
        }
    }

    private static String password(Environment environment) {
        try {
            Path file = Path.of(environment.getRequiredProperty("AGENT_BOOTSTRAP_PASSWORD_FILE"));
            if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)
                    || !Files.getPosixFilePermissions(file, LinkOption.NOFOLLOW_LINKS)
                        .equals(PosixFilePermissions.fromString("rw-------"))
                    || Files.size(file) > 512) {
                throw new IllegalArgumentException();
            }
            // Bound the read as well, and do not follow a link swapped in after validation.
            try (var input = Files.newInputStream(file, LinkOption.NOFOLLOW_LINKS)) {
                byte[] bytes = input.readNBytes(513);
                if (bytes.length > 512) throw new IllegalArgumentException();
                String value = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString().stripTrailing();
                IdentityService.password(value);
                return value;
            }
        } catch (Exception failure) {
            // File paths, contents and underlying exception messages are never reported.
            throw new IdentityException(400, "AGENT_BOOTSTRAP_REQUIRES_VALID_PASSWORD_FILE_0600_MAX_512_BYTES");
        }
    }

    /** Called before Spring refresh so an invalid invocation cannot even run migrations. */
    public static void preflight(Environment environment) {
        requirePreview(environment);
        PlatformIdentity.loginName(environment.getProperty("AGENT_BOOTSTRAP_LOGIN"));
        IdentityService.name(environment.getProperty("AGENT_BOOTSTRAP_NAME", "预览 AI 管理员"), 80);
        password(environment);
    }

    @Transactional
    public UUID run() {
        requirePreview(environment);
        String login = PlatformIdentity.loginName(environment.getProperty("AGENT_BOOTSTRAP_LOGIN"));
        String name = IdentityService.name(environment.getProperty("AGENT_BOOTSTRAP_NAME", "预览 AI 管理员"), 80);
        String password = password(environment);
        // Serialize concurrent explicit invocations, including different requested logins.
        db.execute("SELECT pg_advisory_xact_lock(743012010)");
        if (Boolean.TRUE.equals(db.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM platform_roles WHERE role='AGENT_ADMIN')
                    OR EXISTS (SELECT 1 FROM agent_platform_accounts WHERE login_name=?)
                    OR EXISTS (SELECT 1 FROM platform_accounts WHERE login_name=?)
                    OR EXISTS (SELECT 1 FROM accounts WHERE lower(trim(email))=? OR phone=? OR username=?)
                """, Boolean.class, login, login, login, login, login))) {
            throw new IdentityException(409, "AGENT_BOOTSTRAP_ALREADY_EXISTS");
        }
        UUID id = UUID.randomUUID();
        // Shared accounts are audit identities, with an unrelated unusable customer credential.
        db.update("INSERT INTO accounts(id,email,display_name,password_hash,status) VALUES (?,?,?,?,'ACTIVE')",
                id, "agent-" + id + "@identity.invalid", name, passwords.encode(UUID.randomUUID().toString()));
        db.update("INSERT INTO agent_platform_accounts(account_id,login_name,password_hash,credential_version) VALUES (?,?,?,0)",
                id, login, passwords.encode(password));
        db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'AGENT_ADMIN')", id);
        audit.record(id, null, "AGENT_BOOTSTRAP", id, "SUCCESS");
        return id;
    }
}
