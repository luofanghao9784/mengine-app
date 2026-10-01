package com.dreamcore.workspace.methods;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Receives the complete already-authorized, deduplicated and preference-filtered pool, BEFORE pagination. */
@Service
public class MethodSelection {
 public record Configuration(double relevanceWeight,double recencyWeight,double importanceWeight) {}
 public record Candidate(UUID id,UUID workspaceId,double relevance,double recency,double importance,Instant createdAt) {}
 public record MethodRef(UUID versionId,int adoptionRevision,String scope,UUID workspaceId,String configurationSha) {}
 public record Ranked(Candidate candidate,double score,MethodRef method) {}
 public record Ranking(List<Ranked> items,String snapshotKey) {}
 public static final Configuration DEFAULT=new Configuration(.55,.25,.20);
 private final JdbcTemplate db;private final IdentityService identities;private final MaterialAccess access;private final JsonMapper json=new JsonMapper();
 public MethodSelection(JdbcTemplate db,IdentityService identities,MaterialAccess access){this.db=db;this.identities=identities;this.access=access;}
 public static Configuration validate(Configuration c){if(c==null||!finite(c.relevanceWeight(),100)||!finite(c.recencyWeight(),100)||!finite(c.importanceWeight(),100)||c.relevanceWeight()+c.recencyWeight()+c.importanceWeight()<=0)throw IdentityException.invalid();return c;}
 private static boolean finite(double n,double max){return Double.isFinite(n)&&n>=0&&n<=max;}
 public static void candidates(List<Candidate> items){if(items==null||items.size()>1000)throw new IdentityException(400,"METHOD_POOL_LIMIT");var ids=new HashSet<UUID>();for(var c:items)if(c==null||c.id()==null||c.workspaceId()==null||c.createdAt()==null||!ids.add(c.id())||!finite(c.relevance(),1)||!finite(c.recency(),1)||!finite(c.importance(),1))throw IdentityException.invalid();}
 public static double score(Candidate c,Configuration p){validate(p);return (c.relevance()*p.relevanceWeight()+c.recency()*p.recencyWeight()+c.importance()*p.importanceWeight())/(p.relevanceWeight()+p.recencyWeight()+p.importanceWeight());}
 public static final Comparator<Ranked> ORDER=Comparator.comparingDouble(Ranked::score).reversed().thenComparing(r->r.candidate().createdAt(),Comparator.reverseOrder()).thenComparing(r->r.candidate().id().toString());
 public static List<UUID> order(List<Candidate> pool,Configuration config){candidates(pool);validate(config);return pool.stream().map(c->new Ranked(c,score(c,config),null)).sorted(ORDER).map(r->r.candidate().id()).toList();}
 public static String configurationSha(Configuration c){validate(c);return IdentityService.hash(new JsonMapper().writeValueAsString(c));}
 @Transactional public Ranking rank(UUID actor,UUID tenant,List<Candidate> authorizedPool){
  candidates(authorizedPool);identities.member(actor,tenant,false);for(UUID w:authorizedPool.stream().map(Candidate::workspaceId).distinct().sorted().toList())access.require(actor,tenant,w,false);
  var choices=db.queryForList("SELECT a.workspace_id,a.revision,a.version_id,v.configuration,v.configuration_sha FROM method_adoptions a JOIN method_releases r ON r.version_id=a.version_id JOIN method_versions v ON v.id=a.version_id WHERE a.tenant_id=? AND a.status='ACTIVE' AND NOT v.scrubbed AND object_is_active('METHOD_VERSION',v.id)",tenant);
  var configs=new HashMap<UUID,Configuration>();var refs=new HashMap<UUID,MethodRef>();Configuration tenantConfig=DEFAULT;MethodRef tenantRef=new MethodRef(null,0,"BUILTIN",null,configurationSha(DEFAULT));
  for(var r:choices){UUID w=(UUID)r.get("workspace_id");var c=validate(json.readValue(r.get("configuration").toString(),Configuration.class));var ref=new MethodRef((UUID)r.get("version_id"),((Number)r.get("revision")).intValue(),w==null?"TENANT":"WORKSPACE",w,(String)r.get("configuration_sha"));if(w==null){tenantConfig=c;tenantRef=ref;}else{configs.put(w,c);refs.put(w,ref);}}
  var out=new ArrayList<Ranked>();for(var c:authorizedPool){var config=configs.getOrDefault(c.workspaceId(),tenantConfig);out.add(new Ranked(c,score(c,config),refs.getOrDefault(c.workspaceId(),tenantRef)));}out.sort(ORDER);
  // Caller additionally binds source-pool and preference versions to its pagination snapshot.
  return new Ranking(List.copyOf(out),IdentityService.hash(json.writeValueAsString(out.stream().map(r->List.of(r.candidate().id(),r.score(),r.method())).toList())));
 }
}
