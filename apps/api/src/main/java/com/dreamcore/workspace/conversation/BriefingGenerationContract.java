package com.dreamcore.workspace.conversation;

/** Same release asset imported by runtime prompts; no deployment-only writing policy. */
public final class BriefingGenerationContract {
 private static final tools.jackson.databind.JsonNode CONTRACT=load();
 private static tools.jackson.databind.JsonNode load(){
  try(var stream=BriefingGenerationContract.class.getResourceAsStream("/briefing-contract.json")){
   if(stream==null)throw new IllegalStateException("briefing contract missing");
   return new tools.jackson.databind.json.JsonMapper().readTree(stream);
  }catch(java.io.IOException e){throw new IllegalStateException(e);}
 }
 public static tools.jackson.databind.JsonNode value(){return CONTRACT.deepCopy();}
 private BriefingGenerationContract(){}
}
