package com.dreamcore.workspace.qualityops;

import java.util.ArrayList;
import org.springframework.stereotype.Component;

@Component
public class RuleQualityCheckEngine implements QualityCheckEngine {
    @Override public Result check(String materialText) {
        var issues = new ArrayList<Issue>();
        materialText.lines().map(String::strip).forEach(line -> {
            if (line.startsWith("问题：") || line.startsWith("问题:")) {
                String message = line.substring(3).strip();
                if (!message.isBlank()) issues.add(new Issue(message));
            }
        });
        return new Result(issues.isEmpty() ? Verdict.NO_ISSUES : Verdict.ISSUES_FOUND, issues);
    }
}
