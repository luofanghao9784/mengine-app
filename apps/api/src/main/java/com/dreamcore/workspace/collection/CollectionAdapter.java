package com.dreamcore.workspace.collection;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
/** Installed adapter is read-only and receives approved dataset identities; no executable/config comes from UI. */
public interface CollectionAdapter {
    record Dataset(UUID id,String key,List<String> columns) {}
    record Request(String contractVersion,UUID tenantId,UUID connectionId,UUID runId,List<Dataset> datasets) {}
    record ExportReceipt(String contractVersion,UUID sourceSnapshotId,Instant sourceCollectedAt,Instant sourceVerifiedAt,
        String scopeHash,boolean completeSnapshot,long rowCount,List<String> columns,List<String> candidateKeyColumns,String rowsSha256) {}
    record Snapshot(UUID datasetId,Instant coverageThrough,List<List<String>> rows,ExportReceipt exportReceipt) {
        public Snapshot(UUID datasetId,Instant coverageThrough,List<List<String>> rows){this(datasetId,coverageThrough,rows,null);}
    }
    record Result(String contractVersion,List<Snapshot> snapshots) {}
    boolean available();
    Result collect(Request request) throws Exception;
    default Result collect(Request request,java.util.function.BooleanSupplier active) throws Exception {
        if(!active.getAsBoolean())throw new IllegalStateException("COLLECTION_INTERRUPTED");
        return collect(request);
    }
}
