package com.dreamcore.workspace.analysis.governed;
import com.dreamcore.workspace.context.*;
import com.dreamcore.workspace.material.MaterialAccess;
import java.util.*;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
@Service @Primary
public class FusionDatasetTaskContext extends DatasetTaskContext {
 private final GovernedFusionService fusion;
 public FusionDatasetTaskContext(JdbcTemplate db,MaterialAccess access,GovernedFusionService fusion,com.dreamcore.workspace.collection.NativeGovernanceDeployment governance){super(db,access,governance);this.fusion=fusion;}
 @Override public Object read(UUID task,TaskContextService.Request request){
  Object result=super.read(task,request);Object plan=fusion.context(task);
  if(plan==null)return result;
  var enriched=new LinkedHashMap<String,Object>();((Map<?,?>)result).forEach((k,v)->enriched.put(k.toString(),v));enriched.put("fusionPlan",plan);return enriched;
 }
}
