package com.dreamcore.workspace.conversation;
import java.util.*;
public record AgentResult(String contractVersion,String engineVersion,UUID taskId,UUID attemptId,String mode,String executionClass,
                          String modelName,String text,List<UUID> sourceIds,List<Tool> tools,List<Artifact> artifacts,int modelCalls,Usage usage,List<WebSource> webSources,List<Skill> skills,List<UUID> originalIds,String outcome,String requiredInput) {
    public AgentResult(String contractVersion,String engineVersion,UUID taskId,UUID attemptId,String mode,String executionClass,String modelName,String text,List<UUID> sourceIds,List<Tool> tools,List<Artifact> artifacts,int modelCalls,Usage usage,List<WebSource> webSources,List<Skill> skills,List<UUID> originalIds){this(contractVersion,engineVersion,taskId,attemptId,mode,executionClass,modelName,text,sourceIds,tools,artifacts,modelCalls,usage,webSources,skills,originalIds,null,null);}
    public record WebSource(UUID id,String url,String title,String excerpt,String sha256,java.time.Instant retrievedAt,String kind,boolean truncated) {}
    public record Skill(String id,String version,String sha256) {}
    public record Tool(String callId,String name,String status) {}
    public record Artifact(String name,String sha256,String contentBase64) {}
    public record Usage(long inputTokens,long outputTokens) {}
}
