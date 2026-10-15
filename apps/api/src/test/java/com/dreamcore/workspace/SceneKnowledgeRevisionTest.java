package com.dreamcore.workspace;

import com.dreamcore.workspace.scene.SceneService;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

class SceneKnowledgeRevisionTest {
 private final JsonMapper json=new JsonMapper();
 @Test void unrelatedLibraryGrowthDoesNotReviseExistingKnowledgeButItsOwnSourceVersionDoes(){
  var before=json.readTree("""
   {"scopeRevision":"library-1","items":[{"id":"article-a","name":"寄养交接要求","kv":[["来源","寄养制度","v1","plain"],["模型","configured-model","知识 v1","plain"]]}]}
   """);
  var after=json.readTree("""
   {"scopeRevision":"library-2","items":[{"id":"article-a","name":"寄养交接要求","kv":[["来源","寄养制度","v1","plain"],["模型","configured-model","知识 v1","plain"]]},{"id":"article-b","name":"新文章"}]}
   """);
  var stable=SceneService.knowledgeMetadata(before.path("items").get(0),1);
  assertEquals(stable,SceneService.knowledgeMetadata(after.path("items").get(0),1));
  var changed=json.readTree("""
   {"id":"article-a","name":"寄养交接要求","kv":[["来源","寄养制度","v2","plain"],["模型","configured-model","知识 v2","plain"]]}
   """);
  assertNotEquals(stable,SceneService.knowledgeMetadata(changed,1));
 }
}
