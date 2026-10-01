package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.identity.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/** A model-authored, immutable private publication. Chart values come only from a verified calculation. */
@Service
public class BriefingContentService {
    public record Request(UUID calculationArtifactId,String title,String summary,List<String> analysis,String businessType) {
        public Request(UUID calculationArtifactId,String title,String summary,List<String> analysis){this(calculationArtifactId,title,summary,analysis,"DATA");}
    }
    public record Row(String group,String baseline,String current,String difference,String changePercent,Integer baselineRank,Integer currentRank,String issue) {}
    public record Chart(String type,String metric,String unit,String baseline,String current,String range,List<Row> rows,Row totals) {}
    public record Source(UUID id,UUID materialId,UUID versionId,int version,String filename,String sha256,String scopeExcerpt) {}
    public record Content(String schemaVersion,String businessType,String title,String summary,List<String> analysis,Chart chart,Source source,UUID calculationArtifactId,String calculationSha256,String generatedAt) {}
    public record Document(UUID artifactId,String sha256,Content content) {}
    private final JdbcTemplate db;private final IdentityAudit audit;private final JsonMapper json=new JsonMapper();
    public BriefingContentService(JdbcTemplate db,IdentityAudit audit){this.db=db;this.audit=audit;}
    // Audit provenance, not a user-supplied filename, determines whether an artifact is a generated briefing.
    public static final String ELIGIBLE="""
       SELECT a.id,a.sha256,a.content FROM conversation_artifacts a
       WHERE a.task_id=t.id AND a.attempt_number=t.attempt AND object_is_active('ARTIFACT',a.id)
       AND EXISTS(SELECT 1 FROM identity_audit proof WHERE proof.target_id=a.id AND proof.tenant_id=a.tenant_id AND proof.action='TASK_BRIEFING_CREATED' AND proof.outcome='SUCCESS')
       AND EXISTS(SELECT 1 FROM conversation_tool_receipts tool WHERE tool.task_id=a.task_id AND tool.attempt_number=a.attempt_number AND tool.name='deliver_briefing' AND tool.status='succeeded')
       ORDER BY a.id LIMIT 1
       """;
    private void text(String value,int min,int max,boolean sentence){
        if(value==null||value.strip().length()<min||value.length()>max||value.codePoints().anyMatch(c->Character.isISOControl(c)&&c!=10)||sentence&&!value.strip().matches("(?s).*[。！？.!?]$"))throw new IdentityException(422,"BRIEFING_TEXT_INCOMPLETE");
    }
    public Document create(ConversationService.Job job,Request request){
        if(request==null)throw IdentityException.invalid();
        String type=request.businessType()==null?"DATA":request.businessType();
        if(!Set.of("INFO","DATA","INSIGHT","SUGGESTION","RESULT").contains(type))throw IdentityException.invalid();
        text(request.title(),4,80,false);text(request.summary(),12,240,true);
        if(request.analysis()==null||request.analysis().size()<2||request.analysis().size()>4)throw new IdentityException(422,"BRIEFING_ANALYSIS_REQUIRED");
        request.analysis().forEach(s->text(s,12,500,true));
        int attempt=db.queryForObject("SELECT attempt FROM conversation_tasks WHERE id=? AND lease_token=? FOR UPDATE",Integer.class,job.id(),job.token());
        if(!type.equals("DATA"))return createText(job,request,type,attempt);
        if(request.calculationArtifactId()==null)throw IdentityException.invalid();
        var input=db.queryForList("SELECT a.sha256,a.content FROM conversation_artifacts a WHERE a.id=? AND a.task_id=? AND a.attempt_number=? AND object_is_active('ARTIFACT',a.id) AND EXISTS(SELECT 1 FROM identity_audit p WHERE p.target_id=a.id AND p.action='TASK_TABLE_COMPUTED' AND p.outcome='SUCCESS' AND p.tenant_id=a.tenant_id) AND EXISTS(SELECT 1 FROM conversation_tool_receipts r WHERE r.task_id=a.task_id AND r.attempt_number=a.attempt_number AND r.name='compare_table' AND r.status='succeeded')",request.calculationArtifactId(),job.id(),attempt);
        if(input.size()!=1)throw new IdentityException(403,"BRIEFING_CALCULATION_NOT_GRANTED");
        var item=input.getFirst();byte[] bytes=(byte[])item.get("content");if(!hash(bytes).equals(item.get("sha256")))throw new IdentityException(502,"BRIEFING_CALCULATION_INVALID");
        var receipt=json.readTree(bytes);var calc=receipt.path("calculation");var params=calc.path("request");
        if(!calc.path("recipeVersion").asText().equals("table-compare-1")||!calc.path("status").asText().equals("COMPUTED")||!calc.path("inputSha256").equals(receipt.path("source").path("sha256")))throw new IdentityException(422,"BRIEFING_CALCULATION_INVALID");
        var source=json.treeToValue(receipt.path("source"),Source.class);
        if(db.queryForObject("SELECT count(*) FROM conversation_agent_grants WHERE task_id=? AND attempt_id=? AND chunk_id=?",Integer.class,job.id(),job.token(),source.id())!=1)throw new IdentityException(403,"BRIEFING_CALCULATION_NOT_GRANTED");
        List<Row> rows=new ArrayList<>();for(var row:calc.path("rows"))rows.add(json.treeToValue(row,Row.class));
        if(rows.isEmpty()||rows.size()>50)throw new IdentityException(422,"BRIEFING_CHART_INVALID");
        String header=calc.path("headers").path(params.path("valueColumn").asText()).asText().split("\\n")[0];
        String unit="原表数值单位";var match=java.util.regex.Pattern.compile("[（(]([^）)]{1,12})[）)]").matcher(header);if(match.find())unit=match.group(1);
        var chart=new Chart("GROUPED_BAR",header,unit,params.path("baseline").asText(),params.path("current").asText(),params.path("range").asText(),List.copyOf(rows),json.treeToValue(calc.path("totals"),Row.class));
        var prior=db.queryForList("SELECT a.id,a.sha256,a.content FROM conversation_artifacts a WHERE task_id=? AND attempt_number=? AND EXISTS(SELECT 1 FROM identity_audit p WHERE p.target_id=a.id AND p.action='TASK_BRIEFING_CREATED' AND p.tenant_id=a.tenant_id)",job.id(),attempt);
        if(!prior.isEmpty()){
            var doc=read(prior.getFirst());var old=doc.content();
            if(!old.calculationArtifactId().equals(request.calculationArtifactId())||!old.title().equals(request.title().strip())||!old.summary().equals(request.summary().strip())||!old.analysis().equals(request.analysis()))throw new IdentityException(409,"BRIEFING_ALREADY_CREATED");
            return doc;
        }
        var content=new Content("briefing-data-v1","DATA",request.title().strip(),request.summary().strip(),List.copyOf(request.analysis()),chart,source,request.calculationArtifactId(),(String)item.get("sha256"),Instant.now().toString());
        byte[] body=json.writeValueAsBytes(content);if(body.length>20000)throw new IdentityException(413,"BRIEFING_CONTENT_LIMIT");
        var total=db.queryForMap("SELECT count(*) n,coalesce(sum(octet_length(content)),0) bytes FROM conversation_artifacts WHERE task_id=? AND attempt_number=?",job.id(),attempt);
        if(((Number)total.get("n")).intValue()>=8||((Number)total.get("bytes")).longValue()+body.length>65536)throw new IdentityException(413,"BRIEFING_CONTENT_LIMIT");
        UUID id=UUID.randomUUID();String sha=hash(body);db.update("INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content,attempt_number) VALUES (?,?,?,?,?,?,?,?)",id,job.tenant(),job.space(),job.id(),"briefing-data-"+sha.substring(0,20)+".json",sha,body,attempt);
        audit.record(job.actor(),job.tenant(),"TASK_BRIEFING_CREATED",id,"SUCCESS");return new Document(id,sha,content);
    }
    private Document createText(ConversationService.Job job,Request request,String type,int attempt){
        if(request.calculationArtifactId()!=null)throw IdentityException.invalid();
        var sources=db.queryForList("SELECT c.id,c.material_id,c.version_id,v.number,v.filename,v.sha256,c.content FROM conversation_agent_grants g JOIN knowledge_chunks c ON c.id=g.chunk_id JOIN material_versions v ON v.id=c.version_id WHERE g.task_id=? AND g.attempt_id=? ORDER BY c.id",job.id(),job.token());
        if(sources.isEmpty()&&!type.equals("RESULT")&&db.queryForObject("SELECT count(*) FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=? AND name IN ('public_search','read_public_page') AND status='succeeded'",Integer.class,job.id(),attempt)==0)throw new IdentityException(422,"BRIEFING_SOURCES_REQUIRED");
        Source source=null;if(!sources.isEmpty()){var r=sources.getFirst();source=new Source((UUID)r.get("id"),(UUID)r.get("material_id"),(UUID)r.get("version_id"),(Integer)r.get("number"),(String)r.get("filename"),(String)r.get("sha256"),(String)r.get("content"));}
        var prior=db.queryForList("SELECT a.id,a.sha256,a.content FROM conversation_artifacts a WHERE task_id=? AND attempt_number=? AND EXISTS(SELECT 1 FROM identity_audit p WHERE p.target_id=a.id AND p.action='TASK_BRIEFING_CREATED' AND p.tenant_id=a.tenant_id)",job.id(),attempt);
        if(!prior.isEmpty()){var doc=read(prior.getFirst());if(!doc.content().businessType().equals(type)||!doc.content().title().equals(request.title().strip())||!doc.content().summary().equals(request.summary().strip())||!doc.content().analysis().equals(request.analysis()))throw new IdentityException(409,"BRIEFING_ALREADY_CREATED");return doc;}
        var content=new Content("briefing-text-v1",type,request.title().strip(),request.summary().strip(),List.copyOf(request.analysis()),null,source,null,null,Instant.now().toString());
        byte[] body=json.writeValueAsBytes(content);var total=db.queryForMap("SELECT count(*) n,coalesce(sum(octet_length(content)),0) bytes FROM conversation_artifacts WHERE task_id=? AND attempt_number=?",job.id(),attempt);
        if(((Number)total.get("n")).intValue()>=8||((Number)total.get("bytes")).longValue()+body.length>65536)throw new IdentityException(413,"BRIEFING_CONTENT_LIMIT");
        UUID id=UUID.randomUUID();String sha=hash(body);db.update("INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content,attempt_number) VALUES (?,?,?,?,?,?,?,?)",id,job.tenant(),job.space(),job.id(),"briefing-text-"+sha.substring(0,20)+".json",sha,body,attempt);
        audit.record(job.actor(),job.tenant(),"TASK_BRIEFING_CREATED",id,"SUCCESS");return new Document(id,sha,content);
    }
    /** Called only after the caller has enforced task/source authorization; never a standalone authorization check. */
    public Document find(UUID task,int attempt){
        var rows=db.queryForList("SELECT b.* FROM conversation_tasks t JOIN LATERAL ("+ELIGIBLE+") b ON true WHERE t.id=? AND t.attempt=?",task,attempt);
        return rows.isEmpty()?null:read(rows.getFirst());
    }
    private Document read(Map<String,Object> row){
        byte[] bytes=(byte[])row.get("content");String sha=(String)row.get("sha256");if(!hash(bytes).equals(sha))throw new IdentityException(502,"BRIEFING_CONTENT_INVALID");
        Content content=json.readValue(bytes,Content.class);if(!Set.of("briefing-data-v1","briefing-text-v1").contains(content.schemaVersion()))throw new IdentityException(502,"BRIEFING_CONTENT_INVALID");
        return new Document((UUID)row.get("id"),sha,content);
    }
    private String hash(byte[] body){try{return HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(body));}catch(Exception e){throw new IllegalStateException(e);}}
}
