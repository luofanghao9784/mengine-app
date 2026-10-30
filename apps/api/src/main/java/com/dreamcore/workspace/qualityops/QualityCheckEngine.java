package com.dreamcore.workspace.qualityops;

import java.util.List;

/** 同步材料检查端口；结果只描述本次材料，不代表正式质量认证。 */
public interface QualityCheckEngine {
    Result check(String materialText);

    enum Verdict { NO_ISSUES, ISSUES_FOUND }
    record Issue(String message) {
        public Issue {
            if (message == null || message.isBlank()) throw new IllegalArgumentException("Empty issue");
        }
    }
    record Result(Verdict verdict, List<Issue> issues) {
        public Result {
            issues = List.copyOf(issues);
            if (verdict == null || (verdict == Verdict.NO_ISSUES) != issues.isEmpty()) {
                throw new IllegalArgumentException("Inconsistent quality result");
            }
        }
    }
}
