package com.dreamcore.workspace.knowledge;
import java.util.List;
/** Replaceable execution boundary. Originals, versions and authorization belong to the platform. */
public interface DocumentParser {
    record Fragment(String locator,String content,String method) {}
    record Structured(String state,String reason,List<String> columns,List<List<String>> rows,List<String> types) {}
    record Result(String parserVersion,String status,List<String> warnings,List<Fragment> chunks,Structured structured) {
        public Result(String parserVersion,String status,List<String> warnings,List<Fragment> chunks){this(parserVersion,status,warnings,chunks,null);}
    }
    Result parse(String filename,byte[] original);
}
