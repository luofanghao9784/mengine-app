package com.dreamcore.workspace.conversation;
import java.util.*;
import java.nio.file.*;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;
import com.dreamcore.workspace.identity.IdentityException;
import tools.jackson.databind.json.JsonMapper;
@Service
public class NativeScheduleRules {
 private final String script;private final JsonMapper json=new JsonMapper();
 public NativeScheduleRules(@Value("${dreamcore.native.schedule-rules:}")String script){Path root=Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();this.script=script.isBlank()?root.resolve("engine/scripts/native-schedule-rules.mjs").toString():script;}
 @SuppressWarnings("unchecked") public Map<String,Object> evaluate(Map<String,Object> input){
  Process p=null;try{p=new ProcessBuilder("node",script).redirectError(ProcessBuilder.Redirect.DISCARD).start();p.getOutputStream().write(json.writeValueAsBytes(input));p.getOutputStream().close();if(!p.waitFor(10,java.util.concurrent.TimeUnit.SECONDS))throw new IdentityException(503,"NATIVE_SCHEDULE_RULES_UNAVAILABLE");if(p.exitValue()!=0)throw new IdentityException(400,"NATIVE_SCHEDULE_RULE_INVALID");return json.readValue(p.getInputStream().readAllBytes(),Map.class);}catch(IdentityException e){throw e;}catch(Exception e){if(e instanceof InterruptedException)Thread.currentThread().interrupt();throw new IdentityException(503,"NATIVE_SCHEDULE_RULES_UNAVAILABLE");}finally{if(p!=null)p.destroyForcibly();}
 }
}
