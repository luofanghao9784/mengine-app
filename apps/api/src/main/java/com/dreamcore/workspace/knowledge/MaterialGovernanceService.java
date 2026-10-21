package com.dreamcore.workspace.knowledge;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.*;
import java.util.*;
import java.time.*;
import java.nio.*;
import java.nio.charset.*;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class MaterialGovernanceService {
 public record Change(UUID requestId,int expectedVersion,int expectedRevision,List<String> tags,LocalDate reviewAt) {}
 public record Item(UUID id,UUID workspaceId,String workspaceName,String name,int version,int revision,boolean canEdit,
  boolean canRedact,String source,Integer quality,List<String> issues,List<String> tags,LocalDate reviewAt,Instant checkedAt,UUID uploadedBy,String uploadedByName) {}
 public record Summary(long total,long checked,long attention,long sensitive,Double average) {}
 public record Page(UUID tenantId,Summary summary,long filteredTotal,List<Item> items,boolean hasMore) {}
 public record Result(UUID reportId,int version,int revision,String source,List<String> issues,List<String> tags,LocalDate reviewAt,boolean redacted) {}
 private record Input(UUID space,UUID version,int number,String filename,UUID object,long bytes,String hash,UUID run,String parseStatus,int revision) {}
 private record Text(String content,String source,UUID run) {}
 private static final Pattern PHONE=Pattern.compile("(?<![0-9])1[3-9][0-9]{9}(?![0-9])");
 private static final Pattern IDENTITY=Pattern.compile("(?<![0-9])[0-9]{17}[0-9Xx](?![0-9])");
 private static final Pattern EMAIL=Pattern.compile("[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}",Pattern.CASE_INSENSITIVE);
 private final JdbcTemplate db;private final IdentityService identities;private final MaterialAccess access;private final MaterialService materials;private final ObjectStore store;private final IdentityAudit audit;private final ObjectMapper json;
 public MaterialGovernanceService(JdbcTemplate db,IdentityService identities,MaterialAccess access,MaterialService materials,ObjectStore store,IdentityAudit audit,ObjectMapper json){this.db=db;this.identities=identities;this.access=access;this.materials=materials;this.store=store;this.audit=audit;this.json=json;}
 public static List<String> findings(String text,List<String> tags,LocalDate review,LocalDate today){
  List<String> issues=new ArrayList<>();if(PHONE.matcher(text).find())issues.add("phone");if(IDENTITY.matcher(text).find())issues.add("identity");if(EMAIL.matcher(text).find())issues.add("email");
  if(tags.isEmpty())issues.add("tags");if(review==null||review.isBefore(today))issues.add("review");if(text.codePointCount(0,text.length())<80)issues.add("content");return issues;
 }
 public static String redact(String text){return EMAIL.matcher(IDENTITY.matcher(PHONE.matcher(text).replaceAll("[手机号已脱敏]")).replaceAll("[身份证号已脱敏]")).replaceAll("[邮箱已脱敏]");}
 private static final String SOURCE="""
 WITH base AS MATERIALIZED (
 SELECT m.id,m.workspace_id "workspaceId",m.name,m.current_version version,m.created_by "uploadedBy",u.display_name "uploadedByName",
  CASE WHEN (library_mask(?,m.tenant_id,'WORKSPACE',w.id)&1)=1 THEN w.name ELSE '共享资料' END "workspaceName",
  (library_mask(?,m.tenant_id,'MATERIAL',m.id)&2)=2 "canEdit",
  coalesce((SELECT max(revision) FROM material_governance_reports allg WHERE allg.tenant_id=m.tenant_id AND allg.material_id=m.id),0) revision,
  g.source,g.tags,g.review_at "reviewAt",g.checked_at "checkedAt",
  CASE WHEN g.id IS NULL THEN ARRAY[]::text[] ELSE array_remove(g.issues,'review') || CASE WHEN g.review_at IS NULL OR g.review_at<(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date THEN ARRAY['review'] ELSE ARRAY[]::text[] END END issues,
  lower(v.filename) ~ '[.](txt|md|markdown)$' AS text_file
 FROM active_materials m JOIN workspaces w ON w.tenant_id=m.tenant_id AND w.id=m.workspace_id
 LEFT JOIN accounts u ON u.id=m.created_by
 JOIN material_versions v ON v.tenant_id=m.tenant_id AND v.material_id=m.id AND v.number=m.current_version
 LEFT JOIN LATERAL(SELECT * FROM knowledge_runs r WHERE r.version_id=v.id ORDER BY generation DESC LIMIT 1) r ON true
 LEFT JOIN LATERAL(SELECT * FROM material_governance_reports g WHERE g.tenant_id=m.tenant_id AND g.material_id=m.id ORDER BY revision DESC LIMIT 1) g
   ON g.version_id=v.id AND (g.source='ORIGINAL_TEXT' OR (g.run_id IS NOT DISTINCT FROM r.id AND g.parse_status IS NOT DISTINCT FROM r.status))
 WHERE m.tenant_id=? AND m.in_library AND w.kind='SHARED' AND NOT w.archived AND (library_mask(?,m.tenant_id,'MATERIAL',m.id)&1)=1
 ), visible AS (
 SELECT id,"workspaceId","workspaceName",name,version,revision,"canEdit","uploadedBy","uploadedByName",
  ("canEdit" AND text_file AND source='ORIGINAL_TEXT' AND issues && ARRAY['phone','identity','email']) "canRedact",
  coalesce(source,'NOT_CHECKED') source,
  CASE WHEN source IN('ORIGINAL_TEXT','PARSED_TEXT') THEN greatest(20,100-16*cardinality(issues)) ELSE NULL END quality,
  issues,coalesce(tags,ARRAY[]::text[]) tags,"reviewAt","checkedAt" FROM base
 )
 """;
 @Transactional public Page list(UUID actor,UUID tenant,String query,String queue,String rule,String sort,int offset){
  if(query==null||query.length()>180||!Set.of("all","attention","sensitive","unchecked","healthy").contains(queue)||!Set.of("all","phone","identity","email","tags","review","content").contains(rule)||!Set.of("priority","quality","updated").contains(sort)||offset<0||offset>100000)throw IdentityException.invalid();
  identities.member(actor,tenant,false);
  String filter=switch(queue){case "attention"->"cardinality(issues)>0";case "sensitive"->"issues && ARRAY['phone','identity','email']";case "unchecked"->"quality IS NULL";case "healthy"->"quality=100";default->"true";};
  String order=switch(sort){case "quality"->"quality ASC NULLS LAST,id";case "updated"->"\"checkedAt\" DESC NULLS LAST,id";default->"(issues && ARRAY['phone','identity','email']) DESC,cardinality(issues) DESC,id";};
  String sql=SOURCE+", filtered AS (SELECT * FROM visible WHERE "+filter+" AND strpos(lower(name),lower(?))>0 AND (?='all' OR ?=ANY(issues)))"+"""
  SELECT json_build_object('summary',(SELECT json_build_object('total',count(*),'checked',count(quality),'attention',count(*) FILTER(WHERE cardinality(issues)>0),
   'sensitive',count(*) FILTER(WHERE issues && ARRAY['phone','identity','email']),'average',round(avg(quality)::numeric,1)) FROM visible),
   'filteredTotal',(SELECT count(*) FROM filtered),'items',coalesce((SELECT json_agg(x) FROM (SELECT * FROM filtered ORDER BY
  """+order+" LIMIT 21 OFFSET ?) x),'[]'::json))::text";
  var node=json.readTree(db.queryForObject(sql,String.class,actor,actor,tenant,actor,query.strip(),rule,rule,offset));
  var items=Arrays.asList(json.treeToValue(node.get("items"),Item[].class));return new Page(tenant,json.treeToValue(node.get("summary"),Summary.class),node.get("filteredTotal").asLong(),items.stream().limit(20).toList(),items.size()>20);
 }
 @Transactional public Item detail(UUID actor,UUID tenant,UUID material){
  identities.member(actor,tenant,false);
  var rows=db.queryForList(SOURCE+"SELECT row_to_json(v)::text FROM visible v WHERE id=?",String.class,actor,actor,tenant,actor,material);
  if(rows.isEmpty())throw new IdentityException(404,"MATERIAL_NOT_FOUND");return json.readValue(rows.getFirst(),Item.class);
 }
 private Input input(UUID actor,UUID tenant,UUID material){
  var rows=db.query("""
   SELECT m.workspace_id,v.*,r.id run_id,r.status parse_status,coalesce((SELECT max(revision) FROM material_governance_reports g WHERE g.tenant_id=m.tenant_id AND g.material_id=m.id),0) revision
   FROM active_materials m JOIN workspaces w ON w.tenant_id=m.tenant_id AND w.id=m.workspace_id
   JOIN material_versions v ON v.tenant_id=m.tenant_id AND v.material_id=m.id AND v.number=m.current_version
   LEFT JOIN LATERAL(SELECT id,status FROM knowledge_runs r WHERE r.version_id=v.id ORDER BY generation DESC LIMIT 1) r ON true
   WHERE m.tenant_id=? AND m.id=? AND m.in_library AND w.kind='SHARED' AND NOT w.archived
   """,(r,n)->new Input(r.getObject("workspace_id",UUID.class),r.getObject("id",UUID.class),r.getInt("number"),r.getString("filename"),r.getObject("object_id",UUID.class),r.getLong("size_bytes"),r.getString("sha256"),r.getObject("run_id",UUID.class),r.getString("parse_status"),r.getInt("revision")),tenant,material);
  if(rows.isEmpty())throw new IdentityException(404,"MATERIAL_NOT_FOUND");var in=rows.getFirst();access.requireObject(actor,tenant,in.space(),"MATERIAL",material,true);return in;
 }
 private Text text(Input in){
  if(in.filename().toLowerCase(Locale.ROOT).matches(".*\\.(txt|md|markdown)$")){
   if(in.bytes()>2_000_000)throw new IdentityException(413,"MATERIAL_GOVERNANCE_TEXT_LIMIT");
   try{return new Text(StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(store.read(in.object(),in.bytes(),in.hash()))).toString(),"ORIGINAL_TEXT",null);}
   catch(CharacterCodingException ex){throw new IdentityException(409,"MATERIAL_GOVERNANCE_UTF8_REQUIRED");}
  }
  if(in.run()==null||!Set.of("READY","PARTIAL").contains(in.parseStatus()))return new Text("","NO_TEXT",in.run());
  long size=db.queryForObject("SELECT coalesce(sum(length(content)),0) FROM knowledge_chunks WHERE run_id=?",Long.class,in.run());
  if(size>2_000_000)throw new IdentityException(413,"MATERIAL_GOVERNANCE_TEXT_LIMIT");
  String text=String.join("\n",db.queryForList("SELECT content FROM knowledge_chunks WHERE run_id=? ORDER BY ordinal",String.class,in.run()));
  return new Text(text,text.isEmpty()?"NO_TEXT":in.parseStatus().equals("READY")?"PARSED_TEXT":"PARTIAL_TEXT",in.run());
 }
 @Transactional public Result change(UUID actor,UUID tenant,UUID material,Change change,boolean redaction){
  if(change==null||change.requestId()==null||change.expectedVersion()<1||change.expectedRevision()<0||change.tags()==null||change.tags().size()>12||change.tags().stream().anyMatch(t->t==null||t.isBlank()||t.length()>40))throw IdentityException.invalid();
  identities.member(actor,tenant,false,false);db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant); // serialize ACL, version and report mutations
  Input in=input(actor,tenant,material);
  String fingerprint=IdentityService.hash(tenant+"\n"+material+"\n"+json.writeValueAsString(change)+"\n"+redaction);
  UUID prior=identities.priorRequest(actor,change.requestId(),"MATERIAL_GOVERNANCE",fingerprint);
  if(prior!=null)return receipt(prior,redaction);
  if(in.number()!=change.expectedVersion()||in.revision()!=change.expectedRevision())throw new IdentityException(409,"MATERIAL_GOVERNANCE_VERSION_CONFLICT");
  Text text=text(in);List<String> tags=change.tags().stream().map(String::strip).distinct().toList();
  if(redaction){
   if(!text.source().equals("ORIGINAL_TEXT"))throw new IdentityException(409,"MATERIAL_GOVERNANCE_REDACTION_TEXT_ONLY");
   String clean=redact(text.content());if(clean.equals(text.content()))throw new IdentityException(409,"MATERIAL_GOVERNANCE_NO_SENSITIVE_MATCH");
   materials.storeGenerated(actor,tenant,in.space(),null,material,in.number(),in.filename(),clean.getBytes(StandardCharsets.UTF_8));
   in=input(actor,tenant,material);text=new Text(clean,"ORIGINAL_TEXT",null);
  }
  List<String> issues=findings(text.content(),tags,change.reviewAt(),LocalDate.now(ZoneId.of("Asia/Shanghai")));
  if(text.source().equals("NO_TEXT"))issues=issues.stream().filter(i->!i.equals("content")).toList();
  UUID report=UUID.randomUUID();int revision=in.revision()+1;
  db.update("INSERT INTO material_governance_reports(id,tenant_id,workspace_id,material_id,version_id,run_id,parse_status,revision,source,issues,tags,review_at,actor_id) VALUES (?,?,?,?,?,?,?,?,?,?::text[],?::text[],?,?)",report,tenant,in.space(),material,in.version(),text.run(),text.run()==null?null:in.parseStatus(),revision,text.source(),issues.toArray(String[]::new),tags.toArray(String[]::new),change.reviewAt(),actor);
  identities.remember(actor,change.requestId(),"MATERIAL_GOVERNANCE",fingerprint,report);audit.record(actor,tenant,redaction?"MATERIAL_GOVERNANCE_REDACT":"MATERIAL_GOVERNANCE_CHECK",material,"SUCCESS");
  return receipt(report,redaction);
 }
 private Result receipt(UUID id,boolean redacted){return db.queryForObject("SELECT g.*,v.number FROM material_governance_reports g JOIN material_versions v ON v.id=g.version_id WHERE g.id=?",(r,n)->new Result(id,r.getInt("number"),r.getInt("revision"),r.getString("source"),Arrays.asList((String[])r.getArray("issues").getArray()),Arrays.asList((String[])r.getArray("tags").getArray()),r.getDate("review_at")==null?null:r.getDate("review_at").toLocalDate(),redacted),id);}
}
