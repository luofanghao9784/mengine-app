package com.dreamcore.workspace.identity;

import java.nio.file.*;
import java.time.Instant;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PlatformStorageService {
 public record Capacity(String state,Long totalBytes,Long usableBytes) {}
 public record Cleanup(long queued,long running,long failed,long completed,Instant lastCompletedAt) {}
 public record Storage(long databaseBytes,long knowledgeBytes,long registeredOriginalBytes,Capacity originalVolume) {}
 public record Status(Instant checkedAt,Storage storage,Cleanup cleanup,BackupObservationReader.Observation backup) {}
 private final JdbcTemplate db;private final IdentityService identities;private final BackupObservationReader observations;private final String materialRoot;
 public PlatformStorageService(JdbcTemplate db,IdentityService identities,BackupObservationReader observations,@Value("${dreamcore.material.storage-root:}") String materialRoot){this.db=db;this.identities=identities;this.observations=observations;this.materialRoot=materialRoot;}
 @Transactional public Status status(UUID actor){
  identities.platform(actor);db.execute("SET LOCAL statement_timeout='3s'");
  var fact=db.queryForObject("""
   SELECT statement_timestamp() checked_at,pg_database_size(current_database()) database_bytes,pg_total_relation_size('knowledge_chunks') knowledge_bytes,
    (SELECT coalesce(sum(v.size_bytes),0) FROM material_versions v WHERE NOT EXISTS(SELECT 1 FROM content_cleanup_blobs b WHERE b.object_id=v.object_id AND b.deleted_at IS NOT NULL)) original_bytes,
    count(*) FILTER(WHERE state='QUEUED') queued,count(*) FILTER(WHERE state='CLEANING') running,
    count(*) FILTER(WHERE state='FAILED') failed,count(*) FILTER(WHERE state='COMPLETE') completed,
    max(completed_at) FILTER(WHERE state='COMPLETE' AND completed_at<=statement_timestamp()) last_completed_at FROM content_cleanup_jobs
   """,(r,n)->new Status(r.getTimestamp("checked_at").toInstant(),new Storage(r.getLong("database_bytes"),r.getLong("knowledge_bytes"),r.getLong("original_bytes"),null),new Cleanup(r.getLong("queued"),r.getLong("running"),r.getLong("failed"),r.getLong("completed"),r.getTimestamp("last_completed_at")==null?null:r.getTimestamp("last_completed_at").toInstant()),null));
  var capacity=capacity();var report=observations.read(Instant.now());identities.platform(actor);
  return new Status(fact.checkedAt(),new Storage(fact.storage().databaseBytes(),fact.storage().knowledgeBytes(),fact.storage().registeredOriginalBytes(),capacity),fact.cleanup(),report);
 }
 private Capacity capacity(){
  if(materialRoot.isBlank())return new Capacity("NOT_CONFIGURED",null,null);
  try{Path path=Path.of(materialRoot);if(!Files.isDirectory(path,LinkOption.NOFOLLOW_LINKS))return new Capacity("UNAVAILABLE",null,null);var store=Files.getFileStore(path);return new Capacity("OBSERVED",store.getTotalSpace(),store.getUsableSpace());}
  catch(Exception ignored){return new Capacity("UNAVAILABLE",null,null);}
 }
}
