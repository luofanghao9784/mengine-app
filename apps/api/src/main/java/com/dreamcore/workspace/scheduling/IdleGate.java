package com.dreamcore.workspace.scheduling;

/** In-memory pause for one idle scheduled worker. The caller returns immediately and never sleeps the scheduler thread. */
public final class IdleGate {
    private int idleStreak;
    private long resumeAt;

    public boolean resting(long now) {
        return now < resumeAt;
    }

    /** First empty pass waits 15 seconds. The next empty pass waits 60 seconds. */
    public void rest(long now) {
        restEscalating(now, 15_000L, 60_000L);
    }

    /** Empty-pass backoff that escalates from firstMs to nextMs after the first quiet pass. */
    public void restEscalating(long now, long firstMs, long nextMs) {
        idleStreak++;
        resumeAt = now + Math.max(0L, idleStreak >= 2 ? nextMs : firstMs);
    }

    public void work() {
        idleStreak = 0;
        resumeAt = 0L;
    }
}
