package com.dreamcore.workspace.identity;

/** Platform endpoints now use IdentitySecurity's shared session and CSRF chain.
 * Their platform role is checked server-side independently of tenant membership. */
public final class PlatformSecurity {
    private PlatformSecurity() {}
}
