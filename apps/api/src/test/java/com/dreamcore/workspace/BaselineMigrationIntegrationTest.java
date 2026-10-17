package com.dreamcore.workspace;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import java.sql.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Both pre-integration development histories upgrade without repair or checksum rewriting. */
class BaselineMigrationIntegrationTest {
 private String user=System.getenv("DATABASE_USER"), password=System.getenv("DATABASE_PASSWORD");
 private String database(String name) throws Exception {
  String url=System.getenv("DATABASE_URL");assertNotNull(url,"Use scripts/with-test-postgres.py");
  try(var c=DriverManager.getConnection(url,user,password);var s=c.createStatement()){s.execute("CREATE DATABASE "+name);}
  return url.substring(0,url.lastIndexOf('/')+1)+name;
 }
 private Flyway flyway(String url,String location,String target){var config=Flyway.configure().dataSource(url,user,password).locations("classpath:db/"+location,"classpath:db/migration-common").cleanDisabled(true);if(target!=null)config.target(target);return config.load();}
 private List<String> query(String url,String sql) throws Exception {var values=new ArrayList<String>();try(var c=DriverManager.getConnection(url,user,password);var s=c.createStatement();var r=s.executeQuery(sql)){while(r.next())values.add(r.getString(1));}return values;}
 private void upgrade(String url,String location,String oldVersion) throws Exception {
  flyway(url,location,oldVersion).migrate();
  var before=query(url,"SELECT version||':'||checksum FROM flyway_schema_history WHERE success ORDER BY installed_rank");
  try(var c=DriverManager.getConnection(url,user,password);var s=c.createStatement()){s.execute("CREATE TABLE baseline_retention_probe(value text); INSERT INTO baseline_retention_probe VALUES ('synthetic retained input')");}
  flyway(url,location,null).migrate();flyway(url,location,null).validate();
  assertTrue(query(url,"SELECT version||':'||checksum FROM flyway_schema_history WHERE success ORDER BY installed_rank").containsAll(before));
  assertEquals(List.of("synthetic retained input"),query(url,"SELECT value FROM baseline_retention_probe"));
 }
 @Test void bothLineagesRetainHistoryAndConverge() throws Exception {
  String suffix=UUID.randomUUID().toString().replace("-","");
  String remote=database("baseline_remote_"+suffix),local=database("baseline_local_"+suffix);
  upgrade(remote,"migration","133");upgrade(local,"migration-local","140");
  assertThrows(Exception.class,()->flyway(local,"migration",null).validate(),"Wrong lineage must fail, never repair historical checksums");
  String columns="SELECT table_name||'.'||column_name||':'||data_type||':'||is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name <> 'flyway_schema_history' ORDER BY 1";
  assertEquals(query(remote,columns),query(local,columns));
  String funcs="SELECT p.oid::regprocedure::text||':'||pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' ORDER BY p.oid::regprocedure::text";
  assertEquals(query(remote,funcs),query(local,funcs),"Permission functions must converge too");
  assertEquals(List.of("true"),query(remote,"SELECT (scene_table_scope('{\"version\":1,\"governance\":{\"sourceVersion\":1,\"allowedActors\":[\"a\"]}}')=scene_table_scope('{\"version\":2,\"governance\":{\"sourceVersion\":2,\"allowedActors\":[\"a\"]}}'))::text"));
 }
}
