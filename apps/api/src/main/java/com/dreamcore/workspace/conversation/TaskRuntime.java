package com.dreamcore.workspace.conversation;
import java.util.*;
/** Only platform-owned task and source identities cross the engine boundary. */
public interface TaskRuntime {
    record Result(String contractVersion,String engineVersion,UUID taskId,UUID attemptId,String mode,String summaryCode,List<UUID> sourceIds) {}
    Result execute(UUID task,UUID attempt,List<UUID> sources);
    default AgentResult executeAgent(UUID task,UUID attempt,String prompt,java.util.function.BooleanSupplier active){throw new com.dreamcore.workspace.identity.IdentityException(503,"MODEL_NOT_CONFIGURED");}
}
