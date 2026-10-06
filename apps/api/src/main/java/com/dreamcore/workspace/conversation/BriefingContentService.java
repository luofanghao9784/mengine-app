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
    public record DatasetBasis(String groupColumn,String periodColumn,int matchedRows,int ignoredRows,String periodMode,String timeZone) {public DatasetBasis(String groupColumn,String periodColumn,int matchedRows,int ignoredRows){this(groupColumn,periodColumn,matchedRows,ignoredRows,null,null);}}
    public record Content(String schemaVersion,String businessType,String title,String summary,List<String> analysis,Chart chart,Source source,UUID calculationArtifactId,String calculationSha256,String generatedAt,DatasetCalculationService.Source datasetSource,DatasetBasis datasetBasis) {
        public Content(String schemaVersion,String businessType,String title,String summary,List<String> analysis,Chart chart,Source source,UUID calculationArtifactId,String calculationSha256,String generatedAt){this(schemaVersion,businessType,title,summary,analysis,chart,source,calculationArtifactId,calculationSha256,generatedAt,null,null);}
    }
    public record RuleVersion(String source,String target,int revision) {}
    public record RuleTrace(String status,List<RuleVersion> versions) {}
    public record Document(UUID artifactId,String sha256,Content content,RuleTrace ruleTrace,NewsImage.Cover cover) {public Document(UUID artifactId,String sha256,Content content,RuleTrace ruleTrace){this(artifactId,sha256,content,ruleTrace,null);}public Document(UUID artifactId,String sha256,Content content){this(artifactId,sha256,content,null);}}
    private final JdbcTemplate db;private final IdentityAudit audit;private final JsonMapper json=new JsonMapper();
    public BriefingContentService(JdbcTemplate db,IdentityAudit audit){this.db=db;this.audit=audit;}
    public boolean statusOnly(Request request){return request!=null&&request.title()!=null&&request.title().strip().matches("(?i)^(暂无|没有|无)(新的?|新增)?(内容|画报|卡片|结果)[。.!！]*$|^no new (content|briefing|cards?)[.!]*$");}
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
        if(statusOnly(request))throw new IdentityException(422,"BRIEFING_STATUS_ONLY");
        String type=request.businessType()==null?"DATA":request.businessType();
        if(!Set.of("INFO","DATA","INSIGHT","SUGGESTION","RESULT").contains(type))throw IdentityException.invalid();
        var desired=db.queryForList("SELECT business_type FROM briefing_generation_batches WHERE task_id=? AND business_type IS NOT NULL",String.class,job.id());
        if(!desired.isEmpty()&&!desired.getFirst().equals(type)||desired.isEmpty()&&type.equals("INFO")&&Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE task_id=?)",Boolean.class,job.id())))throw new IdentityException(422,"BRIEFING_TYPE_MISMATCH");
        text(request.title(),4,80,false);text(request.summary(),12,240,true);
        if(request.analysis()==null||request.analysis().size()<2||request.analysis().size()>4)throw new IdentityException(422,"BRIEFING_ANALYSIS_REQUIRED");
        request.analysis().forEach(s->text(s,12,500,true));
        boolean automatic=Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE task_id=?)",Boolean.class,job.id()));
        boolean datasetSample=Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM task_dataset_reads WHERE task_id=?)",Boolean.class,job.id()));
        BriefingEditorialQuality.validate(request,automatic,datasetSample,type.equals("DATA")&&request.calculationArtifactId()!=null);
        int attempt=db.queryForObject("SELECT attempt FROM conversation_tasks WHERE id=? AND lease_token=? FOR UPDATE",Integer.class,job.id(),job.token());
        if(!type.equals("DATA"))return createText(job,request,type,attempt);
        if(request.calculationArtifactId()==null)throw IdentityException.invalid();
        var input=db.queryForList("SELECT a.sha256,a.content FROM conversation_artifacts a WHERE a.id=? AND a.task_id=? AND a.attempt_number=? AND object_is_active('ARTIFACT',a.id) AND EXISTS(SELECT 1 FROM identity_audit p WHERE p.target_id=a.id AND p.action IN ('TASK_TABLE_COMPUTED','TASK_DATASET_COMPUTED') AND p.outcome='SUCCESS' AND p.tenant_id=a.tenant_id) AND EXISTS(SELECT 1 FROM conversation_tool_receipts r WHERE r.task_id=a.task_id AND r.attempt_number=a.attempt_number AND r.name IN ('compare_table','compare_dataset') AND r.status='succeeded')",request.calculationArtifactId(),job.id(),attempt);
        if(input.size()!=1)throw new IdentityException(403,"BRIEFING_CALCULATION_NOT_GRANTED");
        var item=input.getFirst();byte[] bytes=(byte[])item.get("content");if(!hash(bytes).equals(item.get("sha256")))throw new IdentityException(502,"BRIEFING_CALCULATION_INVALID");
        var receipt=json.readTree(bytes);if(receipt.has("datasetSource"))return createDataset(job,request,attempt,receipt,(String)item.get("sha256"));var calc=receipt.path("calculation");var params=calc.path("request");
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
        if(!reserve(job,content))return null;
        byte[] body=json.writeValueAsBytes(content);if(body.length>20000)throw new IdentityException(413,"BRIEFING_CONTENT_LIMIT");
        var total=db.queryForMap("SELECT count(*) n,coalesce(sum(octet_length(content)),0) bytes FROM conversation_artifacts WHERE task_id=? AND attempt_number=?",job.id(),attempt);
        if(((Number)total.get("n")).intValue()>=8||((Number)total.get("bytes")).longValue()+body.length>65536)throw new IdentityException(413,"BRIEFING_CONTENT_LIMIT");
        UUID id=UUID.randomUUID();String sha=hash(body);db.update("INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content,attempt_number) VALUES (?,?,?,?,?,?,?,?)",id,job.tenant(),job.space(),job.id(),"briefing-data-"+sha.substring(0,20)+".json",sha,body,attempt);
        audit.record(job.actor(),job.tenant(),"TASK_BRIEFING_CREATED",id,"SUCCESS");return new Document(id,sha,content);
    }
    private Document createDataset(ConversationService.Job job,Request request,int attempt,tools.jackson.databind.JsonNode receipt,String calculationHash){
        var source=json.treeToValue(receipt.path("datasetSource"),DatasetCalculationService.Source.class);
        var calc=json.treeToValue(receipt.path("calculation"),DatasetCalculationService.Calculation.class);
        if(!Set.of("dataset-compare-1","dataset-compare-month-1").contains(calc.recipeVersion()) || !"COMPUTED".equals(calc.status()) || !source.sha256().equals(calc.inputSha256()) || !source.datasetId().equals(calc.request().datasetId()) || !source.snapshotId().equals(calc.request().snapshotId()))throw new IdentityException(422,"BRIEFING_CALCULATION_INVALID");
        if(db.queryForObject("SELECT count(*) FROM task_dataset_reads WHERE task_id=? AND attempt_number=? AND dataset_id=? AND snapshot_id=?",Integer.class,job.id(),attempt,source.datasetId(),source.snapshotId())!=1 || db.queryForObject("SELECT count(*) FROM identity_audit WHERE target_id=? AND action='TASK_DATASET_COMPUTED' AND outcome='SUCCESS' AND tenant_id=?",Integer.class,request.calculationArtifactId(),job.tenant())!=1 || db.queryForObject("SELECT count(*) FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=? AND name='compare_dataset' AND status='succeeded'",Integer.class,job.id(),attempt)==0)throw new IdentityException(403,"BRIEFING_CALCULATION_NOT_GRANTED");
        if(calc.rows()==null || calc.rows().isEmpty() || calc.rows().size()>50 || calc.totals()==null || calc.matchedRows()+calc.ignoredRows()!=source.rowCount())throw new IdentityException(422,"BRIEFING_CHART_INVALID");
        boolean countRows="COUNT".equals(calc.request().aggregation());
        String metric=countRows?"记录数":calc.request().valueColumn(),unit=countRows?"条":"原数据数值单位";var match=java.util.regex.Pattern.compile("[（(]([^）)]{1,12})[）)]").matcher(metric);if(match.find())unit=match.group(1);
        var chart=new Chart("GROUPED_BAR",metric,unit,calc.request().baseline(),calc.request().current(),calc.request().dateColumn()==null?"全部快照 · "+source.rowCount()+" 行":"日期筛选 · "+calc.matchedRows()+" 行 · 缺日 "+calc.missingDateRows()+" 行",calc.rows(),calc.totals());
        var prior=db.queryForList("SELECT a.id,a.sha256,a.content FROM conversation_artifacts a WHERE task_id=? AND attempt_number=? AND EXISTS(SELECT 1 FROM identity_audit p WHERE p.target_id=a.id AND p.action='TASK_BRIEFING_CREATED' AND p.tenant_id=a.tenant_id)",job.id(),attempt);
        if(!prior.isEmpty()){var doc=read(prior.getFirst());var old=doc.content();if(!Objects.equals(old.calculationArtifactId(),request.calculationArtifactId()) || !old.title().equals(request.title().strip()) || !old.summary().equals(request.summary().strip()) || !old.analysis().equals(request.analysis()))throw new IdentityException(409,"BRIEFING_ALREADY_CREATED");return doc;}
        var content=new Content("briefing-dataset-v1","DATA",request.title().strip(),request.summary().strip(),List.copyOf(request.analysis()),chart,null,request.calculationArtifactId(),calculationHash,Instant.now().toString(),source,new DatasetBasis(calc.request().groupColumn(),calc.request().periodColumn(),calc.matchedRows(),calc.ignoredRows(),calc.request().periodMode()==null?"EXACT":calc.request().periodMode(),calc.request().timeZone()==null?"Asia/Shanghai":calc.request().timeZone()));
        if(!reserve(job,content))return null;
        byte[] body=json.writeValueAsBytes(content);var size=db.queryForMap("SELECT count(*) n,coalesce(sum(octet_length(content)),0) bytes FROM conversation_artifacts WHERE task_id=? AND attempt_number=?",job.id(),attempt);
        if(body.length>20000 || ((Number)size.get("n")).intValue()>=8 || ((Number)size.get("bytes")).longValue()+body.length>65536)throw new IdentityException(413,"BRIEFING_CONTENT_LIMIT");
        UUID id=UUID.randomUUID();String sha=hash(body);db.update("INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content,attempt_number) VALUES (?,?,?,?,?,?,?,?)",id,job.tenant(),job.space(),job.id(),"briefing-dataset-"+sha.substring(0,20)+".json",sha,body,attempt);audit.record(job.actor(),job.tenant(),"TASK_BRIEFING_CREATED",id,"SUCCESS");return new Document(id,sha,content);
    }
    private Document createText(ConversationService.Job job,Request request,String type,int attempt){
        if(request.calculationArtifactId()!=null)throw IdentityException.invalid();
        var sources=db.queryForList("SELECT c.id,c.material_id,c.version_id,v.number,v.filename,v.sha256,c.content FROM conversation_agent_grants g JOIN knowledge_chunks c ON c.id=g.chunk_id JOIN material_versions v ON v.id=c.version_id WHERE g.task_id=? AND g.attempt_id=? ORDER BY c.id",job.id(),job.token());
        var datasets=db.queryForList("SELECT d.name,d.column_names,s.* FROM task_dataset_reads pin JOIN dataset_snapshots s ON s.id=pin.snapshot_id JOIN business_datasets d ON d.id=s.dataset_id WHERE pin.task_id=? AND pin.attempt_number=? AND d.status='ACTIVE' AND NOT d.scrubbed AND NOT s.scrubbed ORDER BY d.id LIMIT 1",job.id(),attempt);
        DatasetCalculationService.Source datasetSource=null;
        if(!datasets.isEmpty()){var r=datasets.getFirst();datasetSource=new DatasetCalculationService.Source((UUID)r.get("dataset_id"),(UUID)r.get("id"),((Number)r.get("version")).intValue(),(String)r.get("name"),IdentityService.hash(r.get("column_names").toString()+"\n"+r.get("data_rows").toString()),((Number)r.get("row_count")).intValue(),((java.sql.Timestamp)r.get("collected_at")).toInstant().toString(),r.get("coverage_through")==null?null:((java.sql.Timestamp)r.get("coverage_through")).toInstant().toString());}
        if(sources.isEmpty()&&datasets.isEmpty()&&db.queryForObject("SELECT count(*) FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=? AND name IN ('public_search','read_public_page') AND status='succeeded'",Integer.class,job.id(),attempt)==0)throw new IdentityException(422,"BRIEFING_SOURCES_REQUIRED");
        if(type.equals("INFO")&&db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE task_id=? AND business_type='INFO')",Boolean.class,job.id())&&
            (db.queryForObject("SELECT count(*) FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=? AND name='read_public_page' AND status='succeeded'",Integer.class,job.id(),attempt)==0))throw new IdentityException(422,"BRIEFING_NEWS_EVIDENCE_REQUIRED");
        Source source=null;if(!sources.isEmpty()){var r=sources.getFirst();source=new Source((UUID)r.get("id"),(UUID)r.get("material_id"),(UUID)r.get("version_id"),(Integer)r.get("number"),(String)r.get("filename"),(String)r.get("sha256"),(String)r.get("content"));}
        var prior=db.queryForList("SELECT a.id,a.sha256,a.content FROM conversation_artifacts a WHERE task_id=? AND attempt_number=? AND EXISTS(SELECT 1 FROM identity_audit p WHERE p.target_id=a.id AND p.action='TASK_BRIEFING_CREATED' AND p.tenant_id=a.tenant_id)",job.id(),attempt);
        if(!prior.isEmpty()){var doc=read(prior.getFirst());if(!doc.content().businessType().equals(type)||!doc.content().title().equals(request.title().strip())||!doc.content().summary().equals(request.summary().strip())||!doc.content().analysis().equals(request.analysis()))throw new IdentityException(409,"BRIEFING_ALREADY_CREATED");return doc;}
        var content=new Content("briefing-text-v1",type,request.title().strip(),request.summary().strip(),List.copyOf(request.analysis()),null,source,null,null,Instant.now().toString(),datasetSource,null);
        if(!reserve(job,content))return null;
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
    private boolean reserve(ConversationService.Job job,Content content){
        String key=contentKey(content);
        db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","briefing-content:"+job.tenant()+":"+job.actor());
        for(var legacy:db.queryForList("SELECT t.id,b.* FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id JOIN LATERAL ("+ELIGIBLE+") b ON true WHERE c.tenant_id=? AND c.owner_id=? AND t.status='SUCCEEDED' AND EXISTS(SELECT 1 FROM readable_source_tasks r WHERE r.id=t.id) AND NOT EXISTS(SELECT 1 FROM briefing_content_keys k WHERE k.task_id=t.id) ORDER BY t.finished_at DESC LIMIT 1000",job.tenant(),job.actor())){
            var old=read(legacy);if(contentKey(old.content()).equals(key))return false;
        }
        // An unsuccessful prepared artifact cannot monopolize its key forever.
        db.update("DELETE FROM briefing_content_keys k USING conversation_tasks t WHERE k.task_id=t.id AND k.tenant_id=? AND k.owner_id=? AND k.fingerprint=? AND t.status NOT IN ('SUCCEEDED','RUNNING','QUEUED')",job.tenant(),job.actor(),key);
        db.update("INSERT INTO briefing_content_keys VALUES(?,?,?,?) ON CONFLICT DO NOTHING",job.tenant(),job.actor(),key,job.id());
        UUID owner=db.queryForObject("SELECT task_id FROM briefing_content_keys WHERE tenant_id=? AND owner_id=? AND fingerprint=?",UUID.class,job.tenant(),job.actor(),key);
        if(!owner.equals(job.id())&&!"SUCCEEDED".equals(db.queryForObject("SELECT status FROM conversation_tasks WHERE id=?",String.class,owner)))throw new IdentityException(409,"BRIEFING_CONTENT_IN_PROGRESS");
        return owner.equals(job.id());
    }
    private String contentKey(Content c){return IdentityService.hash(json.writeValueAsString(List.of(c.businessType(),c.datasetSource()!=null?c.datasetSource().sha256():c.source()==null?"PUBLIC":c.source().sha256(),c.chart()!=null?json.writeValueAsString(c.chart()):c.summary().replaceAll("[\\p{P}\\s]", "").toLowerCase(Locale.ROOT))));}
    private RuleTrace ruleTrace(UUID artifact){
        var rows=db.queryForList("SELECT s.rules::text AS rules,EXISTS(SELECT 1 FROM briefing_generation_batches b WHERE b.task_id=a.task_id) AS automatic FROM expression_rule_task_snapshots s JOIN conversation_artifacts a ON a.task_id=s.task_id WHERE a.id=?",artifact);
        if(rows.isEmpty())return new RuleTrace("NOT_RECORDED",List.of());
        var versions=new ArrayList<RuleVersion>();for(var r:json.readTree((String)rows.getFirst().get("rules")))if(r.path("target").asString().equals("ALL")||Boolean.TRUE.equals(rows.getFirst().get("automatic")))versions.add(new RuleVersion(r.path("source").asString(),r.path("target").asString(),r.path("revision").asInt()));
        return new RuleTrace("RECORDED",versions);
    }
    private Document read(Map<String,Object> row){
        byte[] bytes=(byte[])row.get("content");String sha=(String)row.get("sha256");if(!hash(bytes).equals(sha))throw new IdentityException(502,"BRIEFING_CONTENT_INVALID");
        Content content=json.readValue(bytes,Content.class);if(!Set.of("briefing-data-v1","briefing-text-v1","briefing-dataset-v1").contains(content.schemaVersion()))throw new IdentityException(502,"BRIEFING_CONTENT_INVALID");
        return new Document((UUID)row.get("id"),sha,content,ruleTrace((UUID)row.get("id")),content.businessType().equals("INFO")?cover((UUID)row.get("id")):null);
    }
    private NewsImage.Cover cover(UUID artifact){
        var rows=db.queryForList("SELECT t.web_sources FROM conversation_tasks t JOIN conversation_artifacts a ON a.task_id=t.id WHERE a.id=?",artifact);
        if(rows.isEmpty()||rows.getFirst().get("web_sources")==null)return null;
        try{for(var source:json.readTree(rows.getFirst().get("web_sources").toString()))if(source.path("kind").asString().equals("PAGE")&&source.hasNonNull("image")){var image=json.treeToValue(source.get("image"),NewsImage.Image.class);if(NewsImage.valid(image))return new NewsImage.Cover("data:"+image.contentType()+";base64,"+image.base64(),source.path("url").asString(),source.path("title").asString());}}catch(Exception ignored){}
        return null;
    }
    private String hash(byte[] body){try{return HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(body));}catch(Exception e){throw new IllegalStateException(e);}}
}
