package com.dreamcore.workspace.departure;
import org.springframework.boot.autoconfigure.condition.*;import org.springframework.scheduling.annotation.*;import org.springframework.stereotype.Component;
@Component @EnableScheduling @ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(name="dreamcore.departure.worker-enabled",havingValue="true",matchIfMissing=true)
public class DepartureWorker {
 private final DepartureProcessor processor;public DepartureWorker(DepartureProcessor processor){this.processor=processor;}
 @Scheduled(fixedDelayString="${dreamcore.departure.poll-ms:5000}",initialDelayString="${dreamcore.departure.initial-delay-ms:30000}")public void tick(){for(var id:processor.candidates())try{processor.process(id);}catch(Exception e){processor.failed(id);}}
}
