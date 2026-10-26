package com.dreamcore.workspace;

import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.UUID;
import org.springframework.test.context.DynamicPropertyRegistry;

/** Global queue and platform lifecycle tests need a fresh database, not shared fixture rows. */
final class IsolatedTestDatabase {
    private IsolatedTestDatabase() {}

    static void register(DynamicPropertyRegistry registry) {
        String base=System.getenv("DATABASE_URL"),user=System.getenv("DATABASE_USER"),password=System.getenv("DATABASE_PASSWORD");
        // Only the repository-owned disposable cluster may create test databases. Never fall back to a live database.
        if(base==null || !base.matches("jdbc:postgresql://127\\.0\\.0\\.1:[0-9]+/dreamcore_test")
            || !"dreamcore_test".equals(user) || password==null) {
            throw new IllegalStateException("Isolated integration tests require scripts/with-test-postgres.py");
        }
        String database="dreamcore_isolated_test_"+UUID.randomUUID().toString().replace("-","");
        try(var connection=DriverManager.getConnection(base,user,password);var statement=connection.createStatement()) {
            try(var identity=statement.executeQuery("SELECT current_database(),current_user")) {
                if(!identity.next() || !"dreamcore_test".equals(identity.getString(1)) || !"dreamcore_test".equals(identity.getString(2))) {
                    throw new IllegalStateException("Disposable test database identity did not match");
                }
            }
            statement.execute("CREATE DATABASE "+database);
        } catch(SQLException failure) {
            throw new IllegalStateException("Could not create isolated test database in the disposable cluster",failure);
        }
        // Flyway migrates a fresh public schema. The wrapper owns and removes this entire temporary cluster.
        String url=base.substring(0,base.lastIndexOf('/')+1)+database;
        registry.add("spring.datasource.url",()->url);
    }
}
