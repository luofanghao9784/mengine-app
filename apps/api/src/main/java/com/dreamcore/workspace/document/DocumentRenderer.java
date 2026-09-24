package com.dreamcore.workspace.document;

import com.dreamcore.workspace.identity.IdentityException;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.Semaphore;
import java.util.zip.*;
import org.apache.pdfbox.pdmodel.*;
import org.apache.fontbox.ttf.TTFParser;
import org.apache.fontbox.ttf.TTFSubsetter;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.springframework.stereotype.Component;

/** Bounded, offline text export. No HTML renderer, remote resources, or user-supplied templates. */
@Component
public class DocumentRenderer {
    public static final String VERSION="text-export-1.0.0";
    private final Semaphore slots=new Semaphore(2);
    public static String contentType(String format){return format.equals("pdf")?"application/pdf":"application/vnd.openxmlformats-officedocument.wordprocessingml.document";}
    public byte[] render(String title,String body,String format){
        DocumentService.validate(title,body);
        if(!slots.tryAcquire())throw new IdentityException(503,"DOCUMENT_EXPORT_BUSY");
        try{
            byte[] bytes=switch(format){case "docx"->word(title,body);case "pdf"->pdf(title,body);default->throw IdentityException.invalid();};
            if(bytes.length>2097152)throw new IdentityException(413,"DOCUMENT_EXPORT_LIMIT");return bytes;
        }catch(IdentityException e){throw e;}catch(Exception e){throw new IdentityException(503,"DOCUMENT_EXPORT_UNAVAILABLE");}finally{slots.release();}
    }
    private record Paragraph(String text,int level) {}
    private List<Paragraph> paragraphs(String body){
        var result=new ArrayList<Paragraph>();
        for(String line:body.replace("\r\n","\n").replace('\r','\n').split("\n",-1)){
            int level=line.startsWith("### ")?3:line.startsWith("## ")?2:line.startsWith("# ")?1:0;
            result.add(new Paragraph(level==0?line:line.substring(level+1),level));
        }return result;
    }
    private String xml(String s){return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;");}
    private String wordParagraph(String text,String style){
        return "<w:p><w:pPr><w:pStyle w:val=\""+style+"\"/></w:pPr><w:r><w:t xml:space=\"preserve\">"+xml(text)+"</w:t></w:r></w:p>";
    }
    private byte[] word(String title,String body)throws IOException {
        var parts=new LinkedHashMap<String,String>();
        parts.put("[Content_Types].xml","""
            <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/><Default Extension="txt" ContentType="text/plain"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>
            """);
        parts.put("_rels/.rels","<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>");
        parts.put("word/_rels/document.xml.rels","<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rIdStyles\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/><Relationship Id=\"rIdFonts\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable\" Target=\"fontTable.xml\"/></Relationships>");
        var content=new StringBuilder("<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>");
        content.append(wordParagraph(title,"Title"));for(var p:paragraphs(body))content.append(wordParagraph(p.text(),p.level()==0?"Normal":"Heading"+p.level()));
        content.append("<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1276\" w:right=\"1276\" w:bottom=\"1276\" w:left=\"1276\"/></w:sectPr></w:body></w:document>");
        parts.put("word/document.xml",content.toString());
        var styles=new StringBuilder("<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"Dreamcore Document Sans SC\" w:hAnsi=\"Dreamcore Document Sans SC\" w:eastAsia=\"Dreamcore Document Sans SC\"/><w:color w:val=\"000000\"/><w:sz w:val=\"22\"/><w:lang w:val=\"en-US\" w:eastAsia=\"zh-CN\"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after=\"120\" w:line=\"300\" w:lineRule=\"auto\"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/></w:style>");
        for(var style:new TreeMap<>(Map.of("Title",40,"Heading1",30,"Heading2",26,"Heading3",24)).entrySet())styles.append("<w:style w:type=\"paragraph\" w:styleId=\"").append(style.getKey()).append("\"><w:name w:val=\"").append(style.getKey()).append("\"/><w:basedOn w:val=\"Normal\"/><w:next w:val=\"Normal\"/><w:pPr><w:keepNext/><w:spacing w:before=\"180\" w:after=\"140\"/></w:pPr><w:rPr><w:color w:val=\"000000\"/><w:b/><w:sz w:val=\"").append(style.getValue()).append("\"/></w:rPr></w:style>");
        parts.put("word/styles.xml",styles.append("</w:styles>").toString());
        // OOXML font embedding; the fixed GUID is an obfuscation key, not a security secret.
        String key="{C3D90628-3658-4D43-82D7-8A12984E105F}";
        parts.put("word/fontTable.xml","<w:fonts xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><w:font w:name=\"Dreamcore Document Sans SC\"><w:family w:val=\"swiss\"/><w:embedRegular r:id=\"rIdFont\" w:fontKey=\""+key+"\" w:subsetted=\"true\"/></w:font></w:fonts>");
        parts.put("word/_rels/fontTable.xml.rels","<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rIdFont\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/font\" Target=\"fonts/regular.odttf\"/></Relationships>");
        byte[] font=wordFont(title+body),keyBytes=HexFormat.of().parseHex(key.replaceAll("[{}-]",""));
        for(int i=0;i<32;i++)font[i]^=keyBytes[15-i%16];
        var output=new ByteArrayOutputStream();
        try(var license=getClass().getResourceAsStream("/fonts/OFL.txt");var zip=new ZipOutputStream(output,StandardCharsets.UTF_8)){
            if(license==null)throw new IOException();
            for(var part:parts.entrySet())zipPart(zip,part.getKey(),part.getValue().getBytes(StandardCharsets.UTF_8));
            zipPart(zip,"word/fonts/regular.odttf",font);zipPart(zip,"word/fonts/OFL.txt",license.readAllBytes());
        }return output.toByteArray();
    }
    private void zipPart(ZipOutputStream zip,String name,byte[] bytes)throws IOException{var entry=new ZipEntry(name);entry.setTime(0);zip.putNextEntry(entry);zip.write(bytes);zip.closeEntry();}
    private byte[] wordFont(String text)throws IOException{
        try(var input=getClass().getResourceAsStream("/fonts/DreamcoreDocumentSansSC-Regular.ttf")){
            if(input==null)throw new IOException();
            try(var font=new TTFParser().parseEmbedded(input)){
                // FontBox emits the version-0 OS/2 fields; later source versions need this in-memory normalization.
                // Do not copy original glyph-indexed layout tables after renumbering a subset.
                font.getOS2Windows().setVersion(0);
                font.getOS2Windows().setFsSelection(font.getOS2Windows().getFsSelection() & 0x7f);
                var subset=new TTFSubsetter(font,List.of("head","hhea","maxp","OS/2","hmtx","cmap","loca","glyf","name","post"));var cmap=font.getUnicodeCmapLookup();
                // Keep only covered glyphs. Other scripts/emoji remain Unicode text for the reader's fallback.
                for(int cp:(text+" ").codePoints().toArray())if(cp<=0xffff && cmap.getGlyphId(cp)!=0)subset.add(cp);
                var output=new ByteArrayOutputStream();subset.writeToStream(output);return output.toByteArray();
            }
        }
    }

    private byte[] pdf(String title,String body)throws IOException {
        try(var document=new PDDocument();var input=getClass().getResourceAsStream("/fonts/DreamcoreDocumentSansSC-Regular.ttf")){
            if(input==null)throw new IOException();var font=PDType0Font.load(document,input,true);
            // Reject unsupported glyphs instead of silently replacing them with boxes or changing content.
            for(int c:(title+body).replace("\r","").replace("\n","").replace("\t"," ").codePoints().toArray())try{font.encode(new String(Character.toChars(c)));}catch(IllegalArgumentException e){throw new IdentityException(422,"DOCUMENT_EXPORT_GLYPH_UNSUPPORTED");}
            var writer=new PdfWriter(document,font);try{writer.paragraph(title,20,true);for(var p:paragraphs(body))writer.paragraph(p.text().replace("\t","    "),p.level()==0?11:16-p.level(),p.level()>0);}finally{writer.close();}
            document.getDocumentInformation().setTitle(title);document.getDocumentInformation().setProducer("Dreamcore "+VERSION);
            var output=new ByteArrayOutputStream();document.save(output);return output.toByteArray();
        }
    }
    private static class PdfWriter implements AutoCloseable {
        private final PDDocument document;private final PDType0Font font;private PDPageContentStream stream;private float y;
        private static final float LEFT=64,WIDTH=PDRectangle.A4.getWidth()-128,BOTTOM=64;
        PdfWriter(PDDocument document,PDType0Font font){this.document=document;this.font=font;}
        private void page()throws IOException {
            if(document.getNumberOfPages()>=100)throw new IdentityException(413,"DOCUMENT_EXPORT_LIMIT");if(stream!=null)stream.close();
            var page=new PDPage(PDRectangle.A4);document.addPage(page);stream=new PDPageContentStream(document,page);y=PDRectangle.A4.getHeight()-70;
            draw(Integer.toString(document.getNumberOfPages()),10,PDRectangle.A4.getWidth()/2,32);
        }
        private void draw(String text,float size,float x,float baseline)throws IOException{stream.beginText();stream.setFont(font,size);stream.newLineAtOffset(x,baseline);stream.showText(text);stream.endText();}
        void paragraph(String text,float size,boolean heading)throws IOException {
            float leading=size*1.65f;
            if(text.isEmpty()){if(stream==null)page();y-=9;return;}
            var lines=new ArrayList<String>();var line=new StringBuilder();float width=0;
            for(int cp:text.codePoints().toArray()){
                String ch=new String(Character.toChars(cp));float next=font.getStringWidth(ch)/1000*size;
                if(width+next>WIDTH && !line.isEmpty()){
                    int split=line.lastIndexOf(" ");String remainder="";
                    if(split>line.length()/2){remainder=line.substring(split+1);line.setLength(split);}
                    lines.add(line.toString());line.setLength(0);line.append(remainder);width=remainder.isEmpty()?0:font.getStringWidth(remainder)/1000*size;
                }
                line.append(ch);width+=next;
            }
            if(!line.isEmpty())lines.add(line.toString());
            if(stream==null || y<BOTTOM+leading*(heading?3:Math.min(2,lines.size()))+ (heading?8:0))page();
            if(heading)y-=8;
            for(int i=0;i<lines.size();i++){
                int remaining=lines.size()-i;
                if(y<BOTTOM+leading || (remaining==2 && y<BOTTOM+leading*2))page();
                draw(lines.get(i),size,LEFT,y);y-=leading;
            }
            y+=heading?0:-4;
        }

        public void close()throws IOException{if(stream!=null)stream.close();}
    }
}
