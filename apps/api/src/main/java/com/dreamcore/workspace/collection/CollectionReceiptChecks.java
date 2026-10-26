package com.dreamcore.workspace.collection;

import com.dreamcore.workspace.identity.IdentityService;
import java.time.Instant;
import java.util.*;
import tools.jackson.databind.json.JsonMapper;

/** Validate receipts at the trusted adapter boundary, before changing the current snapshot. */
public final class CollectionReceiptChecks {
    private static final JsonMapper JSON=new JsonMapper();
    private CollectionReceiptChecks() {}
    public static boolean valid(CollectionAdapter.Snapshot s,List<String> columns,Instant received) {
        var r=s.exportReceipt();if(r==null)return true; // Legacy adapters have no export proof.
        if(!"1.0".equals(r.contractVersion())||r.sourceSnapshotId()==null||!r.completeSnapshot()
            ||r.sourceCollectedAt()==null||r.sourceVerifiedAt()==null||r.sourceCollectedAt().isAfter(r.sourceVerifiedAt())
            ||r.sourceVerifiedAt().isAfter(received.plusSeconds(60))||r.scopeHash()==null||!r.scopeHash().matches("[0-9a-f]{64}")
            ||r.rowCount()!=s.rows().size()||!columns.equals(r.columns())||r.candidateKeyColumns()==null
            ||r.candidateKeyColumns().isEmpty()||new HashSet<>(r.candidateKeyColumns()).size()!=r.candidateKeyColumns().size()
            ||!columns.containsAll(r.candidateKeyColumns())||!IdentityService.hash(JSON.writeValueAsString(s.rows())).equals(r.rowsSha256()))return false;
        var seen=new HashSet<List<String>>();
        for(var row:s.rows()){
            var key=new ArrayList<String>();
            for(String column:r.candidateKeyColumns()){String v=row.get(columns.indexOf(column));if(v==null||v.isBlank())return false;key.add(v);}
            if(!seen.add(key))return false;
        }
        return true;
    }
    public static String stored(CollectionAdapter.ExportReceipt receipt,UUID snapshot) {
        var result=JSON.valueToTree(receipt);
        var object=(tools.jackson.databind.node.ObjectNode)result;
        object.put("kind","export-validation");object.put("snapshotId",snapshot.toString());
        return object.toString();
    }
}
