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
        idleStreak++;
        resumeAt = now + (idleStreak >= 2 ? 60_000L : 15_000L);
    }

    public void work() {
        idleStreak = 0;
        resumeAt = 0L;
    }
}
