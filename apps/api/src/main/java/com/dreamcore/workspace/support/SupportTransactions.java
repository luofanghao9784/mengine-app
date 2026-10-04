package com.dreamcore.workspace.support;
import javax.sql.DataSource;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.transaction.TransactionDefinition;
/** The same database transaction captures safe before/after states and test provenance. */
@Configuration public class SupportTransactions {
 @Bean public JdbcTransactionManager transactionManager(DataSource source){return new JdbcTransactionManager(source){
  @Override protected void prepareTransactionalConnection(java.sql.Connection connection,TransactionDefinition definition)throws java.sql.SQLException{
   super.prepareTransactionalConnection(connection,definition);var a=SupportContext.current();if(a==null)return;
   try(var statement=connection.prepareStatement("SELECT set_config('dreamcore.support_access',?,true)")){
    statement.setString(1,a.id().toString());statement.execute();
   }
  }
 };}
}
