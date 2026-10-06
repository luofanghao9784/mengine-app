package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;

/** Composes existing prose and verified calculation fields. Does not accept numbers, URLs or code. */
public final class BriefingPresentationPolicy {
    public record Section(String role,Integer paragraphIndex) {}
    public record Presentation(String version,String layout,String chartStyle,String focusGroup,String focusValue,List<Section> sections) {}
    private static final Set<String> LAYOUTS=Set.of("EDITORIAL","KEY_METRIC","STEPS","COMPARISON","SOURCE");
    private static final Set<String> CHARTS=Set.of("GROUPED_BAR","DUMBBELL","DELTA_BAR","CURRENT_BAR","TABLE");
    private static final Set<String> ROLES=Set.of("OBSERVATION","INTERPRETATION","ACTION","OPTION","CAUTION");
    private static IdentityException invalid(){return new IdentityException(422,"BRIEFING_PRESENTATION_INVALID");}
    public static Presentation resolve(BriefingContentService.Request request,String type,BriefingContentService.Chart chart){
        var p=request.presentation();
        if(p==null)return new Presentation("briefing-presentation-v1","EDITORIAL",chart==null?null:"GROUPED_BAR",null,null,List.of());
        if(!"briefing-presentation-v1".equals(p.version()) || p.layout()==null || !LAYOUTS.contains(p.layout()))throw invalid();
        if(chart==null){if(p.chartStyle()!=null||p.focusGroup()!=null||p.focusValue()!=null||"KEY_METRIC".equals(p.layout()))throw invalid();}
        else if(p.chartStyle()==null||!CHARTS.contains(p.chartStyle()))throw invalid();
        if("STEPS".equals(p.layout())&&!"SUGGESTION".equals(type))throw invalid();
        if("COMPARISON".equals(p.layout())&&!Set.of("SUGGESTION","INSIGHT").contains(type))throw invalid();
        if(chart!=null&&!Set.of("EDITORIAL","KEY_METRIC").contains(p.layout()))throw invalid();
        if(p.focusGroup()!=null&&(p.focusGroup().length()>100||chart.rows().stream().noneMatch(r->p.focusGroup().equals(r.group()))))throw invalid();
        if(p.focusValue()!=null&&!Set.of("CURRENT","DIFFERENCE","CHANGE_PERCENT").contains(p.focusValue()))throw invalid();
        if(!"KEY_METRIC".equals(p.layout())&&(p.focusGroup()!=null||p.focusValue()!=null))throw invalid();
        if(p.sections()==null||p.sections().size()>4)throw invalid();
        var indices=new HashSet<Integer>();
        for(var section:p.sections())if(section==null||!ROLES.contains(Objects.toString(section.role(),""))||section.paragraphIndex()==null||section.paragraphIndex()<0||section.paragraphIndex()>=request.analysis().size()||!indices.add(section.paragraphIndex()))throw invalid();
        if(Set.of("STEPS","COMPARISON").contains(p.layout())&&p.sections().size()<2)throw invalid();
        if("STEPS".equals(p.layout())&&p.sections().stream().anyMatch(s->!Set.of("ACTION","CAUTION").contains(s.role())))throw invalid();
        if("COMPARISON".equals(p.layout())&&p.sections().stream().filter(s->"OPTION".equals(s.role())).count()<2)throw invalid();
        return new Presentation(p.version(),p.layout(),p.chartStyle(),p.focusGroup(),"KEY_METRIC".equals(p.layout())?Objects.requireNonNullElse(p.focusValue(),"CURRENT"):null,List.copyOf(p.sections()));
    }
    public static boolean same(BriefingContentService.Content old,Presentation proposed){
        if(old.presentation()!=null)return old.presentation().equals(proposed);
        return proposed.equals(new Presentation("briefing-presentation-v1","EDITORIAL",old.chart()==null?null:"GROUPED_BAR",null,null,List.of()));
    }
    private BriefingPresentationPolicy() {}
}
