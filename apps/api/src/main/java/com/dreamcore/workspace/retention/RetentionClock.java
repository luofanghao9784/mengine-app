package com.dreamcore.workspace.retention;
import java.time.Instant;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
/** Server clock, replaceable for controlled deadline tests. */
@Component public class RetentionClock {
 private final JdbcTemplate db;
 public RetentionClock(JdbcTemplate db){this.db=db;}
 public Instant now(){return db.queryForObject("SELECT clock_timestamp()",(r,n)->r.getTimestamp(1).toInstant());}
}
