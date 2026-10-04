package com.dreamcore.workspace.export;

import com.dreamcore.workspace.identity.IdentityException;
import java.io.*;
import java.security.*;
import java.util.*;
import java.util.zip.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

@Component @EnableScheduling
public class ExportBatchWorker {
 private final com.dreamcore.workspace.support.SupportAccess support;private final ExportBatchService service;private final ExportSources sources;private final boolean enabled;private final JsonMapper json=new JsonMapper();
 public ExportBatchWorker(ExportBatchService service,ExportSources sources,@Value("${dreamcore.exports.worker-enabled:true}")boolean enabled,com.dreamcore.workspace.support.SupportAccess support){this.support=support;this.service=service;this.sources=sources;this.enabled=enabled;}
 @Scheduled(fixedDelayString="${dreamcore.exports.poll-ms:3000}",initialDelayString="${dreamcore.exports.initial-delay-ms:30000}") public void tick(){if(enabled)runOnce();}
 public boolean runOnce(){service.expireDue();for(UUID id:service.cleanupPending())try{service.cleanup(id);}catch(RuntimeException e){service.cleanupFailed(id);}var job=service.claim();if(job==null)return false;build(job);return true;}
 public void build(ExportBatchService.Job job){
  var previous=com.dreamcore.workspace.support.SupportContext.current();
  try{
   com.dreamcore.workspace.support.SupportContext.set(support.forObject(job.actor(),job.tenant(),"export_batches",job.id()));
   var output=new ChunkOutput(job);long uncompressed=0;int included=0,index=0;
   try(var zip=new ZipOutputStream(output)){
    for(var selection:job.selections()){
     int ordinal=++index;ExportSources.File file;
     try{file=sources.export(job.actor(),job.tenant(),job.workspace(),job.scope(),selection);}catch(IdentityException e){service.itemResult(job,ordinal,e.status>=500?"EXPORT_ITEM_GENERATION_FAILED":e.code.equals("EXPORT_ITEM_TOO_LARGE")?e.code:"EXPORT_ITEM_UNAVAILABLE");continue;}catch(RuntimeException e){service.itemResult(job,ordinal,"EXPORT_ITEM_GENERATION_FAILED");continue;}
     if(uncompressed+file.bytes().length>ExportBatchService.MAX_CONTENT){service.itemResult(job,ordinal,"EXPORT_BATCH_LIMIT");continue;}
     String path=String.format(Locale.ROOT,"%03d-%s-v%d.%s",ordinal,selection.objectId(),selection.version(),selection.format());service.reserve(job,ordinal,file,path);var entry=new ZipEntry(path);entry.setTime(0);zip.putNextEntry(entry);zip.write(file.bytes());zip.closeEntry();service.itemResult(job,ordinal,null);uncompressed+=file.bytes().length;included++;
    }
    if(included==0)throw new IdentityException(409,"EXPORT_NO_CONTENT");
    var stamp=service.stamp(job);var items=service.manifestItems(job);Map<String,Object> manifest=new LinkedHashMap<>();manifest.put("schemaVersion",1);manifest.put("batchId",job.id());manifest.put("tenantId",job.tenant());manifest.put("workspaceId",job.workspace());manifest.put("scope",job.scope());manifest.put("generatedAt",stamp.generatedAt());manifest.put("expiresAt",stamp.expiresAt());manifest.put("requestedCount",job.selections().size());manifest.put("includedCount",included);manifest.put("complete",included==job.selections().size());manifest.put("notice","Explicitly selected versions only. This archive is not a full migration or system backup. Downloaded copies are outside server cleanup.");manifest.put("items",items);
    var entry=new ZipEntry("_export-manifest.json");entry.setTime(0);zip.putNextEntry(entry);zip.write(json.writeValueAsBytes(manifest));zip.closeEntry();zip.finish();output.flush();service.finish(job,stamp,output.size,output.hash());
   }
  }catch(Exception e){service.fail(job,e instanceof IdentityException ie?ie.code:"EXPORT_GENERATION_FAILED");}finally{com.dreamcore.workspace.support.SupportContext.set(previous);}
 }
 private final class ChunkOutput extends OutputStream {
  private final ExportBatchService.Job job;private final byte[] pending=new byte[65536];private int used,ordinal;private long size;private final MessageDigest digest;
  ChunkOutput(ExportBatchService.Job job){this.job=job;try{digest=MessageDigest.getInstance("SHA-256");}catch(NoSuchAlgorithmException e){throw new IllegalStateException(e);}}
  @Override public void write(int value){write(new byte[]{(byte)value},0,1);}
  @Override public void write(byte[] bytes,int offset,int length){Objects.checkFromIndexSize(offset,length,bytes.length);if(size+length>ExportBatchService.MAX_ARCHIVE)throw new IdentityException(413,"EXPORT_ARCHIVE_LIMIT");digest.update(bytes,offset,length);size+=length;while(length>0){int n=Math.min(length,pending.length-used);System.arraycopy(bytes,offset,pending,used,n);used+=n;offset+=n;length-=n;if(used==pending.length)flush();}}
  @Override public void flush(){if(used>0){service.chunk(job,ordinal++,Arrays.copyOf(pending,used));used=0;}}
  @Override public void close(){flush();}
  String hash(){return HexFormat.of().formatHex(digest.digest());}
 }
}
