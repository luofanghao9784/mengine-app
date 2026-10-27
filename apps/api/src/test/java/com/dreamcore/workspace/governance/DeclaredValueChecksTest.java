package com.dreamcore.workspace.governance;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import com.dreamcore.workspace.identity.IdentityException;

class DeclaredValueChecksTest {
    Map<String,Object> rule(String type,String column) {
        var r=new LinkedHashMap<String,Object>();r.put("kind","value-rule");r.put("id",column);r.put("column",column);
        r.put("type",type);r.put("nullable",true);r.put("evidence","合成来源已声明此字段的保存规则");return r;
    }
    @Test void signedPreciseMoneyDatesEnumsAndDisplayedStatusUseDeclaredRules() {
        var number=rule("DECIMAL","金额");var date=rule("DATE","日期");var category=rule("ENUM","方向");category.put("values",List.of("收","付"));
        var status=rule("PREFIX_DECIMAL","状态");status.put("prefix","待平账：");status.put("values",List.of("已收","已付"));
        var ordinal=rule("ORDINAL","期序");ordinal.put("prefix","第");ordinal.put("suffix","次");ordinal.put("values",List.of("缴纳押金"));
        var columns=List.of("金额","日期","方向","状态","期序");
        var valid=List.of(Arrays.asList("-9007199254740993.0000001","2026-10-26","收","待平账：+0","第3次"),Arrays.asList(null,null,"付","已付","缴纳押金"));
        assertEquals("CHECKED",DeclaredValueChecks.check(columns,valid,List.of(number,date,category,status,ordinal)).get("state"));
        var bad=List.of(List.of("NaN","2026-02-30","其他","到账","第0次"));
        var result=DeclaredValueChecks.check(columns,bad,List.of(number,date,category,status,ordinal));
        assertEquals("VIOLATIONS",result.get("state"));assertEquals(5L,result.get("violations"));
    }
    @Test void nullableAndColumnPresenceRemainMandatoryWithoutReintroducingProofGate() {
        var text=rule("TEXT","编号");text.put("nullable",false);
        assertEquals(2L,DeclaredValueChecks.check(List.of("编号"),List.of(Arrays.asList((String)null),List.of(" ")),List.of(text)).get("violations"));
        assertThrows(IdentityException.class,()->DeclaredValueChecks.check(List.of("其他"),List.of(List.of("1")),List.of(text)));
        // Source evidence authority is tracked separately; MODEL_DETERMINED rules can still execute.
        text.remove("evidence");assertEquals("CHECKED",DeclaredValueChecks.check(List.of("编号"),List.of(List.of("A")),List.of(text)).get("state"));
    }
}
