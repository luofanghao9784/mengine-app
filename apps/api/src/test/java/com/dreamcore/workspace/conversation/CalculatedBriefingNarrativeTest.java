package com.dreamcore.workspace.conversation;

import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CalculatedBriefingNarrativeTest {
    UUID dataset=UUID.randomUUID(), snapshot=UUID.randomUUID(), artifact=UUID.randomUUID();
    BriefingContentService.Request authored() {
        return new BriefingContentService.Request(artifact,"南店盈利999亿元，远高于总部","南店有999家店且收入高于总部，银行到账充足。",
            List.of("总部店只有一张账单，南店盈利远高于总部。","建议核对门店账单状态与原始业务凭据。"));
    }
    DatasetCalculationService.Source source(int count) {
        return new DatasetCalculationService.Source(dataset,snapshot,4,"合成财务账单","a".repeat(64),count,"2026-10-26T04:29:13Z",null);
    }
    BriefingContentService.Row row(String group,String value) {return new BriefingContentService.Row(group,null,value,null,null,null,null,null);}
    BriefingContentService.Request render(List<DatasetCalculationService.SummaryRow> rows,String total,String dateColumn,String from,String to) {
        int count=rows.stream().mapToInt(DatasetCalculationService.SummaryRow::records).sum();
        var p=new DatasetCalculationService.Request(dataset,snapshot,null,null,"应收付金额",null,null,null,"Asia/Shanghai","SUM","SUMMARY",List.of("店面","收付标记"),dateColumn,from,to,dateColumn==null?null:"FAIL");
        var sum=new DatasetCalculationService.Summary("dataset-summary-1","COMPUTED",p,"a".repeat(64),count,0,0,rows,total);
        var chartRows=rows.stream().map(r->row(String.join(" / ",r.group()),r.value())).toList();
        var totals=row(null,total);
        var calculation=new DatasetCalculationService.Calculation(sum.recipeVersion(),sum.status(),p,sum.inputSha256(),count,0,chartRows,totals,0);
        var chart=new BriefingContentService.Chart("GROUPED_BAR","应收付金额","人民币元","不适用","本次汇总","本次快照",chartRows,totals);
        return CalculatedBriefingNarrative.dataset(authored(),source(count),calculation,sum,chart);
    }
    @Test void exactReceiptFactsReplaceInventedTotalsAndSwappedGroupsWithoutFloatingPointOrWhitelist() {
        var result=render(List.of(new DatasetCalculationService.SummaryRow(List.of("总部店","收"),"9007199254740993.03",3),
            new DatasetCalculationService.SummaryRow(List.of("南店","付"),"-1.02",2)),"9007199254740992.01",null,null,null);
        assertEquals("应收付金额合计 9007199254740992.01 人民币元",result.title());
        String body=String.join("",result.analysis());
        assertTrue(body.contains("最大为 9007199254740993.03 人民币元，对应「总部店 / 收」"));
        assertTrue(body.contains("最小为 -1.02 人民币元，对应「南店 / 付」"));
        assertTrue(body.contains("「店面」共 2 个来源值"));
        assertFalse(body.contains("999"));assertFalse(body.contains("总部店只有"));
        assertTrue(body.contains("业务建议：建议核对来源状态及取消、冲销记录"));
        assertTrue(body.contains("业务覆盖截止日未声明"));assertTrue(body.contains("2026-10-26 12:29"));
    }
    @Test void allGroupsIncludingHeadquartersAndGroupsBeyondFirstPageParticipateInRanking() {
        var rows=new ArrayList<DatasetCalculationService.SummaryRow>();
        for(int i=0;i<11;i++)rows.add(new DatasetCalculationService.SummaryRow(List.of("店"+i,"收"),"1",1));
        rows.add(new DatasetCalculationService.SummaryRow(List.of("总部店","付"),"-20",1));
        var result=render(rows,"-9",null,null,null);String body=String.join("",result.analysis());
        assertTrue(body.contains("「店面」共 12 个来源值"));assertTrue(body.contains("全部 12 个分组"));
        assertTrue(body.contains("等 11 个并列分组"));assertTrue(body.contains("总部店 / 付"));
    }
    @Test void dueDateMonthScopeNeverBecomesPaymentMonthOrAnInventedBusinessCutoff() {
        var result=render(List.of(new DatasetCalculationService.SummaryRow(List.of("总部店","付"),"-12.00",1)),"-12.00","应收付日","2026-10-01","2026-10-31");
        String body=String.join("",result.analysis());
        assertTrue(body.contains("按「应收付日」筛选 2026-10-01 至 2026-10-31"));
        assertTrue(body.contains("业务覆盖截止日未声明"));assertTrue(body.contains("未核验的银行到账、收入、利润或逾期本金不能由本图推定"));
        assertFalse(body.contains("业务覆盖截至 2026-10-31"));assertFalse(body.contains("支付月"));
    }
    @Test void missingPeriodsAreNotZeroAndUnsupportedComparisonIsNotPublished() {
        var p=new DatasetCalculationService.Request(dataset,snapshot,"门店","期间","金额","前期","本期");
        var a=new BriefingContentService.Row("甲店",null,"12.00",null,null,null,1,"MISSING_PERIOD");
        var b=new BriefingContentService.Row("乙店","2.00",null,null,null,1,null,"MISSING_PERIOD");
        var totals=new BriefingContentService.Row(null,"2.00","12.00",null,null,null,null,"UNEQUAL_GROUP_COVERAGE");
        var calculation=new DatasetCalculationService.Calculation("dataset-compare-1","COMPUTED",p,"a".repeat(64),2,0,List.of(a,b),totals,0);
        var chart=new BriefingContentService.Chart("GROUPED_BAR","金额","元","前期","本期","全部快照",List.of(a,b),totals);
        var result=CalculatedBriefingNarrative.dataset(authored(),source(2),calculation,null,chart);
        String body=String.join("",result.analysis());assertTrue(body.contains("未给出合计变化结论"));assertTrue(body.contains("1 个分组缺少本期数值，未当作零"));assertFalse(body.contains("变化率"));
    }
    @Test void quantitativeSuggestionCannotSmuggleAnIncorrectValueOrRankBackIntoTheCard() {
        var original=new BriefingContentService.Request(artifact,"合成标题","合成摘要具备完整内容。",List.of("建议公布利润999元，南店排名最高。","建议报告总部只有两张账单。"));
        var chart=new BriefingContentService.Chart("GROUPED_BAR","登记金额","元","前期","本期","完整文件",List.of(row("甲店","20")),row(null,"20"));
        var result=CalculatedBriefingNarrative.table(original,chart,"获权文件行范围");
        assertFalse(String.join("",result.analysis()).contains("利润999"));assertFalse(String.join("",result.analysis()).contains("排名最高"));
        assertEquals(result,CalculatedBriefingNarrative.table(original,chart,"获权文件行范围"));
    }
    @Test void suggestionsCannotBypassFactBindingWithSpelledNumbersOrIncorrectLabels(){
        for(String attack:List.of("建议将甲店登记为twenty亿元，因为南店排名first。","建议核对甲店，甲店等于廿元且已到账。","建议公布负增长的损失。")) {
            String action=CalculatedBriefingNarrative.suggestedAction(List.of(attack));
            assertFalse(action.contains("twenty"));assertFalse(action.contains("廿"));assertFalse(action.contains("甲店"));assertFalse(action.contains("损失"));assertFalse(action.contains("已到账"));
        }
    }
    @Test void pairedReconciliationMetricsAreNotMisrepresentedAsTwoPeriods(){
        var values=new BriefingContentService.Row("甲店","100.00","20.00",null,null,null,null,null);
        var totals=new BriefingContentService.Row(null,"100.00","20.00",null,null,null,null,null);
        var chart=new BriefingContentService.Chart("GROUPED_BAR","订单销售与确认收款","元","订单销售额","确认收款","2026-10-01—2026-10-26",List.of(values),totals);
        var result=CalculatedBriefingNarrative.chain(authored(),chart,true);String body=String.join("",result.analysis());
        assertTrue(result.summary().contains("「订单销售额」合计 100.00 元"));assertTrue(result.summary().contains("「确认收款」合计 20.00 元"));
        assertTrue(body.contains("这两项是不同业务口径"));assertFalse(body.contains("分组覆盖或基期条件不满足"));assertTrue(body.contains("以下排序仅针对「确认收款」"));
    }
    @Test void renderedTextFitsTheReadingContractWithoutTruncatingPreciseNumbers(){
        String amount="9".repeat(35)+".123456789012";
        var one=new BriefingContentService.Row("甲".repeat(100),amount,amount,"0.000000000000","0.00",1,1,null);
        var totals=new BriefingContentService.Row(null,amount,amount,"0.000000000000","0.00",null,null,null);
        var chart=new BriefingContentService.Chart("GROUPED_BAR","长指标".repeat(33),"人民币元","前".repeat(100),"后".repeat(100),"A1:C2",List.of(one),totals);
        var result=CalculatedBriefingNarrative.table(authored(),chart,"A1:C2");
        assertTrue(result.title().length()<=80);assertTrue(result.summary().length()<=240);
        assertTrue(result.analysis().stream().allMatch(p->p.length()>=12&&p.length()<=500));
        assertTrue(String.join("",result.analysis()).contains(amount));
    }
}
