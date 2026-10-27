package com.dreamcore.workspace.conversation;
import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Component;
import org.springframework.boot.autoconfigure.condition.*;
/** Fail clearly before enabled schedule polling; legacy/unconfigured applications are unchanged. */
@Component
@ConditionalOnExpression("'${dreamcore.native.web-url:}' != ''")
@ConditionalOnProperty(name="dreamcore.native.schedules-enabled",havingValue="true",matchIfMissing=true)
public class NativeSchedulePreflight {
 private final NativeScheduleRules rules;
 public NativeSchedulePreflight(NativeScheduleRules rules){this.rules=rules;}
 @PostConstruct public void verify(){rules.verifyDependencies();}
}
