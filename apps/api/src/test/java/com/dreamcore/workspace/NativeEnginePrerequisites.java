package com.dreamcore.workspace;
import java.nio.file.*;
import java.util.*;
/** Test-only prerequisite check; never boot an external runtime or silently skip failures. */
final class NativeEnginePrerequisites {
 static final List<String> REQUIRED=List.of("main.js","native/budget.js","native/model-gateway.js","native/enterprise-plugin.js");
 static Path root(){Path p=Path.of("").toAbsolutePath();return p.endsWith("api")?p.getParent().getParent():p;}
 static void verify(Path root){
  var missing=REQUIRED.stream().filter(f->!Files.isRegularFile(root.resolve("engine/dist").resolve(f))).toList();
  if(!missing.isEmpty())throw new IllegalStateException("NATIVE_TEST_ENGINE_NOT_BUILT: missing engine/dist artifacts "+missing+". From repository root run: npm --prefix engine ci && npm run build:engine; then rerun the integration test. This is a test prerequisite, not a business failure.");
 }
}
