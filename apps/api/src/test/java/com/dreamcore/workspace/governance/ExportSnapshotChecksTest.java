package com.dreamcore.workspace.governance;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import com.dreamcore.workspace.identity.IdentityService;
import java.util.*;
import tools.jackson.databind.json.JsonMapper;

class ExportSnapshotChecksTest {
    UUID snapshot = UUID.randomUUID();
    List<String> columns = List.of("编号", "金额");
    List<List<String>> rows = List.of(List.of("001", "1.00001"), List.of("002", "-2.30"));
    Map<String,Object> receipt(List<?> data) {
        return Map.of("kind", "export-validation", "snapshotId", snapshot.toString(), "columns", columns,
            "rowsSha256", IdentityService.hash(new JsonMapper().writeValueAsString(data)),
            "rowCount", data.size(), "candidateKeyColumns", List.of("编号"));
    }
    @Test void verifiesExactSnapshotWithoutPromotingCollectorKeysToSourceConstraints() {
        var result=ExportSnapshotChecks.check(snapshot, columns, rows, List.of(receipt(rows)));
        assertEquals("CHECKED",result.get("state")); assertEquals(0L,result.get("duplicateKeys"));
        assertFalse(result.containsKey("primaryKeyColumns"));
        assertEquals("NOT_PROVIDED",ExportSnapshotChecks.check(snapshot,columns,rows,List.of()).get("state"));
    }
    @Test void staleSnapshotChangedValuesColumnsAndCountCannotReuseAReceipt() {
        var proof=receipt(rows);
        assertEquals("STALE",ExportSnapshotChecks.check(UUID.randomUUID(),columns,rows,List.of(proof)).get("state"));
        assertEquals("MISMATCH",ExportSnapshotChecks.check(snapshot,columns,List.of(List.of("001","1.0")),List.of(proof)).get("state"));
        assertEquals("MISMATCH",ExportSnapshotChecks.check(snapshot,List.of("金额","编号"),rows,List.of(proof)).get("state"));
    }
    @Test void duplicateAndMissingCollectorKeysAreCountedFromActualRows() {
        var bad=List.of(List.of("001","1"),List.of("001","2"),List.of("","3"));
        var result=ExportSnapshotChecks.check(snapshot,columns,bad,List.of(receipt(bad)));
        assertEquals("VIOLATIONS",result.get("state"));assertEquals(1L,result.get("duplicateKeys"));assertEquals(1L,result.get("missingKeys"));
    }
}
