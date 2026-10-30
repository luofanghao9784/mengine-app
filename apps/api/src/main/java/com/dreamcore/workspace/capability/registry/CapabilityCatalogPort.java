package com.dreamcore.workspace.capability.registry;

import java.util.List;
import java.util.UUID;

/** Read-only catalog. tenantId must already be resolved from the customer session. */
public interface CapabilityCatalogPort {
    List<EnterpriseFunction> listOpenedCapabilities(UUID tenantId);

    enum EnterpriseFunction {
        DOCUMENT_PARSE("document-parse", "文档解析"),
        TABLE_COMPARE("table-compare", "表格对比"),
        QUALITY_CHECK("quality-check", "质量检查"),
        SEMANTIC_ANNOTATION("semantic-annotation", "语义标注"),
        REPAIR_SUGGESTION("repair-suggestion", "修复建议");

        private final String code;
        private final String displayName;
        EnterpriseFunction(String code, String displayName) {
            this.code = code;
            this.displayName = displayName;
        }
        public String code() { return code; }
        public String displayName() { return displayName; }
    }
}
