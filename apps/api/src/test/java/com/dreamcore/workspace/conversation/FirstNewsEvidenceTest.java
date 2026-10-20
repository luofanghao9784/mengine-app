package com.dreamcore.workspace.conversation;
import static org.junit.jupiter.api.Assertions.*;
import com.dreamcore.workspace.identity.*;
import java.util.*;
import java.time.Instant;
import org.junit.jupiter.api.Test;
class FirstNewsEvidenceTest {
 String source="https://www.sport.gov.cn/index.html", url="https://www.sport.gov.cn/article.html";
 AgentResult.WebSource page(String u,Instant date,String hash){String text="产业报告正文，说明体育行业发展与经营机会，需要核实与本地门店的适用范围，不包含任何企业内部资料。";return new AgentResult.WebSource(UUID.randomUUID(),u,"体育产业报告",text,hash==null?IdentityService.hash(text):hash,Instant.now(),"PAGE",false,date);}
 FirstBriefingDeployment.NewsEvidence evidence(AgentResult.WebSource p){return new FirstBriefingDeployment.NewsEvidence(UUID.randomUUID(),List.of(url),List.of(p));}
 @Test void acceptsFreshOriginalFromSelectedDomain(){assertDoesNotThrow(()->FirstBriefingDeployment.validateNews(source,evidence(page(url,Instant.now(),null))));}
 @Test void rejectsUndiscoveredAndCrossDomain(){assertThrows(IdentityException.class,()->FirstBriefingDeployment.validateNews(source,evidence(page("https://other.example/article",Instant.now(),null))));assertThrows(IdentityException.class,()->FirstBriefingDeployment.validateNews(source,evidence(page("https://www.sport.gov.cn/other",Instant.now(),null))));}
 @Test void rejectsTamperedHash(){assertThrows(IdentityException.class,()->FirstBriefingDeployment.validateNews(source,evidence(page(url,Instant.now(),"bad"))));}
 @Test void rejectsStaleOrUndatedPage(){assertThrows(IdentityException.class,()->FirstBriefingDeployment.validateNews(source,evidence(page(url,Instant.now().minusSeconds(31L*86400),null))));assertThrows(IdentityException.class,()->FirstBriefingDeployment.validateNews(source,evidence(page(url,null,null))));}
}
