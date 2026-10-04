package com.dreamcore.workspace.collection;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/** A deployment-owned executable, not a shell command or a customer supplied endpoint. */
@Component
public class ProcessCollectionAdapter implements CollectionAdapter {
    private final String executable;private final int timeoutSeconds,maxBytes;
    private final JsonMapper json=new JsonMapper();
    public ProcessCollectionAdapter(@Value("${dreamcore.collection.executable:}") String executable,
        @Value("${dreamcore.collection.timeout-seconds:120}") int timeoutSeconds,
        @Value("${dreamcore.collection.max-response-bytes:20971520}") int maxBytes) {
        this.executable=executable;this.timeoutSeconds=Math.max(1,Math.min(600,timeoutSeconds));this.maxBytes=Math.max(1024,Math.min(104857600,maxBytes));
    }
    public boolean available(){return !executable.isBlank()&&Path.of(executable).isAbsolute()&&Files.isRegularFile(Path.of(executable))&&Files.isExecutable(Path.of(executable));}
    public Result collect(Request request) throws Exception {return collect(request,()->true);}
    @Override public Result collect(Request request,java.util.function.BooleanSupplier active) throws Exception {
        if(!available())throw new IllegalStateException("COLLECTOR_UNCONFIGURED");
        Process process=new ProcessBuilder(executable).redirectError(ProcessBuilder.Redirect.DISCARD).start();
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            var output=executor.submit(()->{
                byte[] bytes=process.getInputStream().readNBytes(maxBytes+1);
                if(bytes.length>maxBytes)throw new IllegalStateException("COLLECTION_RESPONSE_TOO_LARGE");
                return bytes;
            });
            var input=executor.submit(()->{
                try(var pipe=process.getOutputStream()){pipe.write(json.writeValueAsString(request).getBytes(StandardCharsets.UTF_8));}
                return true;
            });
            try {
                long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(timeoutSeconds);
                while(process.isAlive()||!output.isDone()||!input.isDone()) {
                    if(!active.getAsBoolean())throw new IllegalStateException("COLLECTION_INTERRUPTED");
                    if(System.nanoTime()>=deadline)throw new TimeoutException();
                    if(output.isDone())output.get(); // Fail promptly on oversized output.
                    if(input.isDone())input.get();
                    if(process.isAlive())process.waitFor(200,TimeUnit.MILLISECONDS);else Thread.sleep(100);
                }
                if(process.exitValue()!=0)throw new IllegalStateException("COLLECTION_ADAPTER_FAILED");
                return json.readValue(output.get(),Result.class);
            } finally {
                process.descendants().forEach(ProcessHandle::destroyForcibly);process.destroyForcibly();
                process.getInputStream().close();output.cancel(true);input.cancel(true);
            }
        }
    }
}
