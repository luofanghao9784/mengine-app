package com.dreamcore.workspace.analysis.governed;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

/** Fixed, published relational recipes. Facts are aggregated independently; no model SQL. */
public final class FusionCalculator {
    public record Field(String source, String column) {}
    public record Join(String from, String to, List<String> fromKeys, List<String> toKeys) {}
    public record Dimension(String name, Field field) {}
    public record Predicate(Field field, String operator, String value) {}
    public record Metric(String id, String label, String unit, String base, String aggregation,
                         Field value, List<Join> joins, List<Dimension> dimensions, List<Predicate> filters) {}
    public record Plan(UUID tenant, UUID id, int version, List<Metric> metrics) {}
    public record Snapshot(UUID tenant, UUID dataset, UUID version, String sha256, Instant collectedAt,
                           Set<String> columns, List<Map<String,String>> rows) {}
    public record Group(List<String> dimensions, String value, int records) {}
    public record Result(String metricId, String label, String unit, List<String> dimensions,
                         List<Group> groups, int baseRecords, int includedRecords, Map<String,Integer> unmatched,
                         List<UUID> datasets) {}
    /** Implementations must recheck current tenant, source and row-scope grants; never trust model flags. */
    public interface Access { void require(UUID tenant, UUID actor, Snapshot snapshot); }
    public static final class Rejected extends RuntimeException {
        public final String code;
        public Rejected(String code) { super(code); this.code=code; }
    }
    private static void require(boolean ok,String code) { if(!ok)throw new Rejected(code); }
    private static boolean text(String s) { return s!=null&&!s.isBlank()&&s.length()<=160; }
    private static String key(Map<String,String> row,List<String> fields) {
        if(row==null)return null;
        var values=new ArrayList<String>();
        for(String f:fields){String v=row.get(f);if(v==null||v.isBlank())return null;values.add(v);}
        // Length-prefixing avoids delimiter collisions and preserves exact source identifiers.
        return values.stream().map(v->v.length()+":"+v).reduce("",String::concat);
    }
    private static String value(Map<String,Map<String,String>> row,Field f) {
        var source=row.get(f.source());return source==null?null:source.get(f.column());
    }
    private static BigDecimal decimal(String value) {
        require(value!=null&&value.matches("-?\\d{1,30}(?:\\.\\d{1,12})?"),"FUSION_NUMERIC_VALUE_INVALID");
        return new BigDecimal(value);
    }
    private static void field(Field f,Set<String> scope,Map<String,Snapshot> sources) {
        require(f!=null&&scope.contains(f.source())&&sources.get(f.source()).columns().contains(f.column()),"FUSION_FIELD_NOT_GRANTED");
    }
    private static Set<String> validate(Metric m,Map<String,Snapshot> sources) {
        require(m!=null&&text(m.id())&&text(m.label())&&text(m.unit())&&sources.containsKey(m.base()),"FUSION_METRIC_INVALID");
        require(Set.of("SUM","COUNT","COUNT_DISTINCT").contains(Objects.toString(m.aggregation(),"")),"FUSION_AGGREGATION_INVALID");
        require(m.joins()!=null&&m.joins().size()<=4&&m.dimensions()!=null&&m.dimensions().size()<=3&&m.filters()!=null&&m.filters().size()<=12,"FUSION_PLAN_LIMIT");
        var scope=new LinkedHashSet<String>();scope.add(m.base());
        for(var j:m.joins()){
            require(j!=null&&scope.contains(j.from())&&!scope.contains(j.to())&&sources.containsKey(j.to()),"FUSION_JOIN_PATH_INVALID");
            require(j.fromKeys()!=null&&j.toKeys()!=null&&!j.fromKeys().isEmpty()&&j.fromKeys().size()<=3&&j.fromKeys().size()==j.toKeys().size(),"FUSION_JOIN_KEYS_INVALID");
            require(new HashSet<>(j.fromKeys()).size()==j.fromKeys().size()&&new HashSet<>(j.toKeys()).size()==j.toKeys().size(),"FUSION_JOIN_KEYS_INVALID");
            require(sources.get(j.from()).columns().containsAll(j.fromKeys())&&sources.get(j.to()).columns().containsAll(j.toKeys()),"FUSION_FIELD_NOT_GRANTED");
            scope.add(j.to());
        }
        if(!m.aggregation().equals("COUNT")){
            field(m.value(),scope,sources);
            // Summing a dimension measure once per fact would inflate totals even in many-to-one joins.
            require(m.base().equals(m.value().source()),"FUSION_MEASURE_GRAIN_MISMATCH");
        }else require(m.value()==null,"FUSION_COUNT_VALUE_INVALID");
        var names=new HashSet<String>();
        for(var d:m.dimensions()){require(d!=null&&text(d.name())&&names.add(d.name()),"FUSION_DIMENSION_INVALID");field(d.field(),scope,sources);}
        for(var f:m.filters()){
            require(f!=null&&Set.of("EQ","NE","GE_DECIMAL","LE_DECIMAL","IS_NULL","NOT_NULL").contains(Objects.toString(f.operator(),"")),"FUSION_FILTER_INVALID");
            field(f.field(),scope,sources);
            if(!Set.of("IS_NULL","NOT_NULL").contains(f.operator()))require(f.value()!=null&&f.value().length()<=160,"FUSION_FILTER_INVALID");
            if(f.operator().endsWith("DECIMAL"))decimal(f.value());
        }
        return scope;
    }
    public List<Result> calculate(Plan plan,UUID actor,Map<String,Snapshot> sources,Access access) {
        require(plan!=null&&plan.tenant()!=null&&plan.id()!=null&&plan.version()>0&&actor!=null&&access!=null,"FUSION_PLAN_INVALID");
        require(sources!=null&&!sources.isEmpty()&&sources.size()<=12&&plan.metrics()!=null&&plan.metrics().size()>=2&&plan.metrics().size()<=6,"FUSION_PLAN_LIMIT");
        long rows=0;var datasetIds=new HashSet<UUID>();
        for(var e:sources.entrySet()){
            var s=e.getValue();require(text(e.getKey())&&s!=null&&plan.tenant().equals(s.tenant()),"FUSION_TENANT_MISMATCH");
            require(s.dataset()!=null&&s.version()!=null&&datasetIds.add(s.dataset())&&s.sha256()!=null&&s.sha256().matches("[a-f0-9]{64}")&&s.collectedAt()!=null,"FUSION_SNAPSHOT_INVALID");
            require(s.columns()!=null&&!s.columns().isEmpty()&&s.columns().size()<=100&&s.rows()!=null&&s.rows().size()<=100000,"FUSION_SOURCE_LIMIT");
            rows+=s.rows().size();require(rows<=300000,"FUSION_SOURCE_LIMIT");
            for(var row:s.rows())require(row!=null&&s.columns().containsAll(row.keySet()),"FUSION_ROW_INVALID");
            access.require(plan.tenant(),actor,s);
        }
        var ids=new HashSet<String>();var results=new ArrayList<Result>();
        for(var metric:plan.metrics()){
            var used=validate(metric,sources);require(ids.add(metric.id()),"FUSION_DUPLICATE_METRIC");
            results.add(compute(metric,sources,used));
        }
        // A revocation during computation invalidates the entire bundle; never return partial disclosures.
        for(var s:sources.values())access.require(plan.tenant(),actor,s);
        return List.copyOf(results);
    }
    private Result compute(Metric m,Map<String,Snapshot> sources,Set<String> used) {
        var indices=new HashMap<String,Map<String,Map<String,String>>>();
        for(var join:m.joins()){
            var index=new HashMap<String,Map<String,String>>();
            for(var row:sources.get(join.to()).rows()){
                String k=key(row,join.toKeys());if(k==null)continue;
                require(index.putIfAbsent(k,row)==null,"FUSION_JOIN_NOT_MANY_TO_ONE");
            }
            indices.put(join.to(),index);
        }
        class Aggregate { BigDecimal sum=BigDecimal.ZERO;int records;Set<String> distinct=new HashSet<>(); }
        var groups=new LinkedHashMap<List<String>,Aggregate>();var unmatched=new LinkedHashMap<String,Integer>();int included=0;
        for(var base:sources.get(m.base()).rows()){
            var row=new HashMap<String,Map<String,String>>();row.put(m.base(),base);
            for(var join:m.joins()){
                var k=key(row.get(join.from()),join.fromKeys());var match=k==null?null:indices.get(join.to()).get(k);
                row.put(join.to(),match);if(match==null)unmatched.merge(join.to(),1,Integer::sum);
            }
            boolean accepted=true;
            for(var f:m.filters()){
                String v=value(row,f.field());boolean missing=v==null||v.isBlank();
                boolean pass=switch(f.operator()){
                    case "EQ" -> !missing&&v.equals(f.value());
                    case "NE" -> !missing&&!v.equals(f.value());
                    case "GE_DECIMAL" -> !missing&&decimal(v).compareTo(decimal(f.value()))>=0;
                    case "LE_DECIMAL" -> !missing&&decimal(v).compareTo(decimal(f.value()))<=0;
                    case "IS_NULL" -> missing;
                    case "NOT_NULL" -> !missing;
                    default -> false;
                };if(!pass){accepted=false;break;}
            }
            if(!accepted)continue;
            var dimensions=new ArrayList<String>();
            for(var d:m.dimensions())dimensions.add(value(row,d.field()));
            // Null is retained as a separate unmatched group, never merged with a real label.
            var k=Collections.unmodifiableList(dimensions);var g=groups.computeIfAbsent(k,unused->new Aggregate());
            require(groups.size()<=50,"FUSION_GROUP_LIMIT");g.records++;included++;
            if(m.aggregation().equals("SUM"))g.sum=g.sum.add(decimal(value(row,m.value())));
            else if(m.aggregation().equals("COUNT"))g.sum=g.sum.add(BigDecimal.ONE);
            else {String v=value(row,m.value());if(v!=null&&!v.isBlank())g.distinct.add(v);}
        }
        var output=new ArrayList<Group>();for(var e:groups.entrySet()){
            var a=e.getValue();String v=m.aggregation().equals("COUNT_DISTINCT")?Integer.toString(a.distinct.size()):a.sum.toPlainString();
            output.add(new Group(e.getKey(),v,a.records));
        }
        return new Result(m.id(),m.label(),m.unit(),m.dimensions().stream().map(Dimension::name).toList(),List.copyOf(output),sources.get(m.base()).rows().size(),included,Map.copyOf(unmatched),used.stream().map(a->sources.get(a).dataset()).toList());
    }
}
