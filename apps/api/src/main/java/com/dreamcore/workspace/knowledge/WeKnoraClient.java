package com.dreamcore.workspace.knowledge;

import java.net.URI;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.Flow;
import java.io.ByteArrayOutputStream;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Tencent WeKnora v0.8.3, 3e22822c1d2397be730c458c7539d0eb8c113a24.
 * Service credentials never cross the platform boundary; remote content is never a citation.
 */
@Component
public class WeKnoraClient {
    public static class Unavailable extends RuntimeException {
        public final String code;
        public Unavailable(String code){super(code);this.code=code;}
    }
    public record Document(String id,String status) {}
    private final boolean enabled;
    private final URI base;
    private final String key,rerank;
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).followRedirects(HttpClient.Redirect.NEVER).build();
    private final JsonMapper json=new JsonMapper();
    public WeKnoraClient(@Value("${dreamcore.weknora.enabled:false}") boolean enabled,
            @Value("${dreamcore.weknora.url:}") String url,@Value("${dreamcore.weknora.api-key:}") String key,
            @Value("${dreamcore.weknora.rerank-model:}") String rerank) {
        this.enabled=enabled;this.key=key;this.rerank=rerank;
        this.base=url.isBlank()?null:URI.create(url);
        if(enabled) {
            if(base==null || key.isBlank() || base.getHost()==null || base.getUserInfo()!=null || base.getQuery()!=null || base.getFragment()!=null
                    || !(base.getPath().isEmpty() || base.getPath().equals("/"))
                    || !(base.getScheme().equals("https") || (base.getScheme().equals("http") && Set.of("localhost","127.0.0.1","[::1]").contains(base.getHost()))))
                throw new IllegalArgumentException("WEKNORA_CONFIGURATION_INVALID");
            if(!rerank.isBlank()) id(rerank);
        }
    }
    public boolean enabled(){return enabled;}
    private static String id(String value){if(value==null || !value.matches("[A-Za-z0-9_-]{1,128}"))throw new Unavailable("WEKNORA_INVALID_RESPONSE");return value;}
    private JsonNode request(String method,String path,Object body,boolean absentOK) {
        if(!enabled)throw new Unavailable("WEKNORA_DISABLED");
        CompletableFuture<HttpResponse<byte[]>> future=null;
        try {
            var builder=HttpRequest.newBuilder(base.resolve(path)).timeout(Duration.ofSeconds(8))
                .header("X-API-Key",key).header("Accept","application/json").header("Content-Type","application/json");
            builder.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofByteArray(json.writeValueAsBytes(body)));
            future=http.sendAsync(builder.build(),info->new LimitedBody());
            var response=future.get(10,TimeUnit.SECONDS);
            if(absentOK && response.statusCode()==404)return json.readTree("{\"success\":true}");
            if(response.statusCode()<200 || response.statusCode()>299)throw new Unavailable("WEKNORA_UNAVAILABLE");
            var result=json.readTree(response.body());
            if(result==null || !result.path("success").asBoolean())throw new Unavailable("WEKNORA_INVALID_RESPONSE");
            return result;
        } catch(Exception e) {
            if(future!=null)future.cancel(true);
            if(e instanceof InterruptedException)Thread.currentThread().interrupt();
            if(e instanceof Unavailable u)throw u;
            throw new Unavailable("WEKNORA_UNAVAILABLE");
        }
    }
    public Document create(String kb,UUID localId,String text) {
        var data=request("POST","/api/v1/knowledge-bases/"+id(kb)+"/knowledge/manual",
            Map.of("title","mengine-"+localId,"content",text,"channel","mengine"),false).path("data");
        if(!kb.equals(data.path("knowledge_base_id").asText()))throw new Unavailable("WEKNORA_SCOPE_MISMATCH");
        return new Document(id(data.path("id").asText()),data.path("parse_status").asText());
    }
    public Document get(String kb,String remote) {
        var data=request("GET","/api/v1/knowledge/"+id(remote),null,true).path("data");
        if(data.isMissingNode())return null;
        if(!remote.equals(data.path("id").asText()) || !kb.equals(data.path("knowledge_base_id").asText()))throw new Unavailable("WEKNORA_SCOPE_MISMATCH");
        return new Document(remote,data.path("parse_status").asText());
    }
    public void delete(String remote){request("DELETE","/api/v1/knowledge/"+id(remote),null,true);}
    public List<String> search(String kb,List<String> allowed,String query,int limit) {
        if(allowed.isEmpty())return List.of();
        if(allowed.size()>1000 || limit<1 || limit>100)throw new Unavailable("WEKNORA_SCOPE_LIMIT");
        allowed.forEach(WeKnoraClient::id);
        var rank=new LinkedHashMap<String,Object>();rank.put("enabled",true);rank.put("top_k",limit);
        if(!rerank.isBlank())rank.put("model_id",rerank);
        var body=new LinkedHashMap<String,Object>();body.put("query_text",query);body.put("knowledge_ids",allowed);
        body.put("match_count",limit);body.put("disable_vector_match",false);body.put("disable_keywords_match",false);
        body.put("skip_context_enrichment",true);body.put("rerank",rank);
        // The path selects one KB; nonempty knowledge_ids restricts retrieval inside it.
        // Do not use a whole-KB target in the higher-level union-of-targets search API.
        var response=request("POST","/api/v1/knowledge-bases/"+id(kb)+"/hybrid-search?resource_urls=handle",body,false);
        var hits=response.path("data");if(!hits.isArray() || hits.size()>1000)throw new Unavailable("WEKNORA_INVALID_RESPONSE");
        if(!hits.isEmpty() && !response.path("meta").path("rerank").path("applied").asBoolean())throw new Unavailable("WEKNORA_RERANK_UNAVAILABLE");
        var allowedSet=new HashSet<>(allowed);var result=new LinkedHashSet<String>();
        for(var hit:hits){
            String remote=id(hit.path("knowledge_id").asText());String hitKb=hit.path("knowledge_base_id").asText("");
            if(!allowedSet.contains(remote) || (!hitKb.isEmpty() && !kb.equals(hitKb)))throw new Unavailable("WEKNORA_SCOPE_MISMATCH");
            result.add(remote);
        }
        return result.stream().limit(limit).toList();
    }
    private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final CompletableFuture<byte[]> body=new CompletableFuture<>();
        private final ByteArrayOutputStream bytes=new ByteArrayOutputStream();private Flow.Subscription subscription;
        public CompletionStage<byte[]> getBody(){return body;}
        public void onSubscribe(Flow.Subscription s){subscription=s;s.request(1);}
        public void onNext(List<ByteBuffer> buffers){
            for(var buffer:buffers){int n=buffer.remaining();if(bytes.size()+n>2_000_000){subscription.cancel();body.completeExceptionally(new Unavailable("WEKNORA_RESPONSE_LIMIT"));return;}
                byte[] part=new byte[n];buffer.get(part);bytes.writeBytes(part);}
            subscription.request(1);
        }
        public void onError(Throwable error){body.completeExceptionally(error);}
        public void onComplete(){body.complete(bytes.toByteArray());}
    }
}
