package com.dreamcore.workspace.governance;

import com.dreamcore.workspace.identity.IdentityException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

/** Deployment-declared value domains, checked against every currently readable row. */
public final class DeclaredValueChecks {
    private DeclaredValueChecks() {}
    public static Map<String,Object> check(List<?> columns, List<?> rows, List<Map<String,Object>> schema) {
        var rules=schema.stream().filter(r->"value-rule".equals(r.get("kind"))).toList();
        if(rules.isEmpty()) return Map.of("state","NOT_PROVIDED","rules",List.of(),"violations",0L);
        if(rules.size()>100) throw new IdentityException(503,"GOVERNANCE_RULES_INVALID");
        var results=new ArrayList<Map<String,Object>>();long violations=0;
        for(var rule:rules) {
            int index=columns.indexOf(rule.get("column"));
            String type=Objects.toString(rule.get("type"),"");
            if(index<0 || !Set.of("TEXT","DECIMAL","DATE","ENUM","PREFIX_DECIMAL","ORDINAL").contains(type)
                || !(rule.get("id") instanceof String)
                || !(rule.get("nullable") instanceof Boolean)) throw new IdentityException(503,"GOVERNANCE_RULES_INVALID");
            var allowed=rule.get("values") instanceof List<?> values?values:List.of();
            if(type.equals("ENUM") && (allowed.isEmpty() || allowed.size()>100)) throw new IdentityException(503,"GOVERNANCE_RULES_INVALID");
            String prefix=Objects.toString(rule.get("prefix"),""),suffix=Objects.toString(rule.get("suffix"),"");
            if(Set.of("PREFIX_DECIMAL","ORDINAL").contains(type) && prefix.isEmpty()) throw new IdentityException(503,"GOVERNANCE_RULES_INVALID");
            long failed=0,examined=0;
            for(Object value:rows) {
                Object cell=((List<?>)value).get(index);
                if(cell==null) { if(!Boolean.TRUE.equals(rule.get("nullable"))) failed++; continue; }
                examined++;String text=cell.toString();boolean valid=true;
                try {
                    switch(type) {
                        case "TEXT" -> valid=!text.isBlank();
                        case "DECIMAL" -> new BigDecimal(text);
                        case "DATE" -> LocalDate.parse(text);
                        case "ENUM" -> valid=allowed.contains(text);
                        case "PREFIX_DECIMAL" -> { if(!allowed.contains(text)) {valid=text.startsWith(prefix);if(valid)new BigDecimal(text.substring(prefix.length()));} }
                        case "ORDINAL" -> {if(!allowed.contains(text)) {valid=text.startsWith(prefix)&&text.endsWith(suffix)&&text.length()>prefix.length()+suffix.length();if(valid){String number=text.substring(prefix.length(),text.length()-suffix.length());valid=number.matches("[0-9]{1,9}")&&Long.parseLong(number)>0;}}}
                    }
                } catch(RuntimeException invalid) {valid=false;}
                if(!valid) failed++;
            }
            violations+=failed;
            results.add(Map.of("id",rule.get("id"),"column",rule.get("column"),"type",type,"state",failed==0?"CHECKED":"VIOLATIONS", "examined",examined,"violations",failed,"evidence",Objects.toString(rule.get("evidence"),"采集端声明规则" )));
        }
        return Map.of("state",violations==0?"CHECKED":"VIOLATIONS","rules",results,"violations",violations,
            "scope","仅已声明的字段类型、值域及格式；未声明的跨表、金额勾稽和到账规则不视为已检查");
    }
}
