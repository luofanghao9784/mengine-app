package com.dreamcore.workspace;

import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CompanyContextBudgetTest extends CompanyAnalysisFixture {
 @Test void largePriorTagContextCannotStarveNewSourcesOrLoseItsAuthority(){
  var first=claim();queue.dispatched(first,descriptor());queue.complete(result(first,"COMPLETE"));
  // Simulate an existing label whose full authority spans 251 source fragments.
  var extras=db.queryForList("""
   INSERT INTO knowledge_chunks(id,tenant_id,workspace_id,material_id,version_id,run_id,ordinal,locator,method,content)
   SELECT gen_random_uuid(),c.tenant_id,c.workspace_id,c.material_id,c.version_id,c.run_id,n,'合成段','TEXT','合成企业资料'
   FROM knowledge_chunks c CROSS JOIN generate_series(1,250) n WHERE c.id=? RETURNING id
   """,UUID.class,chunk);
  for(UUID id:extras)db.update("INSERT INTO company_inference_inputs(run_id,chunk_id,model_visible) VALUES (?,?,false)",first.id(),id);
  var incoming=new ArrayList<UUID>();for(int i=0;i<10;i++)incoming.add(source(space));
  var next=inference.begin(admin,tenant,incoming);
  assertEquals(10,next.inputs().size());
  assertTrue(next.groups().stream().allMatch(g->g.tags().isEmpty()));
  assertEquals(10,db.queryForObject("SELECT count(*) FROM company_inference_inputs WHERE run_id=?",Integer.class,next.id()));
  assertEquals(251,db.queryForObject("SELECT count(*) FROM company_inference_inputs WHERE run_id=?",Integer.class,first.id()));
  assertTrue(inference.active(next.id(),next.lease()));
  // Omission from a later call must not weaken the original label's source guard.
  db.update("UPDATE materials SET in_library=false WHERE id=(SELECT material_id FROM knowledge_chunks WHERE id=?)",chunk);
  assertFalse(db.queryForObject("SELECT company_inference_readable(?)",Boolean.class,first.id()));
  assertTrue(inference.active(next.id(),next.lease()));
 }
}
