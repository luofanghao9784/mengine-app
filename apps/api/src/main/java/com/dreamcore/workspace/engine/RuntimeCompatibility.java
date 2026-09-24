package com.dreamcore.workspace.engine;

import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;

/** Task-specific compatibility, separate from release version and the public status projection. */
public final class RuntimeCompatibility {
    public record Descriptor(String contractVersion, String engineVersion, String runtimeMode, Map<String,String> protocols) {}
    private static final Set<String> MODES = Set.of("contract-only", "local-retrieval", "agent-verification", "agent-live");
    private RuntimeCompatibility() {}
    public static String require(Descriptor value, boolean agent, String executionClass) {
        if(value == null || !"1.0".equals(value.contractVersion()) || value.engineVersion() == null
                || !value.engineVersion().matches("[A-Za-z0-9.\\-]{1,64}") || value.runtimeMode() == null || !MODES.contains(value.runtimeMode())
                || value.protocols() == null || !value.protocols().keySet().equals(Set.of("sourceLookup", "agentTask", "platformCallbacks"))
                || value.protocols().values().stream().anyMatch(v -> v == null || !v.matches("[0-9]{1,7}\\.[0-9]{1,7}")))
            throw incompatible();
        if(agent) {
            if(!"1.4".equals(value.protocols().get("agentTask")) || !Set.of("1.3","1.4").contains(value.protocols().get("platformCallbacks"))
                    || executionClass == null || !Set.of("live", "verification").contains(executionClass)
                    || !("agent-" + executionClass).equals(value.runtimeMode())) throw incompatible();
        } else if(!"1.0".equals(value.protocols().get("sourceLookup"))) throw incompatible();
        if("contract-only".equals(value.runtimeMode())) throw new IdentityException(503, "TASK_RUNTIME_UNAVAILABLE");
        return value.engineVersion();
    }
    public static Descriptor legacy090(EngineGateway.Capabilities value) {
        // Explicit transitional opt-in is checked by the caller. No broad fallback or version guessing.
        if(value == null || !"1.0".equals(value.contractVersion()) || !"0.9.0".equals(value.engineVersion())
                || value.runtimeMode() == null || !MODES.contains(value.runtimeMode()) || value.capabilities() == null) throw incompatible();
        var expected = value.runtimeMode().equals("contract-only") ? List.of() :
                value.runtimeMode().equals("local-retrieval") ? List.of("source-lookup") : List.of("source-lookup", "agent-task");
        if(!expected.equals(value.capabilities())) throw incompatible();
        return new Descriptor("1.0", "0.9.0", value.runtimeMode(), Map.of("sourceLookup", "1.0", "agentTask", "1.4", "platformCallbacks", "1.3"));
    }
    public static IdentityException incompatible() { return new IdentityException(502, "TASK_RUNTIME_INCOMPATIBLE"); }
}
