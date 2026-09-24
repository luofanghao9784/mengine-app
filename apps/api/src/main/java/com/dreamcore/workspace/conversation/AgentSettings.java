package com.dreamcore.workspace.conversation;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
@Component
public record AgentSettings(String mode,boolean publicWebEnabled,boolean candidateTrialsEnabled) {
    public AgentSettings(@Value("${dreamcore.tasks.agent-mode:off}") String mode,@Value("${dreamcore.tasks.public-web-enabled:false}") boolean publicWebEnabled,@Value("${dreamcore.tasks.candidate-trials-enabled:false}") boolean candidateTrialsEnabled) {
        if(!Set.of("off","verification","live").contains(mode)) throw new IllegalArgumentException("Invalid agent mode");
        this.mode=mode;this.publicWebEnabled=publicWebEnabled;this.candidateTrialsEnabled=candidateTrialsEnabled;
        if(candidateTrialsEnabled && (!"verification".equals(mode) || !publicWebEnabled))throw new IllegalArgumentException("Candidate trials require verification and public web opt-in");
    }
    public boolean enabled(){return !mode.equals("off");}
}
