package com.dreamcore.workspace;

import com.dreamcore.workspace.identity.AgentAdminBootstrap;
import com.dreamcore.workspace.identity.IdentityException;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AgentAdminBootstrapIntegrationTest {
    private static final String PASSWORD = "synthetic-preview-agent-password";
    private static final String LOGIN = "preview-agent@example.test";
    private static final String AUTH = "/api/agent-admin/v1/auth";
    private static final JsonMapper JSON = new JsonMapper();
    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) { IsolatedTestDatabase.register(registry); }
    @Autowired JdbcTemplate db;
    @Autowired PasswordEncoder passwords;
    @Autowired Environment environment;
    @Autowired PlatformTransactionManager transactions;
    @LocalServerPort int port;
    @TempDir Path directory;
    private Path passwordFile;

    @BeforeEach void prepare() throws Exception {
        db.update("DELETE FROM agent_platform_sessions");
        db.update("DELETE FROM identity_audit");
        db.update("DELETE FROM platform_roles");
        db.update("DELETE FROM agent_platform_accounts");
        db.update("DELETE FROM platform_accounts");
        db.update("DELETE FROM accounts");
        passwordFile = directory.resolve("password");
        Files.writeString(passwordFile, PASSWORD + "\n");
        Files.setPosixFilePermissions(passwordFile, PosixFilePermissions.fromString("rw-------"));
    }

    record Result(int exit, String output) {}

    private Result cli(String profiles, String optIn, String login, Path file) throws Exception {
        var command = new ArrayList<>(List.of(
                Path.of(System.getProperty("java.home"), "bin", "java").toString(), "-cp",
                System.getProperty("surefire.test.class.path", System.getProperty("java.class.path")),
                WorkspaceApplication.class.getName(), "--bootstrap-agent-admin",
                "--spring.profiles.active=" + profiles,
                "--spring.main.banner-mode=off"));
        // Child JVMs do not inherit Surefire's scheduler delays.
        System.getProperties().stringPropertyNames().stream().filter(k -> k.endsWith("initial-delay-ms"))
                .forEach(k -> command.add("--" + k + "=" + System.getProperty(k)));
        var builder = new ProcessBuilder(command).redirectErrorStream(true);
        var env = builder.environment();
        env.keySet().removeIf(k -> k.startsWith("AGENT_") || k.startsWith("BOOTSTRAP_")
                || k.startsWith("SPRING_") || k.equals("DREAMCORE_PREVIEW_AGENT_BOOTSTRAP"));
        env.put("DATABASE_URL", environment.getRequiredProperty("spring.datasource.url"));
        env.put("AGENT_BOOTSTRAP_LOGIN", login);
        env.put("AGENT_BOOTSTRAP_PASSWORD_FILE", file.toString());
        env.put("BRIEFING_AUTOMATIC_ENABLED", "false");
        env.put("ONGOING_PLANS_ENABLED", "false");
        if (optIn != null) env.put("DREAMCORE_PREVIEW_AGENT_BOOTSTRAP", optIn);
        Path log = Files.createTempFile(directory, "cli-", ".log");
        builder.redirectOutput(log.toFile());
        var process = builder.start();
        try {
            assertTrue(process.waitFor(60, TimeUnit.SECONDS), "Bootstrap CLI must terminate without a web server");
            String output = Files.readString(log);
            assertFalse(output.contains(PASSWORD), "CLI logs must not contain the password");
            assertFalse(output.contains("Tomcat started"), "CLI must use a non-web context");
            return new Result(process.exitValue(), output);
        } finally {
            if (process.isAlive()) process.destroyForcibly().waitFor();
        }
    }

    private Map<String, Long> counts() {
        var counts = new LinkedHashMap<String, Long>();
        for (String table : List.of("accounts", "agent_platform_accounts", "platform_accounts", "platform_roles",
                "tenant_memberships", "qo_capability_tenant_grant", "identity_audit", "flyway_schema_history")) {
            counts.put(table, db.queryForObject("SELECT count(*) FROM " + table, Long.class));
        }
        return counts;
    }

    private void rejected(String profiles, String optIn, Path file) throws Exception {
        var before = counts();
        var result = cli(profiles, optIn, LOGIN, file);
        assertNotEquals(0, result.exit(), result.output());
        assertTrue(result.output().contains("Preview agent administrator bootstrap failed"));
        assertFalse(result.output().contains("HikariPool"), "Preflight must reject before connecting or migrating");
        assertEquals(before, counts());
    }

    @Test void missingOrNonTrueSwitchNeverWrites() throws Exception {
        for (String optIn : new String[]{null, "false", "1", "TRUE"}) rejected("local", optIn, passwordFile);
    }

    @Test void onlyExplicitNonemptyLocalTrialProfilesAreAllowed() throws Exception {
        for (String profiles : List.of("", "prod", "production", "local,prod", "local,production", "test", "trial,staging")) {
            rejected(profiles, "true", passwordFile);
        }
    }

    @Test void invalidPasswordFilesNeverWrite() throws Exception {
        Files.setPosixFilePermissions(passwordFile, PosixFilePermissions.fromString("rw-r--r--"));
        rejected("local", "true", passwordFile);
        Files.setPosixFilePermissions(passwordFile, PosixFilePermissions.fromString("rw-------"));
        Path link = directory.resolve("link");
        Files.createSymbolicLink(link, passwordFile);
        rejected("local", "true", link);
        Files.writeString(passwordFile, PASSWORD + "x".repeat(513));
        rejected("local", "true", passwordFile);
        rejected("local", "true", directory);
        rejected("local", "true", directory.resolve("missing"));
        Files.writeString(passwordFile, "");
        rejected("local", "true", passwordFile);
    }

    @Test void preflightExceptionsNeverContainPassword() throws Exception {
        var env = new MockEnvironment().withProperty("DREAMCORE_PREVIEW_AGENT_BOOTSTRAP", "true")
                .withProperty("AGENT_BOOTSTRAP_LOGIN", LOGIN)
                .withProperty("AGENT_BOOTSTRAP_PASSWORD_FILE", passwordFile.toString());
        env.setActiveProfiles("local");
        Files.writeString(passwordFile, PASSWORD.repeat(20));
        var failure = assertThrows(IdentityException.class, () -> AgentAdminBootstrap.preflight(env));
        assertFalse(failure.toString().contains(PASSWORD));
        assertNull(failure.getCause());
    }

    @Test void localAndTrialCreateLoginableAgentOnlyAndRepeatNeverChangesCredentials() throws Exception {
        for (String profiles : List.of("local", "trial", "local,trial")) {
            prepare();
            // No startup provisioning even when the bootstrap bean is present.
            assertEquals(0L, counts().get("agent_platform_accounts"));
            var result = cli(profiles, "true", "  Preview-Agent@Example.Test  ", passwordFile);
            assertEquals(0, result.exit(), result.output());
            assertTrue(result.output().contains("Preview agent administrator bootstrap completed"));
            var credential = db.queryForMap("SELECT * FROM agent_platform_accounts WHERE login_name=?", LOGIN);
            UUID id = (UUID) credential.get("account_id");
            assertTrue(passwords.matches(PASSWORD, (String) credential.get("password_hash")));
            assertEquals(0L, ((Number) credential.get("credential_version")).longValue());
            var account = db.queryForMap("SELECT * FROM accounts WHERE id=?", id);
            assertEquals("ACTIVE", account.get("status"));
            assertFalse(passwords.matches(PASSWORD, (String) account.get("password_hash")));
            assertEquals(List.of("AGENT_ADMIN"), db.queryForList("SELECT role FROM platform_roles WHERE account_id=?", String.class, id));
            assertEquals(0L, counts().get("platform_accounts"));
            assertEquals(0L, counts().get("tenant_memberships"));
            assertEquals(0L, counts().get("qo_capability_tenant_grant"));
            assertEquals(1, db.queryForObject("SELECT count(*) FROM identity_audit WHERE action='AGENT_BOOTSTRAP' AND actor_id=? AND target_id=? AND tenant_id IS NULL", Integer.class, id, id));
            assertFalse(db.queryForList("SELECT * FROM identity_audit").toString().contains(PASSWORD));
            loginAndCheckRealms();
            var before = counts();
            Files.writeString(passwordFile, "another-synthetic-password\n");
            var repeated = cli(profiles, "true", LOGIN, passwordFile);
            assertNotEquals(0, repeated.exit());
            assertEquals(credential, db.queryForMap("SELECT * FROM agent_platform_accounts WHERE account_id=?", id));
            assertEquals(account, db.queryForMap("SELECT * FROM accounts WHERE id=?", id));
            assertEquals(before, counts());
            // A different login must also be refused while any AGENT_ADMIN exists.
            assertNotEquals(0, cli(profiles, "true", "other-preview-agent", passwordFile).exit());
            assertEquals(before, counts());
        }
    }

    private void loginAndCheckRealms() throws Exception {
        var cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        var browser = HttpClient.newBuilder().cookieHandler(cookies).build();
        var csrfResponse = browser.send(HttpRequest.newBuilder(uri(AUTH + "/csrf")).GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, csrfResponse.statusCode());
        String csrf = JSON.readTree(csrfResponse.body()).get("token").asString();
        var login = browser.send(HttpRequest.newBuilder(uri(AUTH + "/login")).header("Content-Type", "application/json")
                .header("X-CSRF-TOKEN", csrf).POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(Map.of("username", LOGIN, "password", PASSWORD)))).build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(200, login.statusCode(), login.body());
        assertTrue(login.headers().allValues("Set-Cookie").stream().anyMatch(c -> c.startsWith("DREAMCORE_AGENT=") && c.contains("HttpOnly") && c.contains("Path=/api/agent-admin/")));
        String token = cookies.getCookieStore().getCookies().stream().filter(c -> c.getName().equals("DREAMCORE_AGENT")).findFirst().orElseThrow().getValue();
        assertEquals(200, browser.send(HttpRequest.newBuilder(uri(AUTH + "/me")).GET().build(), HttpResponse.BodyHandlers.ofString()).statusCode());
        // Send cookies explicitly beyond their browser path, including attempted realm relabeling.
        for (String path : List.of("/api/v1/auth/me", "/api/tenant-admin/v1/opened-capabilities", "/api/platform-admin/v1/auth/me")) {
            for (String cookieName : List.of("DREAMCORE_AGENT", "DREAMCORE_SESSION", "DREAMCORE_PLATFORM")) {
                var response = HttpClient.newHttpClient().send(HttpRequest.newBuilder(uri(path)).header("Cookie", cookieName + "=" + token).GET().build(), HttpResponse.BodyHandlers.ofString());
                assertTrue(response.statusCode() == 401 || response.statusCode() == 403, path + " " + cookieName + " " + response.statusCode());
            }
        }
    }

    private URI uri(String path) { return URI.create("http://127.0.0.1:" + port + path); }

    @Test void existingLoginInAnyRealmIsConflictWithoutMutation() throws Exception {
        for (String realm : List.of("email", "phone", "username", "platform_accounts", "agent_platform_accounts", "role")) {
            prepare();
            UUID id = UUID.randomUUID();
            String login = realm.equals("phone") ? "+8613800000016" : realm.equals("username") ? "preview-agent" : LOGIN;
            db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)", id,
                    realm.equals("email") ? login : "existing-" + id + "@example.test", "已存在的合成账号", passwords.encode("existing-synthetic-password"));
            if (realm.equals("phone")) {
                db.update("UPDATE accounts SET phone=?,phone_verified_at=now() WHERE id=?", login, id);
            } else if (realm.equals("username")) {
                db.update("UPDATE accounts SET username=? WHERE id=?", login, id);
            } else if (realm.endsWith("_accounts")) {
                db.update("INSERT INTO " + realm + "(account_id,login_name,password_hash,credential_version) VALUES (?,?,?,7)", id, login, passwords.encode("existing-synthetic-password"));
            } else if (realm.equals("role")) {
                // A role without fourth-end credentials must still block creation.
                db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'AGENT_ADMIN')", id);
                login = "different-preview-agent";
            }
            var before = counts();
            var account = db.queryForMap("SELECT * FROM accounts WHERE id=?", id);
            var agentCredentials = db.queryForList("SELECT * FROM agent_platform_accounts");
            var platformCredentials = db.queryForList("SELECT * FROM platform_accounts");
            var result = cli("local", "true", login, passwordFile);
            assertNotEquals(0, result.exit(), realm);
            assertEquals(before, counts());
            assertEquals(account, db.queryForMap("SELECT * FROM accounts WHERE id=?", id));
            assertEquals(agentCredentials, db.queryForList("SELECT * FROM agent_platform_accounts"));
            assertEquals(platformCredentials, db.queryForList("SELECT * FROM platform_accounts"));
            var env = new MockEnvironment().withProperty("DREAMCORE_PREVIEW_AGENT_BOOTSTRAP", "true")
                    .withProperty("AGENT_BOOTSTRAP_LOGIN", login).withProperty("AGENT_BOOTSTRAP_PASSWORD_FILE", passwordFile.toString());
            env.setActiveProfiles("local");
            var bootstrap = new AgentAdminBootstrap(db, passwords, null, env);
            var failure = assertThrows(IdentityException.class, () -> new TransactionTemplate(transactions).execute(status -> bootstrap.run()));
            assertEquals(409, failure.status);
            assertEquals("AGENT_BOOTSTRAP_ALREADY_EXISTS", failure.code);
            assertFalse(failure.toString().contains(PASSWORD));
        }
    }

    @Test void auditFailureRollsBackAllThreeBusinessWrites() throws Exception {
        db.execute("CREATE FUNCTION reject_preview_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$");
        db.execute("CREATE TRIGGER reject_preview_audit BEFORE INSERT ON identity_audit FOR EACH ROW EXECUTE FUNCTION reject_preview_audit()");
        var before = counts();
        try {
            assertNotEquals(0, cli("local", "true", LOGIN, passwordFile).exit());
            assertEquals(before, counts(), "Audit failure must roll back account, credential and role together");
        } finally {
            db.execute("DROP TRIGGER reject_preview_audit ON identity_audit");
            db.execute("DROP FUNCTION reject_preview_audit()");
        }
    }
}
