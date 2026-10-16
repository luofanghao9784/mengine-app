package com.dreamcore.workspace.analysis.governed;

import com.dreamcore.workspace.scene.MetricPlan;
import java.util.*;
import tools.jackson.databind.JsonNode;

/** Builds a bounded star from current governed relations, never from similarly named columns. */
public final class FusionPlanner {
    public record Source(String sourceId, UUID dataset, UUID snapshot, String name, String fingerprint,
                         Set<String> columns, int rows, JsonNode metadata, List<Published> metrics) {}
    public record Published(UUID id, int version, JsonNode definition) {}
    public record Binding(String alias, String sourceId, UUID dataset, UUID snapshot, String fingerprint,
                          String name, JsonNode scope) {}
    public record Measure(UUID id, int version, String sourceAlias, JsonNode definition) {}
    public record Relation(String from, String to, String id, String name, List<String> local,
                           List<String> foreign, String targetFingerprint) {}
    public record Recipe(String version, List<Binding> sources, List<Measure> measures,
                         List<Relation> relations, FusionCalculator.Plan calculation) {}

    private boolean usable(Published m) {
        var d=m.definition();var p=d.path("execution");
        // Initial compositional recipe preserves unfiltered published totals. Date predicates need
        // an explicit compatible recipe, rather than silently losing a metric's date restriction.
        return MetricPlan.ready(d)&&Set.of("SUM","COUNT").contains(d.path("aggregation").asText())
            &&p.path("groupColumns").isArray()&&p.path("groupColumns").isEmpty()
            &&p.path("dateColumn").asText().isEmpty()&&p.path("dateFrom").asText().isEmpty()
            &&p.path("dateTo").asText().isEmpty();
    }
    private List<String> keys(JsonNode r,String side){var out=new ArrayList<String>();for(var k:r.path("keys"))out.add(k.path(side).asText());return out;}
    private boolean relation(Source from,Source to,JsonNode r){
        var a=keys(r,"local");var b=keys(r,"foreign");
        return r.path("targetId").asText().equals(to.sourceId())
            &&!to.fingerprint().isBlank()&&(r.path("targetFingerprint").asText().equals(to.fingerprint())||(!to.metadata().path("dictionarySchemaFingerprint").asText().isBlank()&&r.path("targetFingerprint").asText().equals(to.metadata().path("dictionarySchemaFingerprint").asText())))
            &&r.path("id").isTextual()&&!r.path("id").asText().isBlank()
            &&r.path("evidence").isTextual()&&!r.path("evidence").asText().isBlank()
            &&!a.isEmpty()&&a.size()<=3&&new HashSet<>(a).size()==a.size()
            &&new HashSet<>(b).size()==b.size()&&from.columns().containsAll(a)&&to.columns().containsAll(b);
    }
    /** Caller supplies only ACL-checked sources and source-current, published metric versions. */
    public Optional<Recipe> choose(UUID tenant,Set<UUID> selected,List<Source> granted){
        if(selected.isEmpty()||selected.size()>3)return Optional.empty();
        Recipe best=null;long bestScore=Long.MIN_VALUE;
        var sources=granted.stream().sorted(Comparator.comparing(Source::sourceId)).toList();
        for(var dimension:sources){
            if(dimension.rows()<1||dimension.rows()>49)continue;
            var facts=new ArrayList<Source>();var relations=new ArrayList<JsonNode>();
            for(var fact:sources){
                if(fact.dataset().equals(dimension.dataset())||fact.rows()<1||fact.metrics().stream().noneMatch(this::usable))continue;
                var matches=new ArrayList<JsonNode>();
                for(var r:fact.metadata().path("dictionary").path("relations"))if(relation(fact,dimension,r))matches.add(r);
                // E.g. home store and teaching store are not interchangeable attribution roles.
                if(matches.size()==1){facts.add(fact);relations.add(matches.getFirst());}
            }
            for(int i=0;i<facts.size();i++)for(int j=i+1;j<facts.size();j++){
                var a=facts.get(i);var b=facts.get(j);var ids=Set.of(a.dataset(),b.dataset(),dimension.dataset());
                if(Collections.disjoint(ids,selected))continue;
                // Existing system selections are not removed; the combined scope remains bounded.
                var union=new HashSet<>(selected);union.addAll(ids);if(union.size()>3)continue;
                var ra=relations.get(i);var rb=relations.get(j);
                if(!keys(ra,"foreign").equals(keys(rb,"foreign")))continue;
                long score=List.of(a,b).stream().filter(f->f.metrics().stream().anyMatch(m->usable(m)&&"SUM".equals(m.definition().path("aggregation").asText()))).count()*1_000_000_000L
                    +(long)a.rows()+b.rows();
                if(score<=bestScore)continue;
                var chosen=List.of(a,b,dimension);var bindings=new ArrayList<Binding>();
                for(int n=0;n<chosen.size();n++){
                    var s=chosen.get(n);bindings.add(new Binding("s"+n,s.sourceId(),s.dataset(),s.snapshot(),s.fingerprint(),s.name(),s.metadata()));
                }
                var measures=new ArrayList<Measure>();var computations=new ArrayList<FusionCalculator.Metric>();var links=new ArrayList<Relation>();
                for(int n=0;n<2;n++){
                    var fact=chosen.get(n);var r=n==0?ra:rb;String alias="s"+n;
                    var metric=fact.metrics().stream().filter(this::usable)
                        .sorted(Comparator.comparingInt((Published x)->"SUM".equals(x.definition().path("aggregation").asText())?0:1).thenComparing(x->x.id().toString())).findFirst().orElseThrow();
                    var d=metric.definition();var local=keys(r,"local");var foreign=keys(r,"foreign");
                    var dimensions=new ArrayList<FusionCalculator.Dimension>();
                    for(String key:foreign)dimensions.add(new FusionCalculator.Dimension(key,new FusionCalculator.Field("s2",key)));
                    // Identifier grouping is deliberate: equal display names must never merge entities.
                    computations.add(new FusionCalculator.Metric(metric.id().toString(),d.path("name").asText(),d.path("unit").asText(),alias,d.path("aggregation").asText(),
                        "SUM".equals(d.path("aggregation").asText())?new FusionCalculator.Field(alias,d.path("valueField").asText()):null,
                        List.of(new FusionCalculator.Join(alias,"s2",local,foreign)),dimensions,List.of()));
                    measures.add(new Measure(metric.id(),metric.version(),alias,d));
                    links.add(new Relation(alias,"s2",r.path("id").asText(),r.path("name").asText(),local,foreign,dimension.fingerprint()));
                }
                bestScore=score;best=new Recipe("governed-star-v1",List.copyOf(bindings),List.copyOf(measures),List.copyOf(links),
                    new FusionCalculator.Plan(tenant,UUID.randomUUID(),1,List.copyOf(computations)));
            }
        }
        return Optional.ofNullable(best);
    }
}
