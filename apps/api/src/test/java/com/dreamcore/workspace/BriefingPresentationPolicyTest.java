package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class BriefingPresentationPolicyTest {
    final List<String> prose=List.of("第一段有依据的业务分析完整保留。","第二段有依据的业务建议完整保留。");
    final BriefingContentService.Row gap=new BriefingContentService.Row("甲",null,"309100",null,null,null,1,"MISSING_PERIOD");
    final BriefingContentService.Chart chart=new BriefingContentService.Chart("GROUPED_BAR","收款","分","四月","五月","合成范围",List.of(gap),gap);
    BriefingPresentationPolicy.Presentation p(String layout,String style,String group,String value,List<BriefingPresentationPolicy.Section> sections){return new BriefingPresentationPolicy.Presentation("briefing-presentation-v1",layout,style,group,value,sections);}
    BriefingContentService.Request request(String type,BriefingPresentationPolicy.Presentation p){return new BriefingContentService.Request(null,"有依据的业务发现","具体结论保持真实且完整，不改变业务口径。",prose,type,p);}
    @Test void everyDataPresentationUsesTheSameVerifiedValuesIncludingGaps(){
        for(String style:List.of("GROUPED_BAR","DUMBBELL","DELTA_BAR","CURRENT_BAR","TABLE")){
            var p=p("KEY_METRIC",style,"甲","DIFFERENCE",List.of());
            assertEquals(p,BriefingPresentationPolicy.resolve(request("DATA",p),"DATA",chart));
            assertNull(chart.rows().getFirst().difference());assertEquals("309100",chart.rows().getFirst().current());
        }
    }
    @Test void unknownChartsUnverifiedFocusAndTextAsDataAreRejected(){
        for(var p:List.of(p("EDITORIAL","PIE",null,null,List.of()),p("KEY_METRIC","DUMBBELL","未获权分组","CURRENT",List.of()),p("KEY_METRIC","TABLE",null,"CUSTOM_NUMBER",List.of()),p("STEPS","TABLE",null,null,List.of())))
            assertThrows(IdentityException.class,()->BriefingPresentationPolicy.resolve(request("DATA",p),"DATA",chart));
        assertThrows(IdentityException.class,()->BriefingPresentationPolicy.resolve(request("INSIGHT",p("KEY_METRIC",null,null,null,List.of())),"INSIGHT",null));
        assertThrows(IdentityException.class,()->BriefingPresentationPolicy.resolve(request("INSIGHT",p("EDITORIAL","TABLE",null,null,List.of())),"INSIGHT",null));
    }
    @Test void sectionsReferenceExistingParagraphsAndRespectBusinessMeaning(){
        var steps=p("STEPS",null,null,null,List.of(new BriefingPresentationPolicy.Section("ACTION",0),new BriefingPresentationPolicy.Section("CAUTION",1)));
        assertEquals(steps,BriefingPresentationPolicy.resolve(request("SUGGESTION",steps),"SUGGESTION",null));
        assertThrows(IdentityException.class,()->BriefingPresentationPolicy.resolve(request("INSIGHT",steps),"INSIGHT",null));
        for(var sections:List.of(List.of(new BriefingPresentationPolicy.Section("ACTION",2)),List.of(new BriefingPresentationPolicy.Section("ACTION",0),new BriefingPresentationPolicy.Section("CAUTION",0)),List.of(new BriefingPresentationPolicy.Section("<script>",0))))
            assertThrows(IdentityException.class,()->BriefingPresentationPolicy.resolve(request("SUGGESTION",p("EDITORIAL",null,null,null,sections)),"SUGGESTION",null));
        var options=p("COMPARISON",null,null,null,List.of(new BriefingPresentationPolicy.Section("OPTION",0),new BriefingPresentationPolicy.Section("OPTION",1)));
        assertEquals(options,BriefingPresentationPolicy.resolve(request("INSIGHT",options),"INSIGHT",null));
        assertThrows(IdentityException.class,()->BriefingPresentationPolicy.resolve(request("SUGGESTION",p("COMPARISON",null,null,null,steps.sections())),"SUGGESTION",null));
    }
    @Test void fixedChainPreservesValidatedRolesWithoutChangingChartContract(){
        var sections=List.of(new BriefingPresentationPolicy.Section("OBSERVATION",0),new BriefingPresentationPolicy.Section("ACTION",1));
        var req=request("DATA",p("KEY_METRIC","TABLE","甲","CURRENT",sections));
        var resolved=BriefingPresentationPolicy.fixedChain(req,chart,true);
        assertEquals(sections,resolved.sections());assertEquals("EDITORIAL",resolved.layout());
        assertEquals("GROUPED_BAR",resolved.chartStyle());assertNull(resolved.focusGroup());
        assertEquals("CURRENT_BAR",BriefingPresentationPolicy.fixedChain(req,chart,false).chartStyle());
        var invalid=request("DATA",p("EDITORIAL","TABLE",null,null,List.of(new BriefingPresentationPolicy.Section("ACTION",5))));
        assertThrows(IdentityException.class,()->BriefingPresentationPolicy.fixedChain(invalid,chart,true));
    }
    @Test void legacyDeliveryDefaultsToTheExistingPresentation(){
        var old=new BriefingContentService.Content("briefing-data-v1","DATA","标题","摘要",prose,chart,null,null,null,"2026-10-06T00:00:00Z");
        var defaults=BriefingPresentationPolicy.resolve(request("DATA",null),"DATA",chart);
        assertTrue(BriefingPresentationPolicy.same(old,defaults));
        assertFalse(BriefingPresentationPolicy.same(old,p("EDITORIAL","TABLE",null,null,List.of())));
    }
}
