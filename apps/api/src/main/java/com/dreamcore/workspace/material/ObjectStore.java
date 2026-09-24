package com.dreamcore.workspace.material;

import java.util.UUID;
import java.security.MessageDigest;
import java.util.HexFormat;

/** Platform-owned immutable originals. Keys never leave the platform's persistence boundary. */
public interface ObjectStore {
    static String sha256(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    UUID put(byte[] bytes);
    byte[] read(UUID id, long expectedSize, String sha256);
    void discard(UUID id);
}
