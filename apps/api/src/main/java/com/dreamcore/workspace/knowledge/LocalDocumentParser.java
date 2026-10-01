package com.dreamcore.workspace.knowledge;

import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

@Component
public class LocalDocumentParser implements DocumentParser {
    private final String root;
    public LocalDocumentParser(@Value("${dreamcore.knowledge.parser-root:}") String root) { this.root=root; }
    private Result failed() { return new Result("local-3","FAILED",List.of("PARSER_UNAVAILABLE_OR_LIMIT"),List.of()); }
    @Override public Result parse(String filename,byte[] original) {
        Path job=null; Process process=null;
        try {
            if(root.isBlank()) return failed();
            Path parser=Path.of(root).toRealPath();
            job=Files.createTempDirectory("dreamcore-parse-",PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
            Files.write(job.resolve("input"),original); Files.setPosixFilePermissions(job.resolve("input"),PosixFilePermissions.fromString("r--------"));
            String extension=filename.contains(".")?filename.substring(filename.lastIndexOf('.')+1).toLowerCase(Locale.ROOT):"";
            if(!extension.matches("[a-z0-9]{0,12}")) extension="";
            var builder=new ProcessBuilder(parser.resolve(".venv/bin/python").toString(),"-I","-B",parser.resolve("sandbox.py").toString(),job.toString(),extension);
            builder.environment().clear();builder.environment().put("PATH","/opt/homebrew/bin:/usr/bin:/bin");
            builder.redirectOutput(job.resolve("launcher-output").toFile()).redirectError(job.resolve("launcher-errors").toFile());
            process=builder.start();
            if(!process.waitFor(85,TimeUnit.SECONDS) || process.exitValue()!=0) return failed();
            Path output=job.resolve("launcher-output"); if(Files.size(output)>4_000_000) return failed();
            Result result=new JsonMapper().readValue(Files.readAllBytes(output),Result.class);
            if(!Set.of("READY","PARTIAL","FAILED","UNSUPPORTED").contains(result.status()) || !Set.of("local-1","local-2","local-3").contains(result.parserVersion()) || result.chunks()==null || result.chunks().size()>500 || result.warnings()==null || result.warnings().size()>32) return failed();
            if(result.warnings().stream().anyMatch(x->x==null || !x.matches("[A-Z][A-Z0-9_]{0,63}"))) return failed();
            int total=0;
            for(var chunk:result.chunks()) {
                if(chunk.locator()==null || chunk.locator().length()>180 || chunk.content()==null || chunk.content().isBlank() || chunk.content().length()>4000 || !Set.of("TEXT","TABLE","OCR").contains(chunk.method())) return failed();
                total+=chunk.content().length();
            }
            if(total>800_000 || ((result.status().equals("READY") || result.status().equals("PARTIAL")) && result.chunks().isEmpty())) return failed();
            if((result.status().equals("FAILED") || result.status().equals("UNSUPPORTED")) && !result.chunks().isEmpty()) return failed();
            return result;
        } catch(Exception error) { if(error instanceof InterruptedException) Thread.currentThread().interrupt(); return failed(); }
        finally {
            if(process!=null && process.isAlive()) { process.descendants().forEach(ProcessHandle::destroyForcibly);process.destroyForcibly(); }
            if(job!=null) try(var paths=Files.walk(job)) { for(Path path:paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path); } catch(Exception ignored) { }
        }
    }
}
