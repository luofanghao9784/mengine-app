package com.dreamcore.workspace.knowledge;
import java.util.List;
/** Replaceable execution boundary. Originals, versions and authorization belong to the platform. */
public interface DocumentParser {
    record Fragment(String locator,String content,String method) {}
    record Result(String parserVersion,String status,List<String> warnings,List<Fragment> chunks) {}
    Result parse(String filename,byte[] original);
}
