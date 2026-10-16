package com.dreamcore.workspace.analysis.governed;

import com.dreamcore.workspace.scene.MetricPlan;
import java.util.*;
import tools.jackson.databind.JsonNode;

/** Builds a relation graph from governed paths, never from similarly named columns. */
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
    private record Edge(Source from,Source to,JsonNode relation) {}
    /** A unique shortest registered path gives an explicit attribution; equal alternatives are ambiguous. */
    private Map<String,List<Edge>> paths(Source anchor,List<Source> sources,List<Edge> edges){
        var distance=new HashMap<String,Integer>();distance.put(anchor.sourceId(),0);
        boolean changed=true;while(changed){changed=false;for(var e:edges){var d=distance.get(e.to().sourceId());if(d!=null&&(distance.getOrDefault(e.from().sourceId(),Integer.MAX_VALUE)>d+1)){distance.put(e.from().sourceId(),d+1);changed=true;}}}
        var found=new HashMap<String,List<Edge>>();found.put(anchor.sourceId(),List.of());
        for(int depth=1;depth<=sources.size();depth++)for(var source:sources){
            if(!Objects.equals(distance.get(source.sourceId()),depth))continue;
            var options=edges.stream().filter(e->e.from().sourceId().equals(source.sourceId())&&Objects.equals(distance.get(e.to().sourceId()),distance.get(source.sourceId())-1)).toList();
            if(options.size()!=1||!found.containsKey(options.getFirst().to().sourceId()))continue;
            var path=new ArrayList<Edge>();path.add(options.getFirst());path.addAll(found.get(options.getFirst().to().sourceId()));found.put(source.sourceId(),List.copyOf(path));
        }
        return found;
    }
    /** Automatic briefings choose a theme from the authorized graph, even if the legacy selector chose an isolated view. */
    public Optional<Recipe> chooseAutomatic(UUID tenant,Set<UUID> selected,List<Source> granted){
        var preferred=choose(tenant,selected,granted);
        if(preferred.isPresent())return preferred;
        var all=new HashSet<UUID>();granted.forEach(s->all.add(s.dataset()));
        return choose(tenant,all,granted);
    }
    /** The relation graph determines the table/metric count; delivery pages are budgeted downstream. */
    public Optional<Recipe> choose(UUID tenant,Set<UUID> selected,List<Source> granted){
        if(selected.isEmpty())return Optional.empty();
        Recipe best=null;long bestScore=Long.MIN_VALUE;
        var sources=granted.stream().filter(s->s.rows()>0).sorted(Comparator.comparing(Source::sourceId)).toList();
        var edges=new ArrayList<Edge>();
        for(var source:sources)for(var target:sources)if(!source.dataset().equals(target.dataset()))
            for(var r:source.metadata().path("dictionary").path("relations"))if(relation(source,target,r))edges.add(new Edge(source,target,r));
        for(var anchor:sources){
            var paths=paths(anchor,sources,edges);
            var facts=sources.stream().filter(f->paths.containsKey(f.sourceId())&&f.metrics().stream().anyMatch(this::usable)).toList();
            if(facts.size()<2)continue;
            var used=new LinkedHashSet<Source>();
            for(var f:facts){used.add(f);for(var e:paths.get(f.sourceId())){used.add(e.from());used.add(e.to());}}
            if(used.stream().noneMatch(s->selected.contains(s.dataset())))continue;
            var withPath=facts.stream().filter(f->!paths.get(f.sourceId()).isEmpty()).toList();if(withPath.isEmpty())continue;
            var common=keys(paths.get(withPath.getFirst().sourceId()).getLast().relation(),"foreign");
            facts=facts.stream().filter(f->paths.get(f.sourceId()).isEmpty()||keys(paths.get(f.sourceId()).getLast().relation(),"foreign").equals(common)).toList();
            if(facts.size()<2)continue;
            used.clear();for(var f:facts){used.add(f);for(var e:paths.get(f.sourceId())){used.add(e.from());used.add(e.to());}}
            var bindings=new ArrayList<Binding>();var aliases=new HashMap<String,String>();
            for(var source:used){String alias="s"+bindings.size();aliases.put(source.sourceId(),alias);bindings.add(new Binding(alias,source.sourceId(),source.dataset(),source.snapshot(),source.fingerprint(),source.name(),source.metadata()));}
            var measures=new ArrayList<Measure>();var computations=new ArrayList<FusionCalculator.Metric>();var links=new LinkedHashMap<String,Relation>();
            for(var fact:facts){
                String alias=aliases.get(fact.sourceId());var joins=new ArrayList<FusionCalculator.Join>();
                for(var edge:paths.get(fact.sourceId())){
                    var r=edge.relation();String from=aliases.get(edge.from().sourceId()),to=aliases.get(edge.to().sourceId());
                    joins.add(new FusionCalculator.Join(from,to,keys(r,"local"),keys(r,"foreign")));
                    links.put(from+":"+r.path("id").asText(),new Relation(from,to,r.path("id").asText(),r.path("name").asText(),keys(r,"local"),keys(r,"foreign"),r.path("targetFingerprint").asText()));
                }
                for(var metric:fact.metrics().stream().filter(this::usable).sorted(Comparator.comparingInt((Published x)->"SUM".equals(x.definition().path("aggregation").asText())?0:1).thenComparing(x->x.id().toString())).toList()){
                    var d=metric.definition();var dimensions=common.stream().map(k->new FusionCalculator.Dimension(k,new FusionCalculator.Field(aliases.get(anchor.sourceId()),k))).toList();
                    computations.add(new FusionCalculator.Metric(metric.id().toString(),d.path("name").asText(),d.path("unit").asText(),alias,d.path("aggregation").asText(),"SUM".equals(d.path("aggregation").asText())?new FusionCalculator.Field(alias,d.path("valueField").asText()):null,List.copyOf(joins),dimensions,List.of()));
                    measures.add(new Measure(metric.id(),metric.version(),alias,d));
                }
            }
            // Prefer the widest valid business graph; fewer hops reduce ambiguous attribution.
            long score=(long)facts.size()*1_000_000L+measures.size()*1000L-links.size();
            if(score>bestScore){bestScore=score;best=new Recipe("governed-graph-v1",List.copyOf(bindings),List.copyOf(measures),List.copyOf(links.values()),new FusionCalculator.Plan(tenant,UUID.randomUUID(),1,List.copyOf(computations)));}
        }
        return Optional.ofNullable(best);
    }
}
