package com.dreamcore.workspace.material;

import com.dreamcore.workspace.identity.IdentityException;
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class LocalObjectStore implements ObjectStore {
    private final String configuredRoot;
    private final long maxBytes;
    public LocalObjectStore(@Value("${dreamcore.material.storage-root:}") String root,
                            @Value("${dreamcore.material.max-bytes:20971520}") long maxBytes) {
        this.configuredRoot=root; this.maxBytes=maxBytes;
        if (maxBytes<1 || maxBytes>67108864) throw new IllegalArgumentException("Material size limit must be 1..64 MiB");
    }
    private synchronized Path root() throws IOException {
        if (configuredRoot.isBlank()) throw unavailable();
        Path root=Path.of(configuredRoot).toAbsolutePath().normalize();
        if (Files.isSymbolicLink(root)) throw unavailable();
        if (!Files.exists(root)) Files.createDirectories(root,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
        if (!Files.isDirectory(root,LinkOption.NOFOLLOW_LINKS) || !Files.getPosixFilePermissions(root).equals(PosixFilePermissions.fromString("rwx------"))) throw unavailable();
        return root;
    }
    private static IdentityException unavailable() { return new IdentityException(503,"MATERIAL_STORAGE_UNAVAILABLE"); }
    @Override public UUID put(byte[] bytes) {
        if (bytes.length>maxBytes) throw new IdentityException(413,"MATERIAL_TOO_LARGE");
        Path temporary=null;
        try {
            Path root=root(); UUID id=UUID.randomUUID();
            temporary=Files.createTempFile(root,".upload-",".part",PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
            try (var channel=java.nio.channels.FileChannel.open(temporary,StandardOpenOption.WRITE)) {
                var buffer=java.nio.ByteBuffer.wrap(bytes); while(buffer.hasRemaining()) channel.write(buffer); channel.force(true);
            }
            Files.move(temporary,root.resolve(id+".blob"),StandardCopyOption.ATOMIC_MOVE);
            return id;
        } catch(IOException error) { throw unavailable(); }
        finally { if(temporary!=null) try { Files.deleteIfExists(temporary); } catch(IOException ignored) { /* private staged orphan; never published */ } }
    }
    @Override public byte[] read(UUID id, long expectedSize, String hash) {
        try {
            Path file=root().resolve(id+".blob");
            if (expectedSize<0 || expectedSize>67108864 || !Files.isRegularFile(file,LinkOption.NOFOLLOW_LINKS) || Files.size(file)!=expectedSize) throw unavailable();
            try(var input=Files.newInputStream(file,LinkOption.NOFOLLOW_LINKS)) {
                byte[] bytes=input.readNBytes((int)expectedSize+1);
                if(bytes.length!=expectedSize || !ObjectStore.sha256(bytes).equals(hash)) throw unavailable();
                return bytes;
            }
        } catch(IOException error) { throw unavailable(); }
    }
    @Override public void discard(UUID id) {
        try { Files.deleteIfExists(root().resolve(id+".blob")); }
        catch(IOException ignored) { /* rollback orphan has no readable database reference */ }
    }
}
