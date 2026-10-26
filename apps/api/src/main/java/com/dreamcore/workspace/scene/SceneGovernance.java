package com.dreamcore.workspace.scene;

import com.dreamcore.workspace.collection.DatasetField;
import java.util.Set;
import tools.jackson.databind.JsonNode;

/** Preserve source evidence without promoting a model interpretation to verified fact. */
public final class SceneGovernance {
 private SceneGovernance(){}
 private static String text(String v,int n){v=v.replaceAll("[\\p{Cntrl}]"," ").trim();return v.length()>n?v.substring(0,n):v;}
 public static DatasetField field(JsonNode asset,JsonNode field){
  String name=field.path("name").asText();JsonNode meaning=field;
  for(var candidate:asset.path("dictionary").path("fields"))if(candidate.path("name").asText().equals(name))meaning=candidate;
  String description=meaning.path("meaning").asText(field.path("label").asText(name));
  String evidence=meaning.path("evidence").asText("");
  String status=meaning.path("status").asText("");
  for(var source:asset.path("fieldEvidence"))if(source.path("column").asText().equals(name)){
   status=source.path("status").asText("UNKNOWN");evidence=source.path("reference").asText(evidence);
  }
  if(!Set.of("SOURCE_DOCUMENTED","DEPLOYMENT_INFERRED","MODEL_DETERMINED","UNKNOWN").contains(status))status="generated".equals(asset.path("dictionaryStatus").asText())?"DEPLOYMENT_INFERRED":"UNKNOWN";
  // An explicit UNKNOWN/INFERRED marker always defeats an optimistic status.
  if(evidence.contains("DEPLOYMENT_INFERRED"))status="DEPLOYMENT_INFERRED";
  else if(evidence.equals("UNKNOWN")||evidence.isBlank())status="UNKNOWN";
  return new DatasetField(name,text(field.path("type").asText("text"),40),text(description.isBlank()?name:description,300),text(meaning.path("unit").asText(""),40),text(evidence.isBlank()?"来源尚未提供字段依据":evidence,300),status);
 }
}
