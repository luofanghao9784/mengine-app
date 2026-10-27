package com.dreamcore.workspace;
import java.nio.file.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;
class NativeEnginePrerequisitesTest {
 @TempDir Path root;
 @Test void absentOrPartialBuildReportsRepairBeforeBusinessTests()throws Exception{
  var e=assertThrows(IllegalStateException.class,()->NativeEnginePrerequisites.verify(root));assertTrue(e.getMessage().contains("NATIVE_TEST_ENGINE_NOT_BUILT"));assertTrue(e.getMessage().contains("npm run build:engine"));
  Files.createDirectories(root.resolve("engine/dist"));Files.writeString(root.resolve("engine/dist/main.js"),"");
  assertThrows(IllegalStateException.class,()->NativeEnginePrerequisites.verify(root));
  for(String file:NativeEnginePrerequisites.REQUIRED){Path p=root.resolve("engine/dist").resolve(file);Files.createDirectories(p.getParent());Files.writeString(p,"");}
  assertDoesNotThrow(()->NativeEnginePrerequisites.verify(root));
 }
}
