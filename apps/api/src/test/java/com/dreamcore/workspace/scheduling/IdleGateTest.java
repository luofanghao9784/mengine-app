package com.dreamcore.workspace.scheduling;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class IdleGateTest {
    @Test
    void emptyPassesBackOffWithoutBlockingAndWorkResumesImmediately() {
        IdleGate gate = new IdleGate();
        assertFalse(gate.resting(1_000));
        gate.rest(1_000);
        assertTrue(gate.resting(1_000 + 14_999));
        assertFalse(gate.resting(1_000 + 15_000));
        gate.rest(1_000 + 15_000);
        assertTrue(gate.resting(1_000 + 15_000 + 59_999));
        assertFalse(gate.resting(1_000 + 15_000 + 60_000));
        gate.work();
        assertFalse(gate.resting(1_000 + 15_000 + 60_000));
    }
}
