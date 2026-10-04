package com.dreamcore.workspace.identity;

import java.io.InputStream;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.json.JsonMapper;

/** Reads a bounded deployment-owned projection, never a backup directory or signed business manifest. */
@Component
public class BackupObservationReader {
 public record Snapshot(UUID id,Instant createdAt,Instant expiresAt,long bytes,long files,long tables) {}
 public record Event(UUID id,String command,String state,Instant startedAt,Instant finishedAt,Snapshot snapshot) {}
 public record Observation(String state,Instant updatedAt,long staleSeconds,List<Event> events) {}
 private final String file;private final long staleSeconds;
 private final JsonMapper json=JsonMapper.builder().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build();
 public BackupObservationReader(@Value("${dreamcore.backup.status-file:}") String file,@Value("${dreamcore.backup.status-stale-seconds:900}") long staleSeconds){this.file=file;this.staleSeconds=Math.max(60,Math.min(604800,staleSeconds));}
 private Observation empty(String state){return new Observation(state,null,staleSeconds,List.of());}
 public Observation read(Instant now){
  if(file.isBlank())return empty("NOT_CONFIGURED");
  try{
   Path path=Path.of(file);var attr=Files.readAttributes(path,java.nio.file.attribute.BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
   if(!attr.isRegularFile()||attr.size()>65536)throw new IllegalArgumentException();
   var permissions=Files.getPosixFilePermissions(path,LinkOption.NOFOLLOW_LINKS);
   if(permissions.stream().anyMatch(p->p.name().startsWith("GROUP_")||p.name().startsWith("OTHERS_")))throw new IllegalArgumentException();
   if(((Number)Files.getAttribute(path,"unix:nlink",LinkOption.NOFOLLOW_LINKS)).intValue()!=1)throw new IllegalArgumentException();
   byte[] bytes;try(InputStream input=Files.newInputStream(path,LinkOption.NOFOLLOW_LINKS)){bytes=input.readNBytes(65537);}if(bytes.length>65536)throw new IllegalArgumentException();
   Map<?,?> root=object(json.readValue(bytes,Map.class),"format updatedAt events");
   if(!"dreamcore-backup-observation-v1".equals(root.get("format")))throw new IllegalArgumentException();
   Instant updated=date(root.get("updatedAt"));if(updated.isAfter(now.plusSeconds(5)))throw new IllegalArgumentException();
   if(!(root.get("events") instanceof List<?> rows)||rows.size()>40)throw new IllegalArgumentException();
   List<Event> events=new ArrayList<>();Set<UUID> ids=new HashSet<>();
   for(Object row:rows){
    Map<?,?> e=object(row,"id command state startedAt finishedAt snapshot");UUID id=uuid(e.get("id"));if(!ids.add(id))throw new IllegalArgumentException();
    String command=choice(e.get("command"),"CREATE VERIFY RESTORE REPACK ROTATE RECONCILE ACTIVATE"),state=choice(e.get("state"),"RUNNING SUCCEEDED FAILED UNKNOWN");
    Instant start=date(e.get("startedAt")),end=e.get("finishedAt")==null?null:date(e.get("finishedAt"));
    if(start.isAfter(updated)||((end==null)!=state.equals("RUNNING"))||end!=null&&(end.isBefore(start)||end.isAfter(updated)))throw new IllegalArgumentException();
    Snapshot snapshot=null;
    if(e.get("snapshot")!=null){
     if(!state.equals("SUCCEEDED")||command.equals("ROTATE"))throw new IllegalArgumentException();
     Map<?,?> s=object(e.get("snapshot"),"id createdAt expiresAt bytes files tables");Instant created=date(s.get("createdAt")),expires=date(s.get("expiresAt"));
     if(!expires.isAfter(created)||created.isAfter(end))throw new IllegalArgumentException();
     snapshot=new Snapshot(uuid(s.get("id")),created,expires,number(s.get("bytes")),number(s.get("files")),number(s.get("tables")));
    }
    // A process killed without a final receipt cannot remain reassuringly "running" forever.
    if(state.equals("RUNNING")&&start.isBefore(now.minusSeconds(staleSeconds)))state="UNKNOWN";
    events.add(new Event(id,command,state,start,end,snapshot));
   }
   events.sort(Comparator.comparing(Event::startedAt).reversed());
   return new Observation(updated.isBefore(now.minusSeconds(staleSeconds))?"STALE":"FRESH",updated,staleSeconds,List.copyOf(events));
  }catch(Exception ignored){return empty("UNAVAILABLE");} // No paths, parser diagnostics or source strings cross the boundary.
 }
 private static Map<?,?> object(Object v,String keys){if(!(v instanceof Map<?,?> m)||!m.keySet().equals(Set.of(keys.split(" "))))throw new IllegalArgumentException();return m;}
 private static String choice(Object v,String options){if(!(v instanceof String s)||!Set.of(options.split(" ")).contains(s))throw new IllegalArgumentException();return s;}
 private static Instant date(Object v){if(!(v instanceof String s)||s.length()>40)throw new IllegalArgumentException();return OffsetDateTime.parse(s).toInstant();}
 private static UUID uuid(Object v){if(!(v instanceof String s)||!s.matches("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"))throw new IllegalArgumentException();return UUID.fromString(s);}
 private static long number(Object v){if(!(v instanceof Integer||v instanceof Long)||((Number)v).longValue()<0||((Number)v).longValue()>9007199254740991L)throw new IllegalArgumentException();return ((Number)v).longValue();}
}
