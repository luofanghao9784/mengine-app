package com.dreamcore.workspace.knowledge;

import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/** Executes a fixed, bounded recipe inside the same OS isolation as document parsing. */
@Component
public class LocalTableCalculator {
    private final String root;
    private final JsonMapper json=new JsonMapper();
    public LocalTableCalculator(@Value("${dreamcore.knowledge.parser-root:}") String root){this.root=root;}
    public boolean available(){return !root.isBlank() && Files.isRegularFile(Path.of(root,"table_compare.py")) && Files.isRegularFile(Path.of(root,"sandbox.py")) && Files.isExecutable(Path.of(root,".venv/bin/python")) && Files.isExecutable(Path.of("/usr/bin/sandbox-exec"));}
    public Map<String,Object> calculate(byte[] bytes,Map<String,Object> request){
        Path job=null;Process process=null;
        try{
            if(!available())return Map.of("status","FAILED","code","TABLE_CALCULATOR_UNAVAILABLE");
            Path parser=Path.of(root).toRealPath();
            job=Files.createTempDirectory("dreamcore-table-",PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
            Files.write(job.resolve("input"),bytes);Files.write(job.resolve("request.json"),json.writeValueAsBytes(request));
            for(String name:List.of("input","request.json"))Files.setPosixFilePermissions(job.resolve(name),PosixFilePermissions.fromString("r--------"));
            var builder=new ProcessBuilder(parser.resolve(".venv/bin/python").toString(),"-I","-B",parser.resolve("sandbox.py").toString(),job.toString(),"table-compare");
            builder.environment().clear();builder.environment().put("PATH","/opt/homebrew/bin:/usr/bin:/bin");
            builder.redirectOutput(job.resolve("output").toFile()).redirectError(job.resolve("launcher-errors").toFile());process=builder.start();
            if(!process.waitFor(10,TimeUnit.SECONDS)||process.exitValue()!=0||Files.size(job.resolve("output"))>60000)return Map.of("status","FAILED","code","TABLE_CALCULATOR_LIMIT");
            var result=json.readValue(Files.readAllBytes(job.resolve("output")),Map.class);
            if(!Set.of("COMPUTED","FAILED").contains(result.get("status")))return Map.of("status","FAILED","code","TABLE_CALCULATOR_FAILED");
            return result;
        }catch(Exception e){if(e instanceof InterruptedException)Thread.currentThread().interrupt();return Map.of("status","FAILED","code","TABLE_CALCULATOR_FAILED");}
        finally{
            if(process!=null&&process.isAlive()){process.descendants().forEach(ProcessHandle::destroyForcibly);process.destroyForcibly();}
            if(job!=null)try(var paths=Files.walk(job)){for(Path p:paths.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(p);}catch(Exception ignored){}
        }
    }
}
