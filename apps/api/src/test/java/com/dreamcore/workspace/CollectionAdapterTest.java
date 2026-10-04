package com.dreamcore.workspace;
import com.dreamcore.workspace.collection.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;
class CollectionAdapterTest {
    @TempDir Path directory;
    Path executable(String body)throws Exception{Path p=directory.resolve(UUID.randomUUID()+".sh");Files.writeString(p,"#!/bin/sh\n"+body);assertTrue(p.toFile().setExecutable(true));return p;}
    CollectionAdapter.Request request(){return new CollectionAdapter.Request("1.0",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),List.of());}
    @Test void missingDeploymentDoesNotPretendToBeConnected(){assertFalse(new ProcessCollectionAdapter("",1,1024).available());assertFalse(new ProcessCollectionAdapter("relative-command",1,1024).available());}
    @Test void readsActualProcessOutputAndDiscardsPrivateStderr()throws Exception{
        var path=executable("cat >/dev/null\necho 'private-token-do-not-log' >&2\nprintf '%s' '{\"contractVersion\":\"1.0\",\"snapshots\":[]}'\n");
        assertEquals(new CollectionAdapter.Result("1.0",List.of()),new ProcessCollectionAdapter(path.toString(),2,1024).collect(request()));
    }
    @Test void limitsOutputAndRuntimeAndStopsWhenAuthorizationDisappears()throws Exception{
        var endless=executable("cat >/dev/null\nsleep 30\n");
        var adapter=new ProcessCollectionAdapter(endless.toString(),1,1024);
        assertTimeoutPreemptively(java.time.Duration.ofSeconds(4),()->assertThrows(TimeoutException.class,()->adapter.collect(request())));
        var checks=new java.util.concurrent.atomic.AtomicInteger();
        assertTimeoutPreemptively(java.time.Duration.ofSeconds(4),()->assertThrows(IllegalStateException.class,()->new ProcessCollectionAdapter(endless.toString(),10,1024).collect(request(),()->checks.incrementAndGet()<2)));
        var big=executable("cat >/dev/null\nhead -c 2048 /dev/zero\n");assertThrows(Exception.class,()->new ProcessCollectionAdapter(big.toString(),2,1024).collect(request()));
    }
    @Test void scheduleHasNoInventedDefaultAndUsesExplicitTimezoneAcrossDst(){
        assertThrows(IdentityException.class,()->CollectionSchedule.next(java.time.Instant.now(),null,null,"UTC"));
        var before=java.time.Instant.parse("2026-03-08T06:00:00Z");
        assertEquals(java.time.Instant.parse("2026-03-08T07:00:00Z"),CollectionSchedule.next(before,"DAILY","02:30","America/New_York"));
        assertEquals(before.plusSeconds(900),CollectionSchedule.next(before,"QUARTER_HOUR",null,"Asia/Shanghai"));
    }
}
