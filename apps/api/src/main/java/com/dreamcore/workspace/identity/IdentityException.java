package com.dreamcore.workspace.identity;

public final class IdentityException extends RuntimeException {
    public final int status;
    public final String code;
    public IdentityException(int status, String code) {
        super(code);
        this.status = status;
        this.code = code;
    }
    public static IdentityException invalid() { return new IdentityException(400, "INVALID_REQUEST"); }
    public static IdentityException denied() { return new IdentityException(403, "ACCESS_DENIED"); }
    public static IdentityException conflict() { return new IdentityException(409, "STATE_CONFLICT"); }
}
