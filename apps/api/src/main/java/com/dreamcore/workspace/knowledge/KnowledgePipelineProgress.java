package com.dreamcore.workspace.knowledge;

import com.dreamcore.workspace.collection.CollectionService;
import com.dreamcore.workspace.identity.IdentityService;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Operational facts only; never stores model text, credentials or source rows. */
@Service
public class KnowledgePipelineProgress {
 public record Step(String stage,String source,String state,String reason,String message) {}
 public record View(List<Step> steps,int waiting,int failed,boolean busy) {}
 private final JdbcTemplate db;private final CollectionService collections;private final IdentityService identities;
 public KnowledgePipelineProgress(JdbcTemplate db,CollectionService collections,IdentityService identities){this.db=db;this.collections=collections;this.identities=identities;}
 public void record(UUID tenant,UUID source,String stage,String state,String reason){
  String safe=reason!=null&&reason.matches("[A-Z0-9_]{1,100}")?reason:"PROCESSING_FAILED";
  String revision=db.queryForList("SELECT coalesce(current_snapshot::text,'') FROM business_datasets WHERE tenant_id=? AND id=?",String.class,tenant,source).stream().findFirst().orElse("");
  db.update("INSERT INTO knowledge_pipeline_progress(tenant_id,source_id,stage,state,reason,input_revision,last_success_at) VALUES (?,?,?,?,?,?,CASE WHEN ?='SUCCEEDED' THEN now() END) ON CONFLICT(tenant_id,source_id,stage) DO UPDATE SET state=excluded.state,reason=excluded.reason,input_revision=excluded.input_revision,updated_at=now(),last_success_at=coalesce(excluded.last_success_at,knowledge_pipeline_progress.last_success_at)",tenant,source,stage,state,safe,revision,state);
 }
 public boolean due(UUID tenant,UUID source,String stage){
  return !Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM knowledge_pipeline_progress p JOIN business_datasets d ON d.tenant_id=p.tenant_id AND d.id=p.source_id WHERE p.tenant_id=? AND p.source_id=? AND p.stage=? AND p.state='SUCCEEDED' AND p.input_revision=coalesce(d.current_snapshot::text,'') AND p.updated_at>now()-interval '5 minutes')",Boolean.class,tenant,source,stage));
 }
 public View view(UUID actor,UUID tenant){
  identities.member(actor,tenant,false);var sources=db.queryForList("SELECT id,name FROM business_datasets WHERE tenant_id=? AND status='ACTIVE' AND NOT scrubbed",tenant);
  Map<UUID,String> readable=new HashMap<>();for(var row:sources)if(collections.readable(actor,tenant,(UUID)row.get("id")))readable.put((UUID)row.get("id"),row.get("name").toString());
  boolean all=!sources.isEmpty()&&readable.size()==sources.size();List<Step> steps=new ArrayList<>();
  for(var row:db.queryForList("SELECT source_id,stage,state,reason FROM knowledge_pipeline_progress WHERE tenant_id=? ORDER BY stage,source_id",tenant)){
   UUID source=(UUID)row.get("source_id");String stage=row.get("stage").toString();
   if(stage.equals("INSIGHT")?!all:!readable.containsKey(source))continue;
   String state=row.get("state").toString(),reason=row.get("reason").toString();
   if(!state.equals("SUCCEEDED"))steps.add(new Step(stage,stage.equals("INSIGHT")?"企业经营知识":readable.get(source),state,reason,message(reason)));
  }
  for(var row:db.queryForList("SELECT dataset_id,reason FROM collection_delivery_waits WHERE tenant_id=?",tenant)){
   UUID id=(UUID)row.get("dataset_id");if(readable.containsKey(id)){String reason=row.get("reason").toString();steps.add(new Step("COLLECTION",readable.get(id),"WAITING",reason,message(reason)));}
  }
  boolean busy=false;
  if(all){
   var jobs=db.queryForList("SELECT t.status FROM dataset_business_knowledge k JOIN conversation_tasks t ON t.id=k.task_id JOIN tenant_governance g ON g.tenant_id=k.tenant_id AND g.owner_id=k.actor_id WHERE k.tenant_id=? ORDER BY k.created_at DESC,k.id DESC LIMIT 1",String.class,tenant);
   if(!jobs.isEmpty()){
    String state=jobs.getFirst();
    if(Set.of("QUEUED","RUNNING").contains(state)){busy=true;steps.removeIf(s->s.stage().equals("INSIGHT"));steps.add(new Step("INSIGHT","企业经营知识","RUNNING",state,"正在生成经营知识，完成后自动显示"));}
    else if(Set.of("FAILED","INTERRUPTED","RESULT_UNKNOWN").contains(state)){steps.removeIf(s->s.stage().equals("INSIGHT"));steps.add(new Step("INSIGHT","企业经营知识",state.equals("RESULT_UNKNOWN")?"WAITING":"FAILED",state,state.equals("RESULT_UNKNOWN")?"执行结果待核对，不自动重复调用模型":"经营知识生成失败，保留执行记录；核对失败原因后再重试"));}
    else if(Set.of("WAITING_INPUT","WAITING_CAPABILITY","PAUSED","CANCELLED").contains(state))steps.add(new Step("INSIGHT","企业经营知识","WAITING",state,message(state)));
   }
  }
  return new View(List.copyOf(steps),(int)steps.stream().filter(s->s.state().equals("WAITING")).count(),(int)steps.stream().filter(s->s.state().equals("FAILED")).count(),busy);
 }
 private static String message(String reason){return switch(reason){
  case "PROCESSING_FAILED" -> "自动处理失败，已保留状态，请查看运行记录后重试";
  case "NATIVE_ANALYSIS_PLANS_INVALID","DATASET_INSIGHT_PLAN_INVALID" -> "来源统计计划不完整或与字段口径不一致，等待修正规则";
  case "DATASET_INSIGHT_DATE_INVALID","DATASET_INSIGHT_VALUE_INVALID" -> "本批数据不符合统计计划的日期或数值规则，等待来源核查";
  case "SOURCE_GOVERNANCE_REQUIRED","SOURCE_DEFINITION_REQUIRED","WAITING_SOURCE_DEFINITION" -> "等待完整字段口径与规则，补齐后自动继续";
  case "SOURCE_FIELDS_UNCONFIRMED" -> "字段含义尚不完整，等待来源口径更新";
  case "SOURCE_VALIDATION_FAILED","SOURCE_DATA_REQUIRES_REVIEW" -> "本批数据未通过已声明规则，保留上一有效版本，等待修正后重新采集";
  case "SOURCE_RECEIPT_REQUIRED" -> "等待本批完整导出与接收回执";
  case "SOURCE_CONSTRAINTS_REQUIRED","SOURCE_RELATION_UNVERIFIED" -> "来源规则检查未完成，请核对支持范围";
  case "DATASET_INSIGHT_PARTITION_REQUIRED" -> "数据超过单次处理范围，需要完整分区后再分析";
  case "DATASET_INSIGHT_NO_SOURCES" -> "尚无可分析的数据集，等待采集";
  case "DATASET_INSIGHT_SOURCE_INCOMPLETE" -> "部分数据集尚无有效快照，等待完整来源后统一分析";
  case "DATASET_INSIGHT_ACCESS_REQUIRED" -> "执行负责人缺少来源读取权限";
  case "DATASET_INSIGHT_SOURCE_CHANGED","SOURCE_VERSION_CHANGED" -> "来源或规则已变化，等待新版本核验";
  case "DATASET_INSIGHT_BUSY" -> "已有经营知识任务，等待当前任务结束";
  case "WAITING_CAPABILITY" -> "等待模型或执行能力恢复";
  case "WAITING_INPUT" -> "任务等待补充输入";
  case "PAUSED","CANCELLED" -> "任务已暂停或取消，不会自动重复付费执行";
  default -> "处理尚未完成，请查看对应来源或运行记录";
 };}
}
