package com.dreamcore.workspace.context;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Governance wording is advisory context for briefings only. These tests pin three behaviours that
 * matter operationally: it reaches the model when a release exists, it degrades quietly when it does
 * not, and an UNKNOWN column is still passed through instead of being blocked.
 */
@SpringBootTest(properties = {"dreamcore.tasks.initial-delay-ms=3600000", "dreamcore.knowledge.initial-delay-ms=3600000"})
class GovernedFieldContextTest {
    @Autowired JdbcTemplate db;

    UUID tenant;
    UUID owner;
    UUID other;
    UUID dataset;

    @BeforeEach
    void fixture() {
        tenant = UUID.randomUUID();
        owner = UUID.randomUUID();
        other = UUID.randomUUID();
        dataset = UUID.randomUUID();
        for (UUID actor : List.of(owner, other)) {
            db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES(?,?,?,?)",
                actor, actor + "@example.test", "口径测试账号", "unused-test-hash");
        }
        db.update("INSERT INTO tenants(id,name) VALUES(?,'口径测试企业')", tenant);
    }

    private void release(UUID recipient, UUID target, String fieldsJson) {
        db.update(
            "INSERT INTO native_governance_releases(id,tenant_id,recipient_id,fingerprint,package) VALUES(?,?,?,?,CAST(? AS jsonb))",
            UUID.randomUUID(), tenant, recipient, "test-fingerprint-" + UUID.randomUUID(),
            "{\"contractVersion\":\"1.0\",\"items\":[{\"datasetId\":\"" + target + "\",\"token\":\"t1\","
                + "\"fields\":" + fieldsJson + ",\"knowledge\":\"k\",\"evidence\":[\"e\"]}]}");
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> fields(Map<String, Object> context) {
        return (List<Map<String, Object>>) context.get("fields");
    }

    @Test
    void injectsConfirmedWordingForVisibleColumnsOnly() {
        release(owner, dataset, """
            [{"column":"收款金额","type":"numeric","meaning":"门店收款合计，单位为分","unit":"分","evidence":"结构证据","status":"SOURCE_DOCUMENTED"},
             {"column":"门店","type":"text","meaning":"收款的归属门店","unit":"","evidence":"结构证据","status":"SOURCE_DOCUMENTED"},
             {"column":"未展示列","type":"text","meaning":"不应出现在当前分页里","unit":"","evidence":"结构证据","status":"SOURCE_DOCUMENTED"}]
            """);

        Map<String, Object> context = GovernedFieldContext.load(db, tenant, owner, dataset, List.of("收款金额", "门店"));

        assertEquals("NATIVE_GOVERNANCE_RELEASE", context.get("source"));
        assertEquals(false, context.get("authority"));
        assertNotNull(context.get("releasedAt"));
        assertTrue(String.valueOf(context.get("usage")).contains("不改变计算规则"));
        assertEquals(2, fields(context).size(), "只注入当前分页可见的列");
        Map<String, Object> amount = fields(context).stream().filter(f -> "收款金额".equals(f.get("column"))).findFirst().orElseThrow();
        assertEquals("门店收款合计，单位为分", amount.get("meaning"));
        assertEquals("分", amount.get("unit"));
        assertEquals("SOURCE_DOCUMENTED", amount.get("status"));
    }

    @Test
    void degradesToNotGovernedWithoutRelease() {
        Map<String, Object> context = GovernedFieldContext.load(db, tenant, owner, dataset, List.of("收款金额"));

        assertEquals("NONE", context.get("source"));
        assertEquals(false, context.get("authority"));
        assertFalse(context.containsKey("fields"), "无治理数据时不注入字段列表");
        assertTrue(String.valueOf(context.get("usage")).contains("尚未发布治理口径"));
    }

    @Test
    void keepsUnconfirmedColumnsAdvisoryInsteadOfBlockingThem() {
        release(owner, dataset, """
            [{"column":"收款状态","type":"text","meaning":"原始状态含义尚未确认","unit":"","evidence":"存在冲突","status":"UNKNOWN"}]
            """);

        Map<String, Object> context = GovernedFieldContext.load(db, tenant, owner, dataset, List.of("收款状态"));

        assertEquals("NATIVE_GOVERNANCE_RELEASE", context.get("source"));
        assertEquals(1, fields(context).size(), "UNKNOWN 列仍然注入，由模型在解读时说明");
        assertEquals("UNKNOWN", fields(context).getFirst().get("status"));
        assertTrue(String.valueOf(context.get("usage")).contains("不得因此拒绝计算"));
    }

    @Test
    void ignoresReleasesPublishedToAnotherRecipient() {
        release(other, dataset, """
            [{"column":"收款金额","type":"numeric","meaning":"他人可见的口径","unit":"分","evidence":"e","status":"SOURCE_DOCUMENTED"}]
            """);

        assertEquals("NONE", GovernedFieldContext.load(db, tenant, owner, dataset, List.of("收款金额")).get("source"));
        assertEquals("NATIVE_GOVERNANCE_RELEASE", GovernedFieldContext.load(db, tenant, other, dataset, List.of("收款金额")).get("source"));
    }

    @Test
    void toleratesReleaseWithoutUsableFields() {
        release(owner, dataset, "[]");
        assertEquals("NONE", GovernedFieldContext.load(db, tenant, owner, dataset, List.of("收款金额")).get("source"));

        release(owner, UUID.randomUUID(), """
            [{"column":"收款金额","type":"numeric","meaning":"别的数据集","unit":"分","evidence":"e","status":"SOURCE_DOCUMENTED"}]
            """);
        assertEquals("NONE", GovernedFieldContext.load(db, tenant, owner, dataset, List.of("收款金额")).get("source"));
    }
}
