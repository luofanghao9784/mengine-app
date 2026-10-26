package com.dreamcore.workspace;

import com.dreamcore.workspace.collection.*;
import java.sql.SQLException;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.dao.PessimisticLockingFailureException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class CollectionWorkerRetryTest {
    CollectionService service=mock(CollectionService.class);
    CollectionAdapter adapter=mock(CollectionAdapter.class);
    CollectionAdapter.Request request=new CollectionAdapter.Request("1.0",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),List.of());
    CollectionService.Claim claim=new CollectionService.Claim(request.tenantId(),request.connectionId(),request.runId(),UUID.randomUUID(),1,request);
    CollectionAdapter.Result result=new CollectionAdapter.Result("1.0",List.of());
    RuntimeException conflict(String state){return new PessimisticLockingFailureException("synthetic",new SQLException("synthetic",state));}

    @Test void retriesRolledBackTransactionsWithoutCollectingAgain() throws Exception {
        for(String state:List.of("40P01","40001")) {
            reset(service,adapter);
            when(adapter.collect(eq(request),any())).thenReturn(result);
            when(service.complete(eq(claim),same(result),any(Instant.class))).thenThrow(conflict(state)).thenReturn(true);
            var worker=new CollectionWorker(service,adapter,true,1);
            try {worker.execute(claim);}finally{worker.stop();}
            verify(adapter,times(1)).collect(eq(request),any());
            verify(service,times(2)).complete(eq(claim),same(result),any(Instant.class));
            verify(service,never()).fail(any(),any(),any());
        }
    }
    @Test void limitsRetriesAndRecordsFailure() throws Exception {
        when(adapter.collect(eq(request),any())).thenReturn(result);
        when(service.complete(eq(claim),same(result),any())).thenThrow(conflict("40P01"));
        var worker=new CollectionWorker(service,adapter,true,1);
        try{worker.execute(claim);}finally{worker.stop();}
        verify(service,times(3)).complete(eq(claim),same(result),any());
        verify(service).fail(eq(claim),eq("COLLECTION_ADAPTER_FAILED"),any());
        verify(adapter,times(1)).collect(eq(request),any());
    }
    @Test void doesNotRetryValidationOrOtherSqlErrors() throws Exception {
        for(RuntimeException failure:List.of(new IllegalArgumentException("invalid synthetic response"),conflict("23505"))) {
            reset(service,adapter);
            when(adapter.collect(eq(request),any())).thenReturn(result);
            when(service.complete(eq(claim),same(result),any())).thenThrow(failure);
            var worker=new CollectionWorker(service,adapter,true,1);
            try{worker.execute(claim);}finally{worker.stop();}
            verify(service,times(1)).complete(eq(claim),same(result),any());
            verify(service).fail(eq(claim),eq("COLLECTION_ADAPTER_FAILED"),any());
        }
    }
}
