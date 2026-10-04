package com.dreamcore.workspace;
import java.util.*;
abstract class DatasetCalculationFixture extends TaskDatasetFixture {
 @Override List<String> columns(){return List.of("门店","期间","收款（元）");}
 @Override List<List<String>> rowsFor(String marker){
  if(marker.equals("new"))return List.of(List.of("甲","前期","99999"),List.of("甲","本期","77777"));
  return List.of(List.of("甲","前期","0.10"),List.of("甲","前期","0.20"),List.of("甲","本期","0.60"),List.of("乙","前期","0.30"),List.of("乙","本期","0.60"),List.of("甲","其他期间","99999"));
 }
 void rows(List<?> rows){int n=db.queryForObject("SELECT max(version)+1 FROM dataset_snapshots WHERE dataset_id=?",Integer.class,dataset);snapshot=version(n,rows);}
}
