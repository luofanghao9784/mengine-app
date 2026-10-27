package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import static org.junit.jupiter.api.Assertions.*;
class NativeAttachmentsIntegrationTest extends NativeConversationIntegrationTest {
 @Autowired NativeAttachments files;
 @Test void uploadIsPrivateIdempotentAndCannotCrossRootOrOverwrite(){
  var s=open();var key=UUID.randomUUID();var file=new MockMultipartFile("file","private.txt","image/png","PRIVATE_FILE".getBytes());
  var f=files.upload(owner,tenant,s.id(),key,file);assertEquals(f,files.upload(owner,tenant,s.id(),key,file));assertEquals("application/octet-stream",f.mediaType());
  denied(()->files.upload(owner,tenant,s.id(),key,new MockMultipartFile("file","private.txt","text/plain","DIFFERENT".getBytes())));
  denied(()->files.download(other,tenant,s.id(),f.id()));denied(()->files.validate(owner,tenant,open().id(),List.of(f.id())));
  assertArrayEquals("PRIVATE_FILE".getBytes(),files.download(owner,tenant,s.id(),f.id()).bytes());
  var g=nativeSessions.grant(owner,tenant,s.id());assertNotNull(files.runtime(s.id(),g.token(),f.id()));nativeSessions.stop(owner,tenant,s.id());denied(()->files.runtime(s.id(),g.token(),f.id()));
 }
 @Test void concurrentRetriesAndImageAdmissionAreVerified()throws Exception{
  var s=open();var key=UUID.randomUUID();var pngOut=new java.io.ByteArrayOutputStream();javax.imageio.ImageIO.write(new java.awt.image.BufferedImage(2,2,java.awt.image.BufferedImage.TYPE_INT_RGB),"png",pngOut);byte[] png=pngOut.toByteArray();var file=new MockMultipartFile("file","pixel.png","text/plain",png);
  try(var pool=java.util.concurrent.Executors.newFixedThreadPool(2)){var a=pool.submit(()->files.upload(owner,tenant,s.id(),key,file));var b=pool.submit(()->files.upload(owner,tenant,s.id(),key,file));assertEquals(a.get(),b.get());}
  assertEquals(1,files.list(owner,tenant,s.id()).size());var g=nativeSessions.grant(owner,tenant,s.id());var image=files.list(owner,tenant,s.id()).getFirst();assertEquals("image/png",image.mediaType());
  var text=files.upload(owner,tenant,s.id(),UUID.randomUUID(),new MockMultipartFile("file","private.txt","text/plain","PRIVATE_FILE".getBytes()));
  java.nio.file.Path root=java.nio.file.Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();
  var p=new ProcessBuilder("node",root.resolve("engine/tests/fixtures/native-attachments-run.mjs").toString(),"http://127.0.0.1:"+port,s.id().toString(),g.token(),image.id().toString(),text.id().toString()).redirectErrorStream(true).start();
  try{assertTrue(p.waitFor(50,java.util.concurrent.TimeUnit.SECONDS));assertEquals(0,p.exitValue(),new String(p.getInputStream().readAllBytes()));}finally{p.destroyForcibly();}
 }
}
