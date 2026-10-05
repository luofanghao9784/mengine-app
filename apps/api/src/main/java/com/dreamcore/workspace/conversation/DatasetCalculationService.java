package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import java.math.*;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/** Fixed decimal recipe over the whole pinned snapshot, never over a model-provided sample. */
@Service
public class DatasetCalculationService {
    public record Request(UUID datasetId, UUID snapshotId, String groupColumn, String periodColumn,
                          String valueColumn, String baseline, String current, String periodMode, String timeZone) {
        public Request(UUID datasetId,UUID snapshotId,String groupColumn,String periodColumn,String valueColumn,String baseline,String current){this(datasetId,snapshotId,groupColumn,periodColumn,valueColumn,baseline,current,null,null);}
    }
    public record Source(UUID datasetId, UUID snapshotId, int version, String name, String sha256,
                         int rowCount, String collectedAt, String coverageThrough) {}
    public record Calculation(String recipeVersion, String status, Request request, String inputSha256,
                              int matchedRows, int ignoredRows, List<BriefingContentService.Row> rows,
                              BriefingContentService.Row totals) {}
    private final JdbcTemplate db;
    private final MaterialAccess access;
    private final IdentityAudit audit;
    private final JsonMapper json = new JsonMapper();
    public DatasetCalculationService(JdbcTemplate db, MaterialAccess access, IdentityAudit audit) {
        this.db = db; this.access = access; this.audit = audit;
    }
    private void invalid(String code) { throw new IdentityException(422, code); }
    private String label(String value) {
        if (value == null || value.isBlank() || value.length() > 100 || value.codePoints().anyMatch(Character::isISOControl)) invalid("DATASET_LABEL_INVALID");
        return value;
    }
    private String decimal(BigDecimal value) { return value == null ? null : value.toPlainString(); }
    private BriefingContentService.Row row(String group, BigDecimal before, BigDecimal after, Integer beforeRank, Integer afterRank) {
        var difference = before == null || after == null ? null : after.subtract(before);
        var percent = difference != null && before.signum() > 0 ? difference.multiply(BigDecimal.valueOf(100)).divide(before, 2, RoundingMode.HALF_UP) : null;
        return new BriefingContentService.Row(group, decimal(before), decimal(after), decimal(difference), decimal(percent), beforeRank, afterRank,
            difference == null ? "MISSING_PERIOD" : before.signum() <= 0 ? "NON_POSITIVE_BASELINE" : null);
    }
    private Map<String,Integer> ranks(Map<String,BigDecimal[]> groups, int period) {
        var sorted = groups.entrySet().stream().filter(e -> e.getValue()[period] != null)
            .sorted(Comparator.<Map.Entry<String,BigDecimal[]>,BigDecimal>comparing(e -> e.getValue()[period]).reversed().thenComparing(Map.Entry::getKey)).toList();
        var ranks = new HashMap<String,Integer>(); BigDecimal previous = null; int rank = 0;
        for (int i = 0; i < sorted.size(); i++) { var e = sorted.get(i); if (previous == null || previous.compareTo(e.getValue()[period]) != 0) rank = i + 1; ranks.put(e.getKey(),rank); previous = e.getValue()[period]; }
        return ranks;
    }
    private String period(String raw,String mode,java.time.ZoneId zone){
        if(mode.equals("EXACT"))return label(raw);
        if(raw==null||raw.isBlank())invalid("DATASET_DATE_REQUIRED");
        try{
            java.time.LocalDate day;
            if(raw.matches("\\d{4}-\\d{2}-\\d{2}"))day=java.time.LocalDate.parse(raw);
            else {try{day=java.time.OffsetDateTime.parse(raw).atZoneSameInstant(zone).toLocalDate();}catch(java.time.format.DateTimeParseException ex){day=java.time.LocalDateTime.parse(raw).toLocalDate();}}
            return java.time.YearMonth.from(day).toString();
        }catch(java.time.DateTimeException ex){invalid("DATASET_DATE_INVALID");return null;}
    }
    public Map<String,Object> calculate(ConversationService.Job job, Request request) {
        if (request == null || request.datasetId() == null || request.snapshotId() == null) throw IdentityException.invalid();
        label(request.baseline()); label(request.current());
        String mode=request.periodMode()==null?"EXACT":request.periodMode();if(!Set.of("EXACT","MONTH").contains(mode))invalid("DATASET_PERIOD_MODE_INVALID");
        java.time.ZoneId zone;try{zone=java.time.ZoneId.of(request.timeZone()==null?"Asia/Shanghai":request.timeZone());}catch(java.time.DateTimeException ex){invalid("DATASET_TIMEZONE_INVALID");return null;}
        if(mode.equals("MONTH")){try{if(!java.time.YearMonth.parse(request.baseline()).toString().equals(request.baseline())||!java.time.YearMonth.parse(request.current()).toString().equals(request.current()))invalid("DATASET_MONTH_INVALID");}catch(java.time.DateTimeException ex){invalid("DATASET_MONTH_INVALID");}}
        if (request.baseline().equals(request.current())) throw IdentityException.invalid();
        var sources = db.queryForList("""
            SELECT d.workspace_id,d.name,d.column_names,s.*,t.attempt FROM conversation_tasks t
            JOIN task_dataset_reads pin ON pin.task_id=t.id AND pin.attempt_number=t.attempt
            JOIN dataset_snapshots s ON s.id=pin.snapshot_id AND s.dataset_id=pin.dataset_id
            JOIN business_datasets d ON d.id=s.dataset_id AND d.tenant_id=t.tenant_id
            WHERE t.id=? AND t.lease_token=? AND (t.source_scope<>'SELECTED' OR EXISTS(SELECT 1 FROM briefing_dataset_selections chosen WHERE chosen.task_id=t.id AND chosen.dataset_id=d.id AND chosen.snapshot_id=s.id AND NOT chosen.invalidated)) AND d.id=? AND s.id=?
              AND d.status='ACTIVE' AND NOT d.scrubbed AND NOT s.scrubbed
            """,job.id(),job.token(),request.datasetId(),request.snapshotId());
        if (sources.size()!=1) throw new IdentityException(403,"DATASET_CALCULATION_NOT_GRANTED");
        var source = sources.getFirst(); access.require(job.actor(),job.tenant(),(UUID)source.get("workspace_id"),false);
        String columnsText=source.get("column_names").toString(),rowsText=source.get("data_rows").toString();
        List<String> columns=json.readValue(columnsText,json.getTypeFactory().constructCollectionType(List.class,String.class));
        var requested=Arrays.asList(request.groupColumn(),request.periodColumn(),request.valueColumn());
        if (requested.stream().anyMatch(c -> c == null || !columns.contains(c)) || new HashSet<>(requested).size()!=3) invalid("DATASET_COLUMNS_INVALID");
        int groupIndex=columns.indexOf(request.groupColumn()),periodIndex=columns.indexOf(request.periodColumn()),valueIndex=columns.indexOf(request.valueColumn());
        var data=json.readTree(rowsText); int count=((Number)source.get("row_count")).intValue();
        if (!data.isArray() || data.size()!=count || count>100000) invalid("DATASET_SHAPE_INVALID");
        var groups=new TreeMap<String,BigDecimal[]>();int matched=0,ignored=0;
        for (var record:data) {
            if (!record.isArray() || record.size()!=columns.size()) invalid("DATASET_SHAPE_INVALID");
            var periodCell=record.get(periodIndex);if(!periodCell.isString())invalid("DATASET_LABEL_INVALID");String period=period(periodCell.asString(),mode,zone);
            if (!period.equals(request.baseline()) && !period.equals(request.current())) { ignored++; continue; }
            var groupCell=record.get(groupIndex);if(!groupCell.isString())invalid("DATASET_LABEL_INVALID");String group=label(groupCell.asString());
            var cell=record.get(valueIndex);if(!cell.isString() || !cell.asString().matches("-?[0-9]{1,30}(?:\\.[0-9]{1,12})?(?:[Ee][+-]?[0-9]{1,2})?"))invalid("DATASET_NUMBER_INVALID");
            var number=new BigDecimal(cell.asString());if(number.abs().compareTo(BigDecimal.TEN.pow(30))>=0 || number.scale()>12)invalid("DATASET_NUMBER_LIMIT");
            int p=period.equals(request.baseline())?0:1;var values=groups.computeIfAbsent(group,k->new BigDecimal[2]);values[p]=values[p]==null?number:values[p].add(number);matched++;
            if(groups.size()>50)invalid("DATASET_GROUP_LIMIT");
        }
        if(groups.isEmpty() || groups.values().stream().noneMatch(v->v[0]!=null) || groups.values().stream().noneMatch(v->v[1]!=null))invalid("DATASET_NO_COMPARABLE_DATA");
        var beforeRanks=ranks(groups,0);var afterRanks=ranks(groups,1);var output=new ArrayList<BriefingContentService.Row>();BigDecimal before=BigDecimal.ZERO,after=BigDecimal.ZERO;boolean complete=true;
        for(var e:groups.entrySet()) {var values=e.getValue();output.add(row(e.getKey(),values[0],values[1],beforeRanks.get(e.getKey()),afterRanks.get(e.getKey())));if(values[0]!=null)before=before.add(values[0]);if(values[1]!=null)after=after.add(values[1]);complete &= values[0]!=null && values[1]!=null;}
        var total=row(null,before,after,null,null);
        if(!complete)total=new BriefingContentService.Row(null,total.baseline(),total.current(),null,null,null,null,"UNEQUAL_GROUP_COVERAGE");
        String inputHash=IdentityService.hash(columnsText+"\n"+rowsText);
        var metadata=new Source(request.datasetId(),request.snapshotId(),((Number)source.get("version")).intValue(),(String)source.get("name"),inputHash,count,
            ((Timestamp)source.get("collected_at")).toInstant().toString(),source.get("coverage_through")==null?null:((Timestamp)source.get("coverage_through")).toInstant().toString());
        var calculation=new Calculation(mode.equals("MONTH")?"dataset-compare-month-1":"dataset-compare-1","COMPUTED",request,inputHash,matched,ignored,List.copyOf(output),total);
        byte[] body=json.writeValueAsBytes(Map.of("datasetSource",metadata,"calculation",calculation));String sha=hash(body),filename="dataset-comparison-"+sha.substring(0,20)+".json";
        var existing=db.queryForList("SELECT id FROM conversation_artifacts WHERE task_id=? AND attempt_number=? AND filename=? AND sha256=? AND object_is_active('ARTIFACT',id)",UUID.class,job.id(),source.get("attempt"),filename,sha);UUID artifact;
        if(existing.isEmpty()) {
            var size=db.queryForMap("SELECT count(*) n,coalesce(sum(octet_length(content)),0) bytes FROM conversation_artifacts WHERE task_id=? AND attempt_number=?",job.id(),source.get("attempt"));
            if(((Number)size.get("n")).intValue()>=8 || ((Number)size.get("bytes")).longValue()+body.length>65536)throw new IdentityException(413,"DATASET_RESULT_LIMIT");
            artifact=UUID.randomUUID();db.update("INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content,attempt_number) VALUES (?,?,?,?,?,?,?,?)",artifact,job.tenant(),job.space(),job.id(),filename,sha,body,source.get("attempt"));
            audit.record(job.actor(),job.tenant(),"TASK_DATASET_COMPUTED",artifact,"SUCCESS");
        } else artifact=existing.getFirst();
        return Map.of("contractVersion","1.0","status","COMPUTED","datasetSource",metadata,"calculation",calculation,"artifact",Map.of("id",artifact,"filename",filename,"sha256",sha,"bytes",body.length));
    }
    private String hash(byte[] value) { return IdentityService.hash(new String(value,StandardCharsets.UTF_8)); }
}
