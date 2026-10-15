package com.dreamcore.workspace;
import com.dreamcore.workspace.engine.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class ExecutionReceiptTransportTest {
 @Test void receiptTransportRequiresDedicatedEngineCredential(){
  var service=mock(ExecutionReceipts.class);var controller=new ExecutionReceiptController(service,"t".repeat(40));UUID id=UUID.randomUUID(),attempt=UUID.randomUUID();var body=new ExecutionReceipts.Claim("a".repeat(64),"test");
  for(String header:Arrays.asList(null,"Bearer invalid","Bearer "+"t".repeat(39)))assertThrows(IdentityException.class,()->controller.claim(header,"AGENT",id,attempt,body));
  verifyNoInteractions(service);when(service.claim("AGENT",id,attempt,body)).thenReturn(Map.of("state","NEW"));assertEquals(Map.of("state","NEW"),controller.claim("Bearer "+"t".repeat(40),"AGENT",id,attempt,body));
 }
}
