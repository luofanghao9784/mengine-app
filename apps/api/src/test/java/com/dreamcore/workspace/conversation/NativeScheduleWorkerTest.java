package com.dreamcore.workspace.conversation;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.*;
@ExtendWith(OutputCaptureExtension.class)
class NativeScheduleWorkerTest {
 @Test void logsSafeReasonAndContinuesWithoutRetry(CapturedOutput output){
  var service=mock(NativeSchedules.class);var first=UUID.randomUUID();var second=UUID.randomUUID();
  when(service.candidates()).thenReturn(List.of(first,second));
  doThrow(new IllegalStateException("secret-token private-prompt")).when(service).tick(first);
  new NativeScheduleWorker(service).tick();
  verify(service,times(1)).tick(first);verify(service,times(1)).tick(second);
  assertTrue(output.toString().contains(first.toString()));assertTrue(output.toString().contains("IllegalStateException"));
  assertFalse(output.toString().contains("secret-token"));assertFalse(output.toString().contains("private-prompt"));
 }
 @Test void scanFailureIsVisibleWithoutSensitiveMessage(CapturedOutput output){
  var service=mock(NativeSchedules.class);when(service.candidates()).thenThrow(new IllegalArgumentException("private-prompt"));
  new NativeScheduleWorker(service).tick();assertTrue(output.toString().contains("scan failed"));assertFalse(output.toString().contains("private-prompt"));
 }
}
