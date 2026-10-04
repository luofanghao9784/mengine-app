package com.dreamcore.workspace.support;
import java.util.UUID;
/** Authorization subject and actual operator are deliberately distinct. Never replace Authentication. */
public final class SupportContext {
 public record Access(UUID id,UUID actor,UUID tenant,UUID owner,String mode,String name) {}
 private static final ThreadLocal<Access> CURRENT=new ThreadLocal<>();
 public static Access current(){return CURRENT.get();}
 public static void set(Access access){if(access==null)CURRENT.remove();else CURRENT.set(access);}
 private SupportContext(){}
}
