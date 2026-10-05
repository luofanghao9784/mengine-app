package com.dreamcore.workspace.news;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;
/** Only release-owned public phrases may leave the private task. Models select IDs, never transmit context. */
@Service
public class NewsSearchPolicy {
 public static final String QUERY="news:topic-search:v1";
 public record Topic(String id,String label,String query) {}
 public record Scope(String version,List<Topic> topics,List<String> sources) {}
 private final JdbcTemplate db;private final NewsSourceCatalog catalog;private final String provider;private final JsonMapper json=new JsonMapper();
 public NewsSearchPolicy(JdbcTemplate db,NewsSourceCatalog catalog,@Value("${dreamcore.tasks.news-search-provider:off}") String provider){if(!Set.of("off","bing-rss","searx").contains(provider))throw new IllegalArgumentException("Invalid news search provider");this.db=db;this.catalog=catalog;this.provider=provider;}
 public boolean enabled(){return !provider.equals("off");}
 public static List<Topic> topics(){return List.of(
  new Topic("FITNESS","健身与体育","健身 体育 政策"),new Topic("SPORTS_SAFETY","运动安全","体育 健身 运动安全 消费者权益"),
  new Topic("HEALTH","健康与医疗","健康 医疗 政策 行业动态"),new Topic("EDUCATION","教育培训","教育 培训 政策 行业动态"),
  new Topic("RETAIL","零售与消费","零售 消费 市场 行业动态"),new Topic("FOOD","餐饮与食品","餐饮 食品安全 政策 行业动态"),
  new Topic("TOURISM","旅游与酒店","旅游 酒店 政策 行业动态"),new Topic("TECHNOLOGY","科技与人工智能","人工智能 科技 行业动态"),
  new Topic("MANUFACTURING","制造业","制造业 工业 政策 行业动态"),new Topic("CONSTRUCTION","建筑与工程","建筑 工程 政策 行业动态"),
  new Topic("FINANCE","金融与财务","金融 财务 政策 行业动态"),new Topic("LOGISTICS","物流与供应链","物流 供应链 政策 行业动态"),
  new Topic("ENERGY","能源与环保","能源 环保 政策 行业动态"),new Topic("AGRICULTURE","农业","农业 政策 行业动态"),
  new Topic("EMPLOYMENT","劳动与人力资源","劳动 就业 人力资源 政策"),new Topic("BUSINESS","企业经营","企业经营 中小企业 政策 行业动态"));}
 public void pin(UUID task,UUID tenant){if(!enabled())throw new IdentityException(409,"NEWS_SEARCH_UNAVAILABLE");var sources=catalog.selectedSources(tenant).stream().map(NewsSourceCatalog.Source::url).limit(3).toList();db.update("INSERT INTO briefing_news_search_scope(task_id,tenant_id,provider,scope) VALUES(?,?,?,?::jsonb)",task,tenant,provider,json.writeValueAsString(new Scope("1.0",topics(),sources)));}
 public Scope scope(UUID task){var rows=db.queryForList("SELECT scope::text FROM briefing_news_search_scope WHERE task_id=?",String.class,task);return rows.isEmpty()?null:json.readValue(rows.getFirst(),Scope.class);}
 public void requireCurrent(UUID task,UUID tenant){var scope=scope(task);if(!enabled()||scope==null||!provider.equals(db.queryForObject("SELECT provider FROM briefing_news_search_scope WHERE task_id=?",String.class,task)))throw new IdentityException(403,"TASK_ACCESS_DENIED");var active=catalog.selectedSources(tenant).stream().map(NewsSourceCatalog.Source::url).toList();if(!active.containsAll(scope.sources()))throw new IdentityException(403,"TASK_ACCESS_DENIED");}
 public Topic select(UUID task,String id){
  var scope=scope(task);if(scope==null)throw new IdentityException(403,"TASK_ACCESS_DENIED");var topic=scope.topics().stream().filter(t->t.id().equals(id)).findFirst().orElseThrow(()->new IdentityException(422,"NEWS_TOPIC_NOT_GRANTED"));
  db.queryForList("SELECT task_id FROM briefing_news_search_scope WHERE task_id=? FOR UPDATE",task);
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_news_search_queries WHERE task_id=? AND topic_id=?)",Boolean.class,task,id))&&db.queryForObject("SELECT count(*) FROM briefing_news_search_queries WHERE task_id=?",Integer.class,task)>=2)throw new IdentityException(409,"NEWS_SEARCH_LIMIT");
  db.update("INSERT INTO briefing_news_search_queries(task_id,topic_id,query) VALUES(?,?,?) ON CONFLICT DO NOTHING",task,id,topic.query());return topic;
 }
}
