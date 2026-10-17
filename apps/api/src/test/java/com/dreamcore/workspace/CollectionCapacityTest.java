package com.dreamcore.workspace;
import com.dreamcore.workspace.collection.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class CollectionCapacityTest {
 @Test void boundedCompleteSnapshotAcceptsCurrentFullScopeAndRejectsOverflow() throws Exception {
  var service=new CollectionService(null,null,null,null,null,null,null);
  var id=UUID.randomUUID();var cols=new ArrayList<String>();for(int i=0;i<20;i++)cols.add("field"+i);
  var request=new CollectionAdapter.Request("1.0",id,id,id,List.of(new CollectionAdapter.Dataset(id,"full",cols)));
  var claim=new CollectionService.Claim(id,id,id,id,1,request);
  var method=CollectionService.class.getDeclaredMethod("valid",CollectionService.Claim.class,CollectionAdapter.Result.class,Instant.class);method.setAccessible(true);
  var row=Collections.nCopies(20,"0");var rows=Collections.nCopies(80000,row);
  assertEquals(true,method.invoke(service,claim,new CollectionAdapter.Result("1.0",List.of(new CollectionAdapter.Snapshot(id,null,rows))),Instant.now()));
  var extra=UUID.randomUUID();var request2=new CollectionAdapter.Request("1.0",id,id,id,List.of(new CollectionAdapter.Dataset(id,"full",cols),new CollectionAdapter.Dataset(extra,"extra",cols)));
  var claim2=new CollectionService.Claim(id,id,id,id,1,request2);
  assertEquals(false,method.invoke(service,claim2,new CollectionAdapter.Result("1.0",List.of(new CollectionAdapter.Snapshot(id,null,rows),new CollectionAdapter.Snapshot(extra,null,Collections.nCopies(30000,row)))),Instant.now()));
 }
}
