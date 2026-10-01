package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.knowledge.*;
import com.dreamcore.workspace.material.ObjectStore;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/** The attempt grant chooses a fixed original version. Model parameters never supply a path or bytes. */
@Service
public class TableCalculationService {
    public record Request(UUID sourceId,String sheet,String range,String groupColumn,String periodColumn,String valueColumn,String baseline,String current) {
        public Map<String,Object> parameters(){
            if(sourceId==null||sheet==null||sheet.isBlank()||sheet.length()>31||range==null||!range.matches("[A-Z]{1,2}[1-9][0-9]{0,4}:[A-Z]{1,2}[1-9][0-9]{0,4}")||baseline==null||baseline.isEmpty()||baseline.length()>100||current==null||current.isEmpty()||current.length()>100||baseline.equals(current))throw IdentityException.invalid();
            for(String c:new String[]{groupColumn,periodColumn,valueColumn})if(c==null||!c.matches("[A-Z]{1,2}"))throw IdentityException.invalid();
            return Map.of("sheet",sheet,"range",range,"groupColumn",groupColumn,"periodColumn",periodColumn,"valueColumn",valueColumn,"baseline",baseline,"current",current);
        }
    }
    public record Input(Map<String,Object> source,byte[] bytes,Map<String,Object> parameters) {}
    private final JdbcTemplate db;private final KnowledgeService knowledge;private final ObjectStore store;private final LocalTableCalculator calculator;private final IdentityAudit audit;
    private final JsonMapper json=new JsonMapper();
    public TableCalculationService(JdbcTemplate db,KnowledgeService knowledge,ObjectStore store,LocalTableCalculator calculator,IdentityAudit audit){this.db=db;this.knowledge=knowledge;this.store=store;this.calculator=calculator;this.audit=audit;}
    public boolean available(){return calculator.available();}
    public Input input(ConversationService.Job job,Request request){
        if(request==null)throw IdentityException.invalid();var parameters=request.parameters();
        if(db.queryForObject("SELECT count(*) FROM conversation_agent_grants WHERE task_id=? AND attempt_id=? AND chunk_id=?",Integer.class,job.id(),job.token(),request.sourceId())!=1)throw new IdentityException(403,"TABLE_SOURCE_NOT_GRANTED");
        var chunk=knowledge.citation(job.actor(),job.tenant(),request.sourceId());
        if(!chunk.filename().toLowerCase(Locale.ROOT).endsWith(".xlsx"))throw new IdentityException(422,"TABLE_XLSX_REQUIRED");
        // Join the attempt's pin, not the material's current_version. New uploads cannot replace this calculation input.
        var rows=db.queryForList("SELECT v.object_id,v.size_bytes,v.sha256 FROM material_versions v JOIN conversation_task_material_versions p ON p.version_id=v.id AND p.material_id=v.material_id AND p.tenant_id=v.tenant_id AND p.workspace_id=v.workspace_id WHERE p.task_id=? AND p.attempt_id=? AND p.version_id=? AND p.run_id=?",job.id(),job.token(),chunk.versionId(),chunk.runId());
        if(rows.size()!=1)throw new IdentityException(403,"TABLE_SOURCE_NOT_GRANTED");
        var row=rows.getFirst();long size=((Number)row.get("size_bytes")).longValue();if(size>2097152)throw new IdentityException(413,"TABLE_FILE_LIMIT");
        byte[] bytes=store.read((UUID)row.get("object_id"),size,(String)row.get("sha256"));
        var source=Map.<String,Object>of("id",chunk.id(),"materialId",chunk.materialId(),"versionId",chunk.versionId(),"version",chunk.version(),"filename",chunk.filename(),"sha256",row.get("sha256"),"scopeExcerpt",chunk.content());
        return new Input(source,bytes,parameters);
    }
    public Map<String,Object> compute(Input input){return calculator.calculate(input.bytes(),input.parameters());}
    public Map<String,Object> save(ConversationService.Job job,Input input,Map<String,Object> result){
        if(!"COMPUTED".equals(result.get("status")))return Map.of("contractVersion","1.0","status","FAILED","code",String.valueOf(result.getOrDefault("code","TABLE_CALCULATOR_FAILED")));
        if(!"table-compare-1".equals(result.get("recipeVersion"))||!input.source().get("sha256").equals(result.get("inputSha256"))||!input.parameters().equals(result.get("request")))throw new IdentityException(502,"TABLE_RESULT_INVALID");
        byte[] body=json.writeValueAsBytes(Map.of("source",input.source(),"calculation",result));String hash=HexFormat.of().formatHex(sha(body));
        String filename="table-comparison-"+hash.substring(0,20)+".json";
        int attempt=db.queryForObject("SELECT attempt FROM conversation_tasks WHERE id=? AND lease_token=? FOR UPDATE",Integer.class,job.id(),job.token());
        var existing=db.queryForList("SELECT id FROM conversation_artifacts WHERE task_id=? AND attempt_number=? AND filename=? AND sha256=?",UUID.class,job.id(),attempt,filename,hash);
        UUID id;
        if(!existing.isEmpty())id=existing.getFirst();
        else{
            var size=db.queryForMap("SELECT count(*) n,coalesce(sum(octet_length(content)),0) bytes FROM conversation_artifacts WHERE task_id=? AND attempt_number=?",job.id(),attempt);
            if(((Number)size.get("n")).intValue()>=8||((Number)size.get("bytes")).longValue()+body.length>65536)throw new IdentityException(413,"TABLE_RESULT_LIMIT");
            id=UUID.randomUUID();db.update("INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content,attempt_number) VALUES (?,?,?,?,?,?,?,?)",id,job.tenant(),job.space(),job.id(),filename,hash,body,attempt);
            audit.record(job.actor(),job.tenant(),"TASK_TABLE_COMPUTED",id,"SUCCESS");
        }
        // Full exact inputs remain in the private calculation receipt, not repeated in model context.
        var projection=new LinkedHashMap<>(result);projection.remove("inputs");
        return Map.of("contractVersion","1.0","status","COMPUTED","source",input.source(),"calculation",projection,"artifact",Map.of("id",id,"filename",filename,"sha256",hash,"bytes",body.length));
    }
    private byte[] sha(byte[] bytes){try{return java.security.MessageDigest.getInstance("SHA-256").digest(bytes);}catch(Exception e){throw new IllegalStateException(e);}}
}
