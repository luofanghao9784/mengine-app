package com.dreamcore.workspace.knowledge;

import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class WeKnoraRetrieval {
    private final JdbcTemplate db;private final WeKnoraClient client;
    public WeKnoraRetrieval(JdbcTemplate db,WeKnoraClient client){this.db=db;this.client=client;}
    public boolean enabled(){return client.enabled();}
    public boolean enabled(UUID tenant){return enabled() && Boolean.TRUE.equals(db.queryForObject(
        "SELECT EXISTS(SELECT 1 FROM knowledge_index_targets WHERE tenant_id=? AND enabled)",Boolean.class,tenant));}
    /** scopeSql/args are built only by KnowledgeService's existing authorization/version gate. */
    public List<UUID> search(String scopeSql,List<Object> args,String query,int count) {
        var rows=db.queryForList("WITH scoped AS MATERIALIZED ("+scopeSql+") "+"""
            SELECT c.id,i.remote_id,i.state,i.knowledge_base_id,t.enabled
            FROM scoped s JOIN knowledge_chunks c ON c.run_id=s.run_id AND c.version_id=s.id
                AND c.tenant_id=s.tenant_id AND c.workspace_id=s.workspace_id
            LEFT JOIN knowledge_remote_index i ON i.chunk_id=c.id AND i.tenant_id=c.tenant_id
            LEFT JOIN knowledge_index_targets t ON t.tenant_id=c.tenant_id AND t.knowledge_base_id=i.knowledge_base_id
            WHERE s.parse_status IN ('READY','PARTIAL') ORDER BY c.id LIMIT 1001
            """,args.toArray());
        if(rows.isEmpty())return List.of(); // An empty authorized set never contacts WeKnora.
        if(rows.size()>1000 || count>100)throw new IdentityException(503,"KNOWLEDGE_SEARCH_SCOPE_LIMIT");
        var mapped=new LinkedHashMap<String,UUID>();String kb=null;
        for(var row:rows){
            if(!"READY".equals(row.get("state")) || !Boolean.TRUE.equals(row.get("enabled")) || row.get("remote_id")==null)
                throw new IdentityException(503,"KNOWLEDGE_INDEX_NOT_READY");
            String current=(String)row.get("knowledge_base_id");
            if(kb!=null && !kb.equals(current))throw new IdentityException(503,"KNOWLEDGE_INDEX_NOT_READY");
            kb=current;mapped.put((String)row.get("remote_id"),(UUID)row.get("id"));
        }
        try{return client.search(kb,new ArrayList<>(mapped.keySet()),query,count).stream().map(mapped::get).toList();}
        catch(WeKnoraClient.Unavailable e){throw new IdentityException(503,e.code);}
    }
}
