package com.dreamcore.workspace.collection;

import com.dreamcore.workspace.identity.IdentityService;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

class CollectionReceiptChecksTest {
    final UUID source=UUID.randomUUID(),dataset=UUID.randomUUID();
    final Instant now=Instant.parse("2026-10-26T05:00:00Z");
    final List<String> columns=List.of("编号","金额");
    final List<List<String>> rows=List.of(Arrays.asList("0001",null),List.of("0002","-123456789012345.12"));
    CollectionAdapter.ExportReceipt receipt(List<List<String>> values,Instant verified){return new CollectionAdapter.ExportReceipt("1.0",source,now.minusSeconds(600),verified,"a".repeat(64),true,values.size(),columns,List.of("编号"),IdentityService.hash(new JsonMapper().writeValueAsString(values)));}
    @Test void bindsExactStringsNullsColumnsAndOriginalSourceTime(){
        var r=receipt(rows,now.minusSeconds(60));var s=new CollectionAdapter.Snapshot(dataset,null,rows,r);
        assertTrue(CollectionReceiptChecks.valid(s,columns,now));
        assertFalse(CollectionReceiptChecks.valid(new CollectionAdapter.Snapshot(dataset,null,List.of(List.of("0001","0"),rows.getLast()),r),columns,now));
        assertFalse(CollectionReceiptChecks.valid(s,List.of("金额","编号"),now));
        var stored=new JsonMapper().readTree(CollectionReceiptChecks.stored(r,dataset));
        assertEquals("export-validation",stored.path("kind").asText());assertEquals(now.minusSeconds(600).toString(),stored.path("sourceCollectedAt").asText());
        assertEquals(dataset.toString(),stored.path("snapshotId").asText());
    }
    @Test void rejectsDuplicateMissingKeysAndImpossibleTimes(){
        for(var invalid:List.of(List.of(rows.getFirst(),rows.getFirst()),List.of(Arrays.asList((String)null,"2"))))
            assertFalse(CollectionReceiptChecks.valid(new CollectionAdapter.Snapshot(dataset,null,invalid,receipt(invalid,now)),columns,now));
        assertFalse(CollectionReceiptChecks.valid(new CollectionAdapter.Snapshot(dataset,null,rows,receipt(rows,now.plusSeconds(61))),columns,now));
        assertFalse(CollectionReceiptChecks.valid(new CollectionAdapter.Snapshot(dataset,null,rows,receipt(rows,now.minusSeconds(601))),columns,now));
    }
    @Test void legacyAdapterHasNoFabricatedReceipt(){assertTrue(CollectionReceiptChecks.valid(new CollectionAdapter.Snapshot(dataset,null,rows),columns,now));}
}
