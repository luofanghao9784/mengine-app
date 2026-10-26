package com.dreamcore.workspace.collection;

import com.dreamcore.workspace.identity.IdentityService;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

class CollectionSourceContractsTest {
    UUID tenant=UUID.randomUUID(), dataset=UUID.randomUUID();
    List<String> columns=List.of("编号","金额");
    String scope="a".repeat(64);
    List<Map<String,Object>> entries=List.of(Map.of("column","金额","proof",List.of(Map.of("snippet","合成人民币元"))));
    List<Map<String,Object>> schema=List.of(Map.of("kind","value-rule","column","金额","type","DECIMAL","id","amount","nullable",true,"evidence","合成声明"));
    String body=new JsonMapper().writeValueAsString(Map.of("columns",columns,"scopeHash",scope,"entries",entries,"schema",schema));
    CollectionAdapter.SourceContract contract=new CollectionAdapter.SourceContract("1.0",tenant,dataset,1,IdentityService.hash(body),body);
    List<Map<String,Object>> pins=List.of(Map.of("kind","source-contract","definitionVersion",1,"definitionSha256",contract.definitionSha256()));
    boolean valid(CollectionAdapter.SourceContract c){return CollectionSourceContracts.valid(c,tenant,dataset,columns,scope,pins,entries,schema);}
    @Test void exactApprovedDefinitionAcceptedWithoutClaimingRowsPassed() {
        assertTrue(valid(contract));
        assertTrue(valid(null));
        assertTrue(CollectionSourceContracts.valid(null,tenant,dataset,columns,scope,List.of(),entries,schema));
        assertTrue(CollectionSourceContracts.valid(contract,tenant,dataset,columns,scope,List.of(),entries,schema));
        var failed=com.dreamcore.workspace.governance.DeclaredValueChecks.check(columns,List.of(List.of("0001","not-money")),schema);
        assertEquals("VIOLATIONS",failed.get("state"));
        assertEquals("CHECKED",com.dreamcore.workspace.governance.DeclaredValueChecks.check(columns,List.of(List.of("0001","9007199254740993.01")),schema).get("state"));
    }
    @Test void identityVersionHashScopeColumnsAndSemanticChangesAreRejected() {
        assertFalse(valid(new CollectionAdapter.SourceContract("1.0",UUID.randomUUID(),dataset,1,contract.definitionSha256(),body)));
        assertFalse(valid(new CollectionAdapter.SourceContract("1.0",tenant,UUID.randomUUID(),1,contract.definitionSha256(),body)));
        assertTrue(valid(new CollectionAdapter.SourceContract("1.0",tenant,dataset,2,contract.definitionSha256(),body)));
        assertFalse(valid(new CollectionAdapter.SourceContract("1.0",tenant,dataset,0,contract.definitionSha256(),body)));
        assertFalse(valid(new CollectionAdapter.SourceContract("2.0",tenant,dataset,1,contract.definitionSha256(),body)));
        assertFalse(valid(new CollectionAdapter.SourceContract("1.0",tenant,dataset,1,contract.definitionSha256(),body+" ")));
        assertFalse(CollectionSourceContracts.valid(contract,tenant,dataset,columns,"b".repeat(64),pins,entries,schema));
        assertFalse(CollectionSourceContracts.valid(contract,tenant,dataset,List.of("编号"),scope,pins,entries,schema));
        assertTrue(CollectionSourceContracts.valid(contract,tenant,dataset,columns,scope,pins,entries,List.of()));
        assertTrue(CollectionSourceContracts.valid(contract,tenant,dataset,columns,scope,List.of(pins.getFirst(),pins.getFirst()),entries,schema));
    }
    @Test void noRulesRemainsUnknownAndCannotBecomeBusinessValidation() {
        String unknown=new JsonMapper().writeValueAsString(Map.of("columns",columns,"scopeHash",scope,"entries",List.of(),"schema",List.of()));
        var c=new CollectionAdapter.SourceContract("1.0",tenant,dataset,1,IdentityService.hash(unknown),unknown);
        assertTrue(CollectionSourceContracts.valid(c,tenant,dataset,columns,scope,List.of(Map.of("definitionVersion",1,"definitionSha256",c.definitionSha256())),List.of(),List.of()));
        assertEquals("NOT_PROVIDED",com.dreamcore.workspace.governance.DeclaredValueChecks.check(columns,List.of(List.of("0001","unknown")),List.of()).get("state"));
    }
}
