package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.identity.IdentityException;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Internal attempt capability only. Staged files are never publicly downloadable. */
@Service
public class ArtifactTransferService {
    public static final int MAX_BYTES=20*1024*1024, CHUNK_BYTES=256*1024;
    public record Prepare(UUID clientKey,String filename,String mediaType,Integer bytes,String sha256) {}
    public record Chunk(Integer offset,String contentBase64) {}
    public record Receipt(String contractVersion,UUID uploadId,String state,int receivedBytes,int bytes,String sha256,int chunkBytes) {}
    public record File(UUID id,String filename,String sha256,byte[] bytes) {}
    private record Upload(UUID id,String filename,String mediaType,int expected,String sha256,int received,byte[] content,String state) {}
    private final JdbcTemplate db;
    private final ObjectProvider<AgentTaskService> agents;
    private final AgentSettings settings;
    private final boolean configured;
    @Value("${dreamcore.tasks.ppt-renderer-enabled:false}") private boolean pptEnabled;
    private static final Map<String,String> TYPES=Map.ofEntries(
        Map.entry("xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        Map.entry("pptx","application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        Map.entry("html","text/html"),Map.entry("json","application/json"),Map.entry("png","image/png"),
        Map.entry("jpg","image/jpeg"),Map.entry("md","text/markdown"),Map.entry("txt","text/plain"),
        Map.entry("csv","text/csv"),Map.entry("zip","application/zip"));
    public ArtifactTransferService(JdbcTemplate db,ObjectProvider<AgentTaskService> agents,AgentSettings settings,
        @Value("${dreamcore.tasks.artifact-transfer-enabled:false}") boolean configured) {
        this.db=db;this.agents=agents;this.settings=settings;this.configured=configured;
    }
    // Typed presentation rendering can run live; general live code remains forbidden.
    public boolean available(){return configured && (settings.mode().equals("verification") || presentationAvailable());}
    public boolean presentationAvailable(){return configured && pptEnabled && settings.enabled();}
    private IdentityException denied(){return new IdentityException(403,"TASK_ACCESS_DENIED");}
    private ConversationService.Job guard(UUID task,UUID attempt){
        if(!available() || task==null || attempt==null)throw denied();
        // Existing authorization locks the task and rechecks its lease and current source access.
        var job=agents.getObject().authorized(task,attempt);
        var rows=db.queryForList("SELECT stop_requested,allowed_tools::text,execution_policy FROM conversation_attempts WHERE task_id=? AND attempt_id=? FOR UPDATE",task,attempt);
        if(rows.isEmpty() || Boolean.TRUE.equals(rows.getFirst().get("stop_requested")) || rows.getFirst().get("execution_policy")==null)throw denied();
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT jsonb_exists_any(allowed_tools,ARRAY['run_javascript','process_original','candidate_tool','render_presentation']) FROM conversation_attempts WHERE task_id=? AND attempt_id=?",Boolean.class,task,attempt)))throw denied();
        return job;
    }
    private Upload upload(UUID task,UUID attempt,UUID id){
        var rows=db.query("SELECT * FROM conversation_artifact_transfers WHERE id=? AND task_id=? AND attempt_id=? AND expires_at>clock_timestamp() FOR UPDATE",
            (r,n)->new Upload(r.getObject("id",UUID.class),r.getString("filename"),r.getString("media_type"),r.getInt("expected_bytes"),r.getString("sha256"),r.getInt("received_bytes"),r.getBytes("content"),r.getString("state")),id,task,attempt);
        if(rows.isEmpty())throw new IdentityException(404,"ARTIFACT_TRANSFER_NOT_FOUND");return rows.getFirst();
    }
    private Receipt receipt(Upload row){return new Receipt("1.0",row.id(),row.state(),row.received(),row.expected(),row.sha256(),CHUNK_BYTES);}
    @Transactional public Receipt prepare(UUID task,UUID attempt,Prepare body){
        var job=guard(task,attempt);
        if(body!=null && Set.of("presentation.pptx","presentation-source.json").contains(body.filename()==null?"":body.filename()) && !Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM conversation_presentations WHERE task_id=? AND state='CONFIRMED')",Boolean.class,task)))throw denied();
        if(body==null || body.clientKey()==null || body.filename()==null || !body.filename().matches("[A-Za-z0-9][A-Za-z0-9._-]{0,79}") ||
           body.bytes()==null || body.bytes()<1 || body.bytes()>MAX_BYTES || body.sha256()==null || !body.sha256().matches("[a-f0-9]{64}"))throw IdentityException.invalid();
        int dot=body.filename().lastIndexOf('.');String ext=dot<0?"":body.filename().substring(dot+1).toLowerCase(Locale.ROOT);
        if(!TYPES.containsKey(ext) || !TYPES.get(ext).equals(body.mediaType()))throw IdentityException.invalid();
        var prior=db.queryForList("SELECT id FROM conversation_artifact_transfers WHERE task_id=? AND attempt_id=? AND client_key=?",UUID.class,task,attempt,body.clientKey());
        if(!prior.isEmpty()){
            var row=upload(task,attempt,prior.getFirst());
            if(!row.filename().equals(body.filename()) || !row.mediaType().equals(body.mediaType()) || row.expected()!=body.bytes() || !row.sha256().equals(body.sha256()))throw new IdentityException(409,"ARTIFACT_TRANSFER_CONFLICT");
            return receipt(row);
        }
        var budget=db.queryForMap("SELECT count(*) AS count,coalesce(sum(expected_bytes),0) AS bytes FROM conversation_artifact_transfers WHERE task_id=? AND attempt_id=?",task,attempt);
        var existing=db.queryForMap("SELECT count(*) AS count,coalesce(sum(octet_length(content)),0) AS bytes FROM conversation_artifacts WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?)",task,task);
        if(((Number)budget.get("count")).intValue()+((Number)existing.get("count")).intValue()>=8 || ((Number)budget.get("bytes")).longValue()+((Number)existing.get("bytes")).longValue()+body.bytes()>MAX_BYTES)throw new IdentityException(422,"ARTIFACT_TRANSFER_LIMIT");
        if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM conversation_artifact_transfers WHERE task_id=? AND attempt_id=? AND lower(filename)=lower(?))",Boolean.class,task,attempt,body.filename())))throw new IdentityException(409,"ARTIFACT_TRANSFER_CONFLICT");
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO conversation_artifact_transfers(id,tenant_id,workspace_id,task_id,attempt_id,attempt_number,client_key,filename,media_type,expected_bytes,sha256) VALUES(?,?,?,?,?,(SELECT attempt FROM conversation_tasks WHERE id=?),?,?,?,?,?)",
            id,job.tenant(),job.space(),task,attempt,task,body.clientKey(),body.filename(),body.mediaType(),body.bytes(),body.sha256());
        return receipt(upload(task,attempt,id));
    }
    @Transactional public Receipt chunk(UUID task,UUID attempt,UUID id,Chunk body){
        guard(task,attempt);var row=upload(task,attempt,id);
        if(body==null || body.offset()==null || body.offset()<0 || body.contentBase64()==null || body.contentBase64().length()>349528)throw IdentityException.invalid();
        byte[] bytes;
        try{bytes=Base64.getDecoder().decode(body.contentBase64());}catch(IllegalArgumentException error){throw IdentityException.invalid();}
        if(bytes.length<1 || bytes.length>CHUNK_BYTES || !Base64.getEncoder().encodeToString(bytes).equals(body.contentBase64()) || (long)body.offset()+bytes.length>row.expected())throw IdentityException.invalid();
        if(!row.state().equals("UPLOADING"))throw new IdentityException(409,"ARTIFACT_TRANSFER_STATE");
        if(body.offset()<row.received()){
            if((long)body.offset()+bytes.length>row.received() || !Arrays.equals(bytes,Arrays.copyOfRange(row.content(),body.offset(),body.offset()+bytes.length)))throw new IdentityException(409,"ARTIFACT_TRANSFER_CONFLICT");
            return receipt(row); // Exact retransmission is safe after a lost response.
        }
        if(body.offset()!=row.received())throw new IdentityException(409,"ARTIFACT_TRANSFER_OFFSET");
        db.update("UPDATE conversation_artifact_transfers SET content=content||?,received_bytes=received_bytes+? WHERE id=?",bytes,bytes.length,id);
        return receipt(upload(task,attempt,id));
    }
    private String digest(byte[] bytes){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}catch(Exception error){throw new IllegalStateException(error);}}
    @Transactional public Receipt complete(UUID task,UUID attempt,UUID id){
        guard(task,attempt);var row=upload(task,attempt,id);
        if(row.state().equals("PUBLISHED"))throw new IdentityException(409,"ARTIFACT_TRANSFER_STATE");
        if(row.received()!=row.expected())throw new IdentityException(409,"ARTIFACT_TRANSFER_INCOMPLETE");
        if(!digest(row.content()).equals(row.sha256()))throw new IdentityException(422,"ARTIFACT_TRANSFER_HASH_MISMATCH");
        db.update("UPDATE conversation_artifact_transfers SET state='READY' WHERE id=?",id);
        return receipt(upload(task,attempt,id));
    }
    /** Called inside the task's finish transaction; authorization is rechecked, not inferred from the receipt. */
    @Transactional public File resolve(UUID task,UUID attempt,UUID id,String name,String sha256){
        guard(task,attempt);var row=upload(task,attempt,id);
        if(!row.state().equals("READY") || !row.filename().equals(name) || !row.sha256().equals(sha256) || !digest(row.content()).equals(sha256))throw new IdentityException(409,"ARTIFACT_TRANSFER_STATE");
        return new File(id,name,sha256,row.content());
    }
    @Transactional public void published(UUID task,UUID attempt,UUID id){
        guard(task,attempt);
        if(db.update("UPDATE conversation_artifact_transfers SET state='PUBLISHED',content='' WHERE id=? AND task_id=? AND attempt_id=? AND state='READY'",id,task,attempt)!=1)throw new IdentityException(409,"ARTIFACT_TRANSFER_STATE");
    }
    @Scheduled(fixedDelayString="${dreamcore.tasks.artifact-cleanup-ms:60000}",initialDelayString="${dreamcore.tasks.initial-delay-ms:1000}")
    @Transactional public void cleanup(){
        // Cleanup only temporary bytes. Published artifacts follow the existing artifact lifecycle.
        db.update("DELETE FROM conversation_artifact_transfers u WHERE expires_at<clock_timestamp() OR NOT EXISTS(SELECT 1 FROM conversation_tasks t WHERE t.id=u.task_id AND t.lease_token=u.attempt_id AND t.status='RUNNING' AND t.lease_until>clock_timestamp())");
    }
}
