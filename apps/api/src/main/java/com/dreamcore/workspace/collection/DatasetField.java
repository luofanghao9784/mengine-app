package com.dreamcore.workspace.collection;

import java.util.*;
import tools.jackson.databind.json.JsonMapper;

/** Deployment-authored reference data, never instructions, permissions or runtime model output. */
public record DatasetField(String column,String type,String meaning,String unit,String evidence,String status) {
    private static final JsonMapper JSON=new JsonMapper();
    public static List<DatasetField> read(Object value) {
        return JSON.readValue(value.toString(),JSON.getTypeFactory().constructCollectionType(List.class,DatasetField.class));
    }
    private static void text(String value,int max,boolean required) {
        if(value==null||value.length()>max||(required&&value.isBlank())||value.codePoints().anyMatch(Character::isISOControl))
            throw new IllegalArgumentException("Invalid deployed field definition");
    }
    public static void validate(List<String> columns,List<DatasetField> fields) {
        if(fields.isEmpty())return; // Legacy deployments remain explicit: no field explanations supplied.
        if(fields.size()!=columns.size()||JSON.writeValueAsString(fields).length()>24000)throw new IllegalArgumentException("Field definitions must cover deployed columns within bounds");
        for(int i=0;i<fields.size();i++) {
            var f=fields.get(i);
            if(f==null||!columns.get(i).equals(f.column())||f.status()==null||!Set.of("SOURCE_DOCUMENTED","DEPLOYMENT_INFERRED","MODEL_DETERMINED","UNKNOWN").contains(f.status()))throw new IllegalArgumentException("Invalid deployed field scope");
            text(f.type(),40,true);text(f.meaning(),300,true);text(f.unit(),40,false);text(f.evidence(),300,false);
        }
    }
}
