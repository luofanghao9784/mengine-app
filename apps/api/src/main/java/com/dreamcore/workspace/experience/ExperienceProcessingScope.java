package com.dreamcore.workspace.experience;

import java.util.UUID;

/** Internal job metadata only; platform authorization and source grants are checked before dispatch.
 * Null never means an arbitrary tenant or all tenants. Only the explicit platform variant is tenant-free.
 */
final class ExperienceProcessingScope {
 private ExperienceProcessingScope() {}
 static boolean valid(UUID tenant,String scope) {
  return tenant!=null ? scope==null : "PLATFORM".equals(scope);
 }
}
