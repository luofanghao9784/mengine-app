package com.dreamcore.workspace.analysis.governed;
import com.dreamcore.workspace.briefing.BriefingGenerationService;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.departure.DepartureAccess;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import com.dreamcore.workspace.plans.PlanClock;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Extend the existing dispatcher transaction, before workers can observe and claim a new task. */
@Service @Primary
public class FusionBriefingGenerationService extends BriefingGenerationService {
 private final GovernedFusionService fusion;
 public FusionBriefingGenerationService(JdbcTemplate db,ConversationService tasks,BriefingContentService contents,com.dreamcore.workspace.collection.DatasetContentFingerprint fingerprints,IdentityService identities,MaterialAccess access,DepartureAccess departure,AgentSettings agents,PlanClock clock,
  @Value("${dreamcore.tasks.enabled:false}") boolean enabled,@Value("${dreamcore.briefing.news-source:}") String news,
  @Value("${dreamcore.briefing.merge-seconds:60}") int merge,@Value("${dreamcore.briefing.max-runs-per-day:6}") int limit,GovernedFusionService fusion){
  super(db,tasks,contents,fingerprints,identities,access,departure,agents,clock,enabled,news,merge,limit);this.fusion=fusion;
 }
 @Override @Transactional public void tick(UUID policy){super.tick(policy);fusion.prepareQueued(policy);}
}
