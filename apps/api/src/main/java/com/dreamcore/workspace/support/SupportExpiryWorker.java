package com.dreamcore.workspace.support;
import org.springframework.stereotype.Component;
import org.springframework.scheduling.annotation.Scheduled;
@Component public class SupportExpiryWorker {
 private final SupportAccess access;public SupportExpiryWorker(SupportAccess access){this.access=access;}
 @Scheduled(fixedDelay=15000,initialDelay=15000) public void expire(){access.expireDue();}
}
