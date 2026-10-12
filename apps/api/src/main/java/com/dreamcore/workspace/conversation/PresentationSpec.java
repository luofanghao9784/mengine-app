package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;

/** Closed, bounded data model shared with the fixed renderer; never executable content. */
final class PresentationSpec {
    private PresentationSpec() {}
    static void text(Object value,int max){if(!(value instanceof String s)||s.isBlank()||s.length()>max||s.codePoints().anyMatch(c->c<32||c==127))throw IdentityException.invalid();}
    static List<?> list(Object value,int min,int max){if(!(value instanceof List<?> l)||l.size()<min||l.size()>max)throw IdentityException.invalid();return l;}
    static void strings(Object value,int min,int max,int length){for(Object s:list(value,min,max))text(s,length);}
    static void validate(Map<String,Object> spec){
        if(spec==null||!spec.keySet().equals(Set.of("title","theme","slides")))throw IdentityException.invalid();
        text(spec.get("title"),48);if(!("ocean".equals(spec.get("theme"))||"ink".equals(spec.get("theme"))))throw IdentityException.invalid();
        for(Object item:list(spec.get("slides"),1,8)){
            if(!(item instanceof Map<?,?> s))throw IdentityException.invalid();
            text(s.get("title"),40);var ids=list(s.get("sourceIds"),0,10);if(new HashSet<>(ids).size()!=ids.size())throw IdentityException.invalid();
            for(Object id:ids)try{if(!(id instanceof String v)||!UUID.fromString(v).toString().equals(v))throw new IllegalArgumentException();}catch(IllegalArgumentException e){throw IdentityException.invalid();}
            var fields=new HashSet<>(Set.of("kind","title","sourceIds"));
            switch(String.valueOf(s.get("kind"))){
                case "cover" -> {fields.add("subtitle");if(s.containsKey("subtitle"))text(s.get("subtitle"),100);}
                case "bullets" -> {fields.add("bullets");strings(s.get("bullets"),1,4,90);}
                case "table" -> {fields.addAll(Set.of("headers","rows"));strings(s.get("headers"),2,5,16);int cols=((List<?>)s.get("headers")).size();for(Object row:list(s.get("rows"),1,6))strings(row,cols,cols,24);}
                case "chart" -> {fields.addAll(Set.of("labels","values","series","unit"));strings(s.get("labels"),2,8,12);int n=((List<?>)s.get("labels")).size();for(Object v:list(s.get("values"),n,n))if(!(v instanceof Number x)||!Double.isFinite(x.doubleValue())||x.doubleValue()<0||x.doubleValue()>1e12)throw IdentityException.invalid();text(s.get("series"),24);text(s.get("unit"),12);}
                default -> throw IdentityException.invalid();
            }
            if(!fields.containsAll(s.keySet()))throw IdentityException.invalid();
        }
    }
    @SuppressWarnings("unchecked") static List<Map<String,Object>> slides(Map<String,Object> spec){return (List<Map<String,Object>>)spec.get("slides");}
    static Set<UUID> sources(Map<String,Object> spec){var result=new LinkedHashSet<UUID>();for(var s:slides(spec))for(Object id:(List<?>)s.get("sourceIds"))result.add(UUID.fromString(id.toString()));if(result.size()>10)throw IdentityException.invalid();return result;}
}
