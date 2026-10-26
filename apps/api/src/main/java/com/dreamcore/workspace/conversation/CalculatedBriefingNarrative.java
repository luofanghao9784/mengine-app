package com.dreamcore.workspace.conversation;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;

/** Facts are rendered from the authorized calculation, never from a bag of allowed numbers. */
public final class CalculatedBriefingNarrative {
    public static final String VERSION = "calculation-facts-v1";
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.of("Asia/Shanghai"));
    private CalculatedBriefingNarrative() {}

    public static BriefingContentService.Request dataset(BriefingContentService.Request original,
            DatasetCalculationService.Source source, DatasetCalculationService.Calculation calculation,
            DatasetCalculationService.Summary summary, BriefingContentService.Chart chart) {
        var p = calculation.request();
        String scope;
        if (summary != null) {
            scope = p.dateColumn() == null ? "未按业务日期筛选，覆盖本次获准快照" :
                "按「" + shortLabel(p.dateColumn(),32) + "」筛选 " + Objects.toString(p.dateFrom(), "不限起日") + " 至 " + Objects.toString(p.dateTo(), "不限止日");
        } else {
            scope = "按「" + shortLabel(p.periodColumn(),32) + "」比较「" + shortLabel(p.baseline(),32) + "」与「" + shortLabel(p.current(),32) + "」" +
                ("MONTH".equals(p.periodMode()) ? "，月份按 " + Objects.toString(p.timeZone(), "Asia/Shanghai") + " 归属" : "");
        }
        if (p.equalsFilters() != null && !p.equalsFilters().isEmpty()) {
            String filters = String.join("、", new TreeMap<>(p.equalsFilters()).entrySet().stream().map(e -> "「" + e.getKey() + "」=「" + e.getValue() + "」").toList());
            scope += filters.length() <= 120 ? "；限定 " + filters : "；另应用 " + p.equalsFilters().size() + " 项固定条件，完整条件保留在计算凭据中";
        }
        scope += "。纳入 " + calculation.matchedRows() + " 条，未纳入 " + calculation.ignoredRows() + " 条，其中缺日期 " + calculation.missingDateRows() + " 条。";
        String freshness = "平台快照接收于 " + time(source.collectedAt()) + "；" +
            (source.coverageThrough() == null ? "业务覆盖截止日未声明" : "业务覆盖截至 " + time(source.coverageThrough())) + "。";
        String dimensions = "";
        if (summary != null && p.groupColumns() != null && !p.groupColumns().isEmpty()) {
            var parts = new ArrayList<String>();
            for (int i = 0; i < p.groupColumns().size(); i++) {
                int index = i;
                long cardinality = summary.rows().stream().map(r -> r.group().get(index)).distinct().count();
                parts.add("「" + shortLabel(p.groupColumns().get(i),24) + "」共 " + cardinality + " 个来源值");
            }
            dimensions = String.join("，", parts) + "；全部 " + summary.rows().size() + " 个分组均参与计算，未按名称排除分组。";
        }
        var rendered=render(original, chart, summary != null, scope, freshness, dimensions);
        if(p.dateFrom()!=null&&p.dateTo()!=null) {
            var from=java.time.LocalDate.parse(p.dateFrom());var through=java.time.LocalDate.parse(p.dateTo());
            if(from.getDayOfMonth()==1&&through.equals(from.withDayOfMonth(from.lengthOfMonth()))) {
                String title=java.time.YearMonth.from(from)+" · "+rendered.title();
                if(title.length()<=80)rendered=new BriefingContentService.Request(rendered.calculationArtifactId(),title,rendered.summary(),rendered.analysis(),rendered.businessType(),rendered.presentation());
            }
        }
        return rendered;
    }

    /** Each independently calculated scope remains a separate fact; never add monthly totals together. */
    public static BriefingContentService.Request combine(BriefingContentService.Request primary,List<BriefingContentService.Request> supporting) {
        if(supporting.isEmpty())return primary;
        var all=new ArrayList<BriefingContentService.Request>();all.add(primary);all.addAll(supporting);
        var paragraphs=new ArrayList<String>();
        for(var fact:all) {
            String paragraph=fact.title()+"。"+fact.analysis().get(2);
            String withExtremes=paragraph+fact.analysis().get(1);
            if(withExtremes.length()<=500)paragraph=withExtremes;
            if(paragraph.length()>500)throw new com.dreamcore.workspace.identity.IdentityException(413,"BRIEFING_CONTENT_LIMIT");
            paragraphs.add(paragraph);
        }
        if(paragraphs.size()==2)paragraphs.add("对照说明：各项登记值来自分别执行的固定统计范围；同一指标的不同月份保留为独立结果，不能自动相加为收入或推导变化率。");
        String boundary="各项统计独立保留其来源、期间、分组和单位，不相加，不据此推定逐行关联或两期变化率。"+primary.analysis().get(3);
        if(boundary.length()>500)throw new com.dreamcore.workspace.identity.IdentityException(413,"BRIEFING_CONTENT_LIMIT");
        paragraphs.add(boundary);
        String summary=String.join("；",all.stream().map(BriefingContentService.Request::title).toList())+"。各项独立计算，未合并金额。";
        if(summary.length()>240)summary=primary.summary()+"另有 "+supporting.size()+" 项独立统计，具体范围与数值逐项列于正文。";
        String title=primary.title()+" · 分项对照";
        if(title.length()>80)title=primary.title();
        return new BriefingContentService.Request(primary.calculationArtifactId(),title,summary,List.copyOf(paragraphs),primary.businessType(),primary.presentation());
    }

    public static BriefingContentService.Request table(BriefingContentService.Request original,
            BriefingContentService.Chart chart, String scope) {
        return render(original, chart, false, "本次获权表格范围：" + shortLabel(scope,240) + "。", "仅代表本次获权读取的文件或来源版本。", "");
    }

    public static BriefingContentService.Request chain(BriefingContentService.Request original,
            BriefingContentService.Chart chart, boolean pairedMetrics) {
        var result=render(original,chart,true,"本次核验的业务范围："+shortLabel(chart.range(),240)+"。","仅代表本次获权的来源版本及已发布对账口径。","");
        if(!pairedMetrics)return result;
        String facts="「"+chart.baseline()+"」合计 "+number(chart.totals().baseline(),chart.unit())+"；「"+chart.current()+"」合计 "+number(chart.totals().current(),chart.unit())+"。";
        var paragraphs=new ArrayList<>(result.analysis());
        paragraphs.set(0,facts+"这两项是不同业务口径，分别汇总后并列展示，未将它们当作前后两期计算增长率。合计相同不证明逐笔结算一致。");
        paragraphs.set(1,"以下排序仅针对「"+chart.current()+"」。"+result.analysis().get(1));
        String title=shortLabel(chart.baseline(),22)+"与"+shortLabel(chart.current(),22)+"：登记合计已核对";
        return new BriefingContentService.Request(result.calculationArtifactId(),title,facts,paragraphs,result.businessType(),result.presentation());
    }

    private static BriefingContentService.Request render(BriefingContentService.Request original,
            BriefingContentService.Chart chart, boolean summary, String scope, String freshness, String dimensions) {
        var total = chart.totals();
        String metric = chart.metric();
        String unit = chart.unit();
        String amount = number(total.current(), unit);
        String title = shortLabel(metric, 22) + (summary ? "合计 " : "本期合计 ") + amount;
        if (title.length() > 80) title = shortLabel(metric, 36) + "：完整计算已核对";
        String headline = summary ? "「" + shortLabel(metric,32) + "」合计 " + amount + "，完整计算覆盖 " + chart.rows().size() + " 个分组。" :
            "「" + shortLabel(chart.baseline(),24) + "」合计 " + number(total.baseline(), unit) + "；「" + shortLabel(chart.current(),24) + "」合计 " + amount + "。";
        String change = summary ? "合计保留来源正负号与单位，不通过展示顺序或抽样重算。" :
            total.difference() == null ? "分组覆盖或基期条件不满足比较要求，未给出合计变化结论。" :
            "两期登记值相差 " + number(total.difference(), unit) +
                (total.changePercent() == null ? "；基期不满足变化率计算条件。" : "，变化率 " + total.changePercent() + "%（按原计算精度）。");
        String highlight = extremes(chart.rows(), unit);
        String limits = "金额仅表示所选字段的登记值；未核验的银行到账、收入、利润或逾期本金不能由本图推定。";
        if ("记录数".equals(metric)) limits = "数量按已纳入记录计数；记录数不能替代金额、到账、利润或逾期率。";
        String last = freshness + limits + "业务建议：" + suggestedAction(original.analysis());
        List<String> paragraphs = List.of(headline + change, highlight, dimensions + scope, last);
        String overview=headline+change;
        if(overview.length()>240)overview="「"+shortLabel(metric,24)+"」本期登记合计 "+amount+"。比较范围与条件以完整计算凭据为准。";
        // Paragraph indices remain stable; chosen chart fields are still checked by PresentationPolicy.
        return new BriefingContentService.Request(original.calculationArtifactId(), title, overview,
            paragraphs, original.businessType(), original.presentation());
    }

    /** Retain a useful follow-up theme, never interpolate model text as an unverified fact. */
    public static String suggestedAction(List<String> paragraphs) {
        for(String p:paragraphs)if(p!=null&&p.startsWith("建议")&&p.length()<=180) {
            if(p.contains("逾期"))return "建议补齐到期与结清依据，再核对当前逾期情况。";
            if(p.contains("日期")||p.contains("期间")||p.contains("跨期"))return "建议核对账单日期与统计期间，避免跨期解释。";
            if(p.contains("状态")||p.contains("取消")||p.contains("冲销"))return "建议核对来源状态及取消、冲销记录，再判断是否需要业务处理。";
            if(p.contains("门店")||p.contains("店面"))return "建议逐店复核记录范围和原始账单，确认差异原因。";
            if(p.contains("对账")||p.contains("凭据")||p.contains("核对"))return "建议结合原始账单和相关业务凭据核对差异原因。";
        }
        return "建议结合原始账单和相关业务凭据核对差异原因。";
    }

    private static String extremes(List<BriefingContentService.Row> rows, String unit) {
        var present = rows.stream().filter(r -> r.current() != null).toList();
        if (present.isEmpty()) return "所选期间各分组均没有可用数值，不能形成数值排序。";
        BigDecimal max = present.stream().map(r -> new BigDecimal(r.current())).max(BigDecimal::compareTo).orElseThrow();
        BigDecimal min = present.stream().map(r -> new BigDecimal(r.current())).min(BigDecimal::compareTo).orElseThrow();
        var highest = present.stream().filter(r -> new BigDecimal(r.current()).compareTo(max) == 0).toList();
        var lowest = present.stream().filter(r -> new BigDecimal(r.current()).compareTo(min) == 0).toList();
        String maximum = "纳入分组的登记值最大为 " + number(highest.getFirst().current(), unit) + "，对应「" + shortLabel(highest.getFirst().group(),48) + "」" + (highest.size() > 1 ? "等 " + highest.size() + " 个并列分组" : "");
        String minimum = max.compareTo(min) == 0 ? "；所有有值分组的登记值相同" : "；最小为 " + number(lowest.getFirst().current(), unit) + "，对应「" + shortLabel(lowest.getFirst().group(),48) + "」" + (lowest.size() > 1 ? "等 " + lowest.size() + " 个并列分组" : "");
        String missing = present.size() == rows.size() ? "" : "；另有 " + (rows.size() - present.size()) + " 个分组缺少本期数值，未当作零参与排序";
        return maximum + minimum + missing + "。排序按有符号原值，不代表经营优劣。";
    }
    private static String number(String value, String unit) { return value == null ? "未核验" : value + " " + shortLabel(unit,16); }
    private static String shortLabel(String value, int limit) { return value.length() <= limit ? value : value.substring(0, limit) + "…"; }
    private static String time(String value) { try { return TIME.format(Instant.parse(value)); } catch (RuntimeException e) { return value; } }
}
