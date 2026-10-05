package com.dreamcore.workspace.conversation;
import java.util.*;
import java.io.*;
import javax.imageio.ImageIO;
/** Raster bytes only: browser never contacts a publisher or interprets HTML/SVG. */
public final class NewsImage {
 public record Image(String url,String contentType,String base64) {}
 public record Cover(String dataUrl,String sourceUrl,String sourceTitle) {}
 public static boolean valid(Image image){
  try{
   if(image==null||image.url()==null||image.url().length()>2048||image.base64()==null||image.base64().length()>174764||!Set.of("image/jpeg","image/png").contains(image.contentType()))return false;
   var u=java.net.URI.create(image.url());if(!"https".equals(u.getScheme())||u.getHost()==null||u.getUserInfo()!=null||u.getFragment()!=null)return false;
   byte[] bytes=Base64.getDecoder().decode(image.base64());if(bytes.length==0||bytes.length>131072||!Base64.getEncoder().encodeToString(bytes).equals(image.base64()))return false;
   try(var input=ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))){var readers=ImageIO.getImageReaders(input);if(!readers.hasNext())return false;var reader=readers.next();try{reader.setInput(input,true,true);var format=reader.getFormatName().toLowerCase();return ((image.contentType().equals("image/jpeg")&&Set.of("jpeg","jpg").contains(format))||(image.contentType().equals("image/png")&&format.equals("png")))&&reader.getWidth(0)>0&&reader.getHeight(0)>0&&(long)reader.getWidth(0)*reader.getHeight(0)<=8000000;}finally{reader.dispose();}}
  }catch(Exception e){return false;}
 }
}
