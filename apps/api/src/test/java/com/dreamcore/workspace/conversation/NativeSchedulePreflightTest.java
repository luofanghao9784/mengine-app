package com.dreamcore.workspace.conversation;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.*;
class NativeSchedulePreflightTest {
 @TempDir Path temp;
 private ApplicationContextRunner context(String path){return new ApplicationContextRunner().withUserConfiguration(NativeScheduleRules.class,NativeSchedulePreflight.class).withPropertyValues("dreamcore.native.schedule-rules="+path);}
 @Test void missingScriptFailsEnabledStartupClearly(){context(temp.resolve("missing.mjs").toString()).withPropertyValues("dreamcore.native.web-url=http://synthetic").run(c->{assertNotNull(c.getStartupFailure());assertTrue(c.getStartupFailure().getCause().getMessage().contains("NATIVE_SCHEDULE_RULES_UNAVAILABLE"));});}
 @Test void unconfiguredOrDisabledDoesNotNeedNode(){context("/missing.mjs").run(c->assertNull(c.getStartupFailure()));context("/missing.mjs").withPropertyValues("dreamcore.native.web-url=http://synthetic","dreamcore.native.schedules-enabled=false").run(c->assertNull(c.getStartupFailure()));}
 @Test void missingPackageIsUnavailableNotInvalidRule()throws Exception{Path script=temp.resolve("missing-package.mjs");Files.writeString(script,"import 'nonexistent-synthetic-package';");var rules=new NativeScheduleRules(script.toString());var e=assertThrows(com.dreamcore.workspace.identity.IdentityException.class,()->rules.evaluate(java.util.Map.of()));assertEquals(503,e.status);assertEquals("NATIVE_SCHEDULE_RULES_UNAVAILABLE",e.code);}
 @Test void installedOfficialRulesPass(){new NativeScheduleRules("").verifyDependencies();}
}
