package com.dreamcore.workspace.experience;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Discovery alone does not invoke a model, admit experience, or upload enterprise content. */
@Component
public class ExperienceIntakeWorker {
 private final ExperienceIntakeService intake; private final boolean enabled;
 public ExperienceIntakeWorker(ExperienceIntakeService intake,@Value("${dreamcore.experience-intake.enabled:false}") boolean enabled){this.intake=intake;this.enabled=enabled;}
 @Scheduled(fixedDelayString="${dreamcore.experience-intake.scan-ms:30000}",initialDelayString="${dreamcore.experience-intake.initial-delay-ms:30000}")
 public void scan(){if(enabled)intake.discover();}
}
