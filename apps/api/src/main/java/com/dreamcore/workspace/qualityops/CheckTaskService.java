package com.dreamcore.workspace.qualityops;

import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.BooleanSupplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class CheckTaskService {
    private final QualityCheckEngine engine;
    private final CheckTaskStore store;
    private final long timeoutMillis;

    public CheckTaskService(QualityCheckEngine engine, CheckTaskStore store,
                            @Value("${dreamcore.quality-check.timeout-ms:5000}") long timeoutMillis) {
        this.engine = engine;
        this.store = store;
        this.timeoutMillis = Math.max(1, timeoutMillis);
    }

    public record CompletedTask(UUID taskId, String status, QualityCheckEngine.Result result) {}
    public static final class CapabilityNotOpened extends RuntimeException {}
    public static final class Unavailable extends RuntimeException {}

    public CompletedTask create(UUID tenantId, UUID actor, String title, String materialText,
                                BooleanSupplier isOpened) {
        // Only the read port and engine run in the bounded worker. A late result can never insert a row.
        var work = new FutureTask<QualityCheckEngine.Result>(() -> {
            if (!isOpened.getAsBoolean()) throw new CapabilityNotOpened();
            return Objects.requireNonNull(engine.check(materialText));
        });
        Thread.startVirtualThread(work);
        QualityCheckEngine.Result result;
        try {
            result = work.get(timeoutMillis, TimeUnit.MILLISECONDS);
        } catch (ExecutionException failure) {
            if (failure.getCause() instanceof CapabilityNotOpened closed) throw closed;
            throw new Unavailable();
        } catch (TimeoutException failure) {
            work.cancel(true);
            throw new Unavailable();
        } catch (InterruptedException failure) {
            work.cancel(true);
            Thread.currentThread().interrupt();
            throw new Unavailable();
        }
        UUID id = UUID.randomUUID();
        store.insert(id, tenantId, actor, title, materialText, result);
        return new CompletedTask(id, "COMPLETED", result);
    }
}
