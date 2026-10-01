package com.dreamcore.workspace.plans;
import java.time.Instant;
import org.springframework.stereotype.Component;
/** Injectable server clock. No public endpoint can move time. */
@Component public class PlanClock { public Instant now(){return Instant.now();} }
