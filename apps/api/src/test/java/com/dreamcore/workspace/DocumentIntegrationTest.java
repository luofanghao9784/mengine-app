package com.dreamcore.workspace;
import com.dreamcore.workspace.document.*;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import static org.junit.jupiter.api.Assertions.*;
@SpringBootTest(properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.initial-delay-ms=3600000"})
class DocumentIntegrationTest {
 @Autowired DocumentService documents; @Autowired ConversationService conversations; @Autowired AgentTaskService agents;
 @Autowired JdbcTemplate db; @Autowired PasswordEncoder passwords; @Autowired DocumentRenderer renderer;
 UUID tenant,other,owner,reader,admin,space,personal;
    @BeforeEach void fixture(){
        tenant=UUID.randomUUID();other=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();admin=UUID.randomUUID();space=UUID.randomUUID();personal=UUID.randomUUID();
        for(UUID actor:List.of(owner,reader,admin))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",actor,actor+"@example.test","合成画报测试",passwords.encode("synthetic-briefing-password"));
        db.update("INSERT INTO tenants(id,name) VALUES (?,'画报测试'),(?,'其他企业')",tenant,other);
        for(UUID actor:List.of(owner,reader,admin))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,actor,actor.equals(admin)?"TENANT_ADMIN":"MEMBER");
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'共享资料','SHARED'),(?,?,?,'个人资料','PERSONAL')",space,tenant,admin,personal,tenant,owner);
        db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,false),(?,?,?,false)",tenant,space,owner,tenant,space,reader);
    }
    @AfterEach void cleanup(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);}
    void denied(int status,Runnable action){assertEquals(status,assertThrows(IdentityException.class,action::run).status);}

 ConversationService.Detail success(UUID location,String reply){
  var submitted=conversations.submit(owner,tenant,null,location,UUID.randomUUID(),"合成文稿任务","AGENT");var job=conversations.claim();assertNotNull(job);
  agents.finish(job,new AgentResult("1.4","0.8.0",job.id(),job.token(),"AGENT","verification","local-verification",reply,List.of(),List.of(),List.of(),1,null,List.of(),List.of(),List.of()));return conversations.detail(owner,tenant,submitted.conversation().id(),0,20);
 }
 DocumentService.Detail create(){var task=success(space,"第一版报告\n来源财务资料，尚未共享。");return documents.create(owner,tenant,task.conversation().id(),task.tasks().getFirst().id(),null,UUID.randomUUID());}
 @Test void repeatedSaveHasOneDocumentAndImmutableHistory(){
  var result=success(space,"原始正文");UUID task=result.tasks().getFirst().id(),conversation=result.conversation().id(),key=UUID.randomUUID();
  var first=documents.create(owner,tenant,conversation,task,null,key);UUID id=first.document().id();assertEquals(personal,first.document().workspaceId());assertEquals(space,first.document().sourceWorkspaceId());
  assertEquals(id,documents.create(owner,tenant,conversation,task,null,key).document().id());assertEquals(id,documents.create(owner,tenant,conversation,task,null,UUID.randomUUID()).document().id());
  UUID save=UUID.randomUUID();var edited=documents.save(owner,tenant,id,save,1,"修订报告","修改正文");assertEquals(2,edited.version().number());
  assertEquals(2,documents.save(owner,tenant,id,save,1,"修订报告","修改正文").version().number());
  denied(409,()->documents.save(owner,tenant,id,save,1,"修订报告","另一份正文"));denied(409,()->documents.save(owner,tenant,id,UUID.randomUUID(),1,"旧草稿","正文"));
  assertEquals(2,documents.save(owner,tenant,id,UUID.randomUUID(),2,"修订报告","修改正文").version().number());
  assertEquals("原始正文",documents.detail(owner,tenant,id,1).version().body());assertEquals("原始正文",conversations.historical(owner,tenant,conversation,task).tasks().getFirst().reply());
  assertEquals(1,documents.list(owner,tenant,0,20).items().size());
 }
 @Test void replayConfirmsItsOwnVersionAfterLaterEdits(){
  UUID id=create().document().id(),key=UUID.randomUUID();documents.save(owner,tenant,id,key,1,"首次保存","首次正文");documents.save(owner,tenant,id,UUID.randomUUID(),2,"后续保存","后续正文");
  var replay=documents.save(owner,tenant,id,key,1,"首次保存","首次正文");assertEquals(2,replay.version().number());assertEquals("首次正文",replay.version().body());assertEquals(3,replay.document().revision());
 }
 @Test void sourceRevocationBlocksReadSaveCachedDownloadAndIdempotentReplayButKeepsRecords(){
  var d=create();UUID id=d.document().id(),save=UUID.randomUUID();documents.save(owner,tenant,id,save,1,"个人编辑","仍然依赖财务来源");
  var exported=documents.export(owner,tenant,id,1,"docx");assertTrue(exported.bytes().length>0);
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
  denied(404,()->documents.detail(owner,tenant,id,null));denied(404,()->documents.detail(owner,tenant,id,1));denied(404,()->documents.export(owner,tenant,id,1,"docx"));
  denied(404,()->documents.save(owner,tenant,id,save,1,"个人编辑","仍然依赖财务来源"));denied(404,()->documents.save(owner,tenant,id,UUID.randomUUID(),2,"尝试抹去来源","新正文"));assertTrue(documents.list(owner,tenant,0,20).items().isEmpty());
  assertEquals(2,db.queryForObject("SELECT count(*) FROM private_document_versions WHERE document_id=?",Integer.class,id));assertEquals(1,db.queryForObject("SELECT count(*) FROM private_document_exports WHERE document_id=?",Integer.class,id));
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,false)",tenant,space,owner);
  assertEquals("仍然依赖财务来源",documents.detail(owner,tenant,id,null).version().body());assertArrayEquals(exported.bytes(),documents.export(owner,tenant,id,1,"docx").bytes());
 }
 @Test void privateDocumentsHaveNoSameSpaceAdminOrTenantBypass(){
  var doc=create();UUID id=doc.document().id();
  for(UUID actor:List.of(reader,admin)){assertTrue(documents.list(actor,tenant,0,20).items().isEmpty());denied(404,()->documents.detail(actor,tenant,id,null));denied(404,()->documents.export(actor,tenant,id,1,"pdf"));denied(404,()->documents.save(actor,tenant,id,UUID.randomUUID(),1,"x","y"));denied(404,()->documents.create(actor,tenant,doc.document().conversationId(),doc.document().taskId(),null,UUID.randomUUID()));}
  denied(403,()->documents.detail(owner,other,id,null));db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);denied(403,()->documents.export(owner,tenant,id,1,"docx"));
 }
 @Test void disabledMembershipStopsPersonalAndSourceAccess(){var d=create();db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,owner);denied(403,()->documents.list(owner,tenant,0,20));denied(403,()->documents.detail(owner,tenant,d.document().id(),null));}
 @Test void concurrentEditsHaveOneWinner()throws Exception{
  UUID id=create().document().id();var start=new java.util.concurrent.CountDownLatch(1);
  try(var pool=java.util.concurrent.Executors.newFixedThreadPool(2)){var values=new ArrayList<java.util.concurrent.Future<Integer>>();for(String body:List.of("编辑甲","编辑乙"))values.add(pool.submit(()->{start.await();try{documents.save(owner,tenant,id,UUID.randomUUID(),1,"竞争编辑",body);return 200;}catch(IdentityException e){return e.status;}}));start.countDown();var statuses=new ArrayList<Integer>();for(var v:values)statuses.add(v.get(5,java.util.concurrent.TimeUnit.SECONDS));Collections.sort(statuses);assertEquals(List.of(200,409),statuses);assertEquals(2,documents.detail(owner,tenant,id,null).version().number());}
 }
 @Test void queuedFailedOrUnrelatedTaskCannotBecomeDocument(){
  var queued=conversations.submit(owner,tenant,null,space,UUID.randomUUID(),"未完成","AGENT");UUID id=queued.conversation().id(),task=queued.tasks().getFirst().id();
  denied(404,()->documents.create(owner,tenant,id,task,null,UUID.randomUUID()));conversations.action(owner,tenant,id,task,UUID.randomUUID(),0,"CANCEL");denied(404,()->documents.create(owner,tenant,id,task,null,UUID.randomUUID()));
  var valid=success(personal,"成功");denied(404,()->documents.create(owner,tenant,id,valid.tasks().getFirst().id(),null,UUID.randomUUID()));
 }
 @Test void artifactImportRejectsUnsupportedEncodingTypeAndAnotherTask()throws Exception{
  var source=success(space,"已完成文稿");var foreign=success(space,"另一任务");UUID conversation=source.conversation().id(),task=source.tasks().getFirst().id(),foreignTask=foreign.tasks().getFirst().id();
  for(String filename:List.of("binary.txt","report.json","foreign.md")){
   UUID artifact=UUID.randomUUID();byte[] content=filename.equals("binary.txt")?new byte[]{(byte)0xff}:"正文".getBytes(StandardCharsets.UTF_8);
   String sha=HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(content));
   db.update("INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content,attempt_number) VALUES (?,?,?,?,?,?,?,1)",artifact,tenant,space,filename.equals("foreign.md")?foreignTask:task,filename,sha,content);
   denied(filename.equals("foreign.md")?404:400,()->documents.create(owner,tenant,conversation,task,artifact,UUID.randomUUID()));
  }
  assertTrue(documents.list(owner,tenant,0,20).items().isEmpty());
 }
 @Test void invalidXmlOversizedAndBlankDocumentsAreRejected(){
  UUID id=create().document().id();for(String body:List.of(""," ","a".repeat(32769),"literal\u0001"))denied(400,()->documents.save(owner,tenant,id,UUID.randomUUID(),1,"标题",body));
  denied(400,()->documents.save(owner,tenant,id,UUID.randomUUID(),1,"bad\nheading","body"));assertEquals(1,documents.detail(owner,tenant,id,null).version().number());
 }
 @Test void fixedVersionExportsEmbedChineseKeepLiteralMarkupAndProduceOpenableMultipageFiles()throws Exception {
  var first=create();UUID id=first.document().id();String body="# 项目进展\n已完成个人文稿版本保存。\n<script>literal & safe</script>\n- 第一项 0.1 + 0.2 = 0.3\n\n## 验证依据\n"+("中文段落用于验证分页和换行，不能截断或覆盖。English text with source version 1 and long evidence.\n").repeat(55);
  documents.save(owner,tenant,id,UUID.randomUUID(),1,"梦核工作空间文稿导出验证",body);
  var pdf=documents.export(owner,tenant,id,2,"pdf");var word=documents.export(owner,tenant,id,2,"docx");assertArrayEquals(pdf.bytes(),documents.export(owner,tenant,id,2,"pdf").bytes());
  try(var parsed=Loader.loadPDF(pdf.bytes())){assertTrue(parsed.getNumberOfPages()>1);String text=new PDFTextStripper().getText(parsed);assertTrue(text.contains("梦核工作空间文稿导出验证"));assertTrue(text.contains("<script>literal & safe</script>"));for(var page:parsed.getPages())for(var name:page.getResources().getFontNames())assertTrue(page.getResources().getFont(name).isEmbedded());}
  try(var zip=new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(word.bytes()))){boolean found=false;for(var e=zip.getNextEntry();e!=null;e=zip.getNextEntry())if(e.getName().equals("word/document.xml")){String xml=new String(zip.readAllBytes(),StandardCharsets.UTF_8);assertTrue(xml.contains("&lt;script&gt;literal &amp; safe&lt;/script&gt;"));found=true;}assertTrue(found);}
  try(var zip=new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(word.bytes()))){boolean found=false;for(var e=zip.getNextEntry();e!=null;e=zip.getNextEntry())if(e.getName().endsWith("regular.odttf")){
   byte[] font=zip.readAllBytes(),key=HexFormat.of().parseHex("C3D9062836584D4382D78A12984E105F");for(int i=0;i<32;i++)font[i]^=key[15-i%16];
   try(var parsed=new org.apache.fontbox.ttf.TTFParser().parseEmbedded(new java.io.ByteArrayInputStream(font))){assertEquals(0,parsed.getOS2Windows().getVersion());assertTrue(parsed.getUnicodeCmapLookup().getGlyphId('梦')>0);assertTrue(parsed.getUnicodeCmapLookup().getGlyphId('A')==0);assertFalse(parsed.getTableMap().containsKey("GSUB"));}found=true;
  }assertTrue(found);}
  Path root=Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();Path target=root.resolve(".local/m6-documents");Files.createDirectories(target);Files.write(target.resolve("sample.pdf"),pdf.bytes());Files.write(target.resolve("sample.docx"),word.bytes());
  assertNotEquals(word.sha256(),documents.export(owner,tenant,id,1,"docx").sha256());
 }
 @Test void missingGlyphFailsExplicitlyWithoutCachingMisleadingPdf(){var doc=create();UUID id=doc.document().id();documents.save(owner,tenant,id,UUID.randomUUID(),1,"字体验证","未支持字符 \uD83E\uDD84");denied(422,()->documents.export(owner,tenant,id,2,"pdf"));assertEquals(0,db.queryForObject("SELECT count(*) FROM private_document_exports WHERE document_id=?",Integer.class,id));assertTrue(documents.export(owner,tenant,id,2,"docx").bytes().length>0);}
 @Test void documentDisableHidesAllVersionsAndCachedExportsBeforePhysicalCleanup(){
  var d=create();UUID id=d.document().id(),key=UUID.randomUUID();documents.save(owner,tenant,id,key,1,"待停用文稿","本地保存正文");documents.export(owner,tenant,id,1,"docx");
  db.update("UPDATE object_lifecycle SET state='DISABLED' WHERE kind='DOCUMENT' AND object_id=?",id);
  assertTrue(documents.list(owner,tenant,0,20).items().isEmpty());assertFalse(documents.list(owner,tenant,0,20).hasMore());
  denied(404,()->documents.detail(owner,tenant,id,1));denied(404,()->documents.export(owner,tenant,id,1,"docx"));denied(404,()->documents.save(owner,tenant,id,key,1,"待停用文稿","本地保存正文"));
  assertEquals(1,db.queryForObject("SELECT count(*) FROM private_document_exports WHERE document_id=?",Integer.class,id));
 }
 @Test void expiredRenderedCacheCannotDownloadAndOldCleanupCannotDeleteNewExplicitExport(){
  UUID id=create().document().id();documents.export(owner,tenant,id,1,"docx");UUID old=db.queryForObject("SELECT object_id FROM object_lifecycle WHERE kind='EXPORT_CACHE' AND parent_id=?",UUID.class,id);
  db.update("UPDATE object_lifecycle SET is_formal=false,policy_due=now()-interval '1 second',policy_pending=false WHERE object_id=?",old);
  denied(410,()->documents.export(owner,tenant,id,1,"docx"));assertNotNull(documents.detail(owner,tenant,id,1));
  db.queryForList("SELECT scrub_lifecycle_object('EXPORT_CACHE',?)",old);var regenerated=documents.export(owner,tenant,id,1,"docx");assertTrue(regenerated.bytes().length>0);
  db.queryForList("SELECT scrub_lifecycle_object('EXPORT_CACHE',?)",old);
  assertEquals(1,db.queryForObject("SELECT count(*) FROM private_document_exports WHERE document_id=?",Integer.class,id));assertArrayEquals(regenerated.bytes(),documents.export(owner,tenant,id,1,"docx").bytes());
 }
 @Test void disabledArtifactStopsItsDerivedDocumentWithoutHidingIndependentTaskReply(){
  var source=success(space,"任务本体仍可读");UUID task=source.tasks().getFirst().id(),artifact=UUID.randomUUID();byte[] body="附件专用正文".getBytes(StandardCharsets.UTF_8);
  db.update("INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content,attempt_number) VALUES (?,?,?,?,'detail.md',?,?,1)",artifact,tenant,space,task,com.dreamcore.workspace.material.ObjectStore.sha256(body),body);
  var doc=documents.create(owner,tenant,source.conversation().id(),task,artifact,UUID.randomUUID());
  db.update("UPDATE object_lifecycle SET state='TRASHED' WHERE kind='ARTIFACT' AND object_id=?",artifact);
  denied(404,()->agents.download(owner,tenant,source.conversation().id(),task,artifact));denied(404,()->documents.detail(owner,tenant,doc.document().id(),1));assertTrue(documents.list(owner,tenant,0,20).items().isEmpty());
  var visible=conversations.historical(owner,tenant,source.conversation().id(),task).tasks().getFirst();assertEquals("任务本体仍可读",visible.reply());assertTrue(visible.artifacts().isEmpty());
 }

}
