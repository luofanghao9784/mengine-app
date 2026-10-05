package com.dreamcore.workspace.news;
import com.dreamcore.workspace.identity.*;
import java.net.URI;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
@Service
public class NewsSourceCatalog {
 public record Source(UUID id,String name,String url,String format,String industry,String region,boolean enabled,int revision,boolean selected,String lastStatus,java.time.Instant checkedAt) {}
 public record Change(UUID id,int revision,String name,String url,String format,String industry,String region,boolean enabled) {}
 private final JdbcTemplate db;private final IdentityService identities;private final IdentityAudit audit;
 public NewsSourceCatalog(JdbcTemplate db,IdentityService identities,IdentityAudit audit){this.db=db;this.identities=identities;this.audit=audit;}
 public static String validateUrl(String value){
  try{var u=URI.create(value.strip());String h=u.getHost();if(value.length()>2048||!"https".equals(u.getScheme())||h==null||!h.contains(".")||u.getUserInfo()!=null||u.getFragment()!=null||(u.getPort()!=-1&&u.getPort()!=443)||h.matches("(?i).*(localhost|\\.local|\\.internal|\\.test|\\.invalid)$")||h.matches("[0-9.]+"))throw new IllegalArgumentException();return u.toASCIIString();}catch(Exception e){throw new IdentityException(422,"NEWS_SOURCE_URL_INVALID");}
 }
 private List<Source> rows(UUID tenant){return db.query("SELECT s.*,coalesce(t.enabled,false) selected,o.status last_status,o.finished_at checked_at FROM news_sources s LEFT JOIN tenant_news_sources t ON t.source_id=s.id AND t.tenant_id=? LEFT JOIN LATERAL(SELECT status,finished_at FROM conversation_tasks WHERE public_query=s.url AND (?::uuid IS NULL OR tenant_id=?::uuid) ORDER BY created_at DESC LIMIT 1) o ON true ORDER BY s.name,s.id LIMIT 200",(r,n)->new Source(r.getObject("id",UUID.class),r.getString("name"),r.getString("url"),r.getString("format"),r.getString("industry"),r.getString("region"),r.getBoolean("enabled"),r.getInt("revision"),r.getBoolean("selected"),r.getString("last_status"),r.getTimestamp("checked_at")==null?null:r.getTimestamp("checked_at").toInstant()),tenant,tenant,tenant);}
 public List<Source> list(UUID actor,UUID tenant){if(tenant==null)identities.platform(actor);else identities.member(actor,tenant,true);return rows(tenant);}
 @Transactional public Source save(UUID actor,Change c){
  identities.platform(actor);if(c==null||c.name()==null||c.name().isBlank()||c.name().length()>120||c.industry()==null||c.industry().length()>120||c.region()==null||c.region().length()>120||!Set.of("PAGE","RSS","ATOM").contains(c.format()))throw IdentityException.invalid();String url=validateUrl(c.url());
  UUID id=c.id();if(id==null)throw IdentityException.invalid();
  if(c.revision()==0){
   var existing=rows(null).stream().filter(s->s.id().equals(id)).findFirst();
   if(existing.isPresent()){var old=existing.get();if(old.revision()==1&&old.name().equals(c.name().strip())&&old.url().equals(url)&&old.format().equals(c.format())&&old.industry().equals(c.industry().strip())&&old.region().equals(c.region().strip())&&old.enabled()==c.enabled())return old;throw new IdentityException(409,"NEWS_SOURCE_REQUEST_CONFLICT");}
   if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM news_sources WHERE url=?)",Boolean.class,url)))throw new IdentityException(409,"NEWS_SOURCE_URL_EXISTS");db.update("INSERT INTO news_sources(id,name,url,format,industry,region,enabled,changed_by) VALUES(?,?,?,?,?,?,?,?)",id,c.name().strip(),url,c.format(),c.industry().strip(),c.region().strip(),c.enabled(),actor);}
  else if(db.update("UPDATE news_sources SET name=?,url=?,format=?,industry=?,region=?,enabled=?,revision=revision+1,changed_by=?,changed_at=now() WHERE id=? AND revision=?",c.name().strip(),url,c.format(),c.industry().strip(),c.region().strip(),c.enabled(),actor,id,c.revision())!=1)throw new IdentityException(409,"NEWS_SOURCE_CHANGED");
  int revision=db.queryForObject("SELECT revision FROM news_sources WHERE id=?",Integer.class,id);history(actor,null,id,"SOURCE_SAVED",revision);return rows(null).stream().filter(s->s.id().equals(id)).findFirst().orElseThrow();
 }
 @Transactional public List<Source> select(UUID actor,UUID tenant,UUID source,int revision,boolean enabled){
  identities.member(actor,tenant,true);var s=db.queryForList("SELECT revision,enabled FROM news_sources WHERE id=? FOR SHARE",source);if(s.isEmpty())throw new IdentityException(404,"NEWS_SOURCE_NOT_FOUND");if(!Objects.equals(s.getFirst().get("revision"),revision))throw new IdentityException(409,"NEWS_SOURCE_CHANGED");if(enabled&&!Boolean.TRUE.equals(s.getFirst().get("enabled")))throw new IdentityException(409,"NEWS_SOURCE_DISABLED");
  db.update("INSERT INTO tenant_news_sources(tenant_id,source_id,enabled,changed_by) VALUES(?,?,?,?) ON CONFLICT(tenant_id,source_id) DO UPDATE SET enabled=excluded.enabled,changed_by=excluded.changed_by,changed_at=now()",tenant,source,enabled,actor);history(actor,tenant,source,enabled?"SOURCE_SELECTED":"SOURCE_UNSELECTED",revision);return rows(tenant);
 }
 private void history(UUID actor,UUID tenant,UUID source,String action,int revision){db.update("INSERT INTO news_source_changes(id,source_id,tenant_id,actor_id,action,revision) VALUES(?,?,?,?,?,?)",UUID.randomUUID(),source,tenant,actor,action,revision);audit.record(actor,tenant,action,source,"SUCCESS");}
 public List<Source> selectedSources(UUID tenant){return rows(tenant).stream().filter(s->s.selected()&&s.enabled()).toList();}
 public Optional<Source> selected(UUID tenant){return selectedSources(tenant).stream().findFirst();}
 public String sourceFor(UUID tenant,UUID batch){var sources=selectedSources(tenant);return sources.isEmpty()?"":sources.get(Math.floorMod(batch.hashCode(),sources.size())).url();}
}
