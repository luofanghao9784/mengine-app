package com.dreamcore.workspace.collection;

import com.dreamcore.workspace.governance.DeclaredValueChecks;
import java.util.*;
import tools.jackson.databind.json.JsonMapper;

/** Recomputed independently after transport approval; the collector cannot certify itself. */
public final class SourceBusinessPreflight {
    private SourceBusinessPreflight() {}
    @SuppressWarnings("unchecked")
    public static String check(CollectionAdapter.Snapshot snapshot,List<String> columns) {
        if(snapshot.sourceContract()==null) return "WAITING_SOURCE_DEFINITION";
        try {
            var body=new JsonMapper().readValue(snapshot.sourceContract().definitionJson(),Map.class);
            var entries=(List<Map<String,Object>>)body.get("entries");
            var schema=(List<Map<String,Object>>)body.get("schema");
            var known=new HashSet<String>();
            for(var e:entries) if("BUSINESS_DEFINITION".equals(e.get("definitionScope"))
                    && e.get("sourceMetadata") instanceof Map<?,?> m && m.get("definition") instanceof String definition && !definition.isBlank()) known.add((String)e.get("column"));
            var covered=new HashSet<String>();
            for(var r:schema) if("value-rule".equals(r.get("kind"))) covered.add((String)r.get("column"));
            if(!known.equals(new HashSet<>(columns)) || !covered.equals(new HashSet<>(columns))) return "WAITING_SOURCE_DEFINITION";
            if(schema.stream().anyMatch(r -> !Set.of("column","value-rule","analysis-plan","business-metric-scope").contains(r.getOrDefault("kind","")))) return "WAITING_SOURCE_DEFINITION";
            SourceContractPublicationService.fields(snapshot.sourceContract(),columns);
            for(var rule:schema) if("column".equals(rule.get("kind"))) {
                if(!columns.contains(rule.get("name"))) return "WAITING_SOURCE_DEFINITION";
                if("NO".equals(rule.get("nullable"))) for(var row:snapshot.rows())
                    if(row.get(columns.indexOf(rule.get("name")))==null) return "SOURCE_DATA_REQUIRES_REVIEW";
            }
            var checked=DeclaredValueChecks.check(columns,snapshot.rows(),schema);
            if(!"CHECKED".equals(checked.get("state"))) return "SOURCE_DATA_REQUIRES_REVIEW";
            var keys=schema.stream().filter(r -> "column".equals(r.get("kind")) && "PRI".equals(r.get("key"))).map(r -> (String)r.get("name")).toList();
            if(!keys.isEmpty()) {
                if(!columns.containsAll(keys)) return "WAITING_SOURCE_DEFINITION";
                Set<List<String>> seen=new HashSet<>();
                for(var row:snapshot.rows()) {
                    var key=keys.stream().map(k -> row.get(columns.indexOf(k))).toList();
                    if(key.stream().anyMatch(v -> v==null || v.isBlank()) || !seen.add(key)) return "SOURCE_DATA_REQUIRES_REVIEW";
                }
            }
            return "READY";
        } catch(RuntimeException invalid) { return "WAITING_SOURCE_DEFINITION"; }
    }
}
