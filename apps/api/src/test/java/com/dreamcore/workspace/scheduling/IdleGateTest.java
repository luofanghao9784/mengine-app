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

    @Test
    void escalatingRestUsesCallerDelaysWithoutBlocking() {
        IdleGate gate = new IdleGate();
        gate.restEscalating(5_000, 120_000L, 300_000L);
        assertTrue(gate.resting(5_000 + 119_999));
        assertFalse(gate.resting(5_000 + 120_000));
        gate.restEscalating(5_000 + 120_000, 120_000L, 300_000L);
        assertTrue(gate.resting(5_000 + 120_000 + 299_999));
        assertFalse(gate.resting(5_000 + 120_000 + 300_000));
    }
}
