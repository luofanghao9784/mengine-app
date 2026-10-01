package com.dreamcore.workspace.objectlifecycle;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
/** Shared read/write guard; a lifecycle action never grants access to original content. */
@Component public class ObjectLifecycleGate {
 private final JdbcTemplate db;public ObjectLifecycleGate(JdbcTemplate db){this.db=db;}
 public boolean active(String kind,UUID id){return Boolean.TRUE.equals(db.queryForObject("SELECT object_is_active(?,?)",Boolean.class,kind,id));}
 public void requireActive(String kind,UUID id){if(!active(kind,id))throw new IdentityException(404,"OBJECT_CONTENT_UNAVAILABLE");}
 public void requireTaskActive(UUID id){requireActive("TASK",id);}
}
