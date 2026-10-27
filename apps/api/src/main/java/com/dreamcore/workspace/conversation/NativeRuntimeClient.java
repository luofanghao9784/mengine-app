package com.dreamcore.workspace.conversation;

import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import com.dreamcore.workspace.identity.IdentityException;
import tools.jackson.databind.json.JsonMapper;

/** Only fixed operations cross this boundary. A browser can never choose an RPC method or model. */
@Service
public class NativeRuntimeClient {
 private final String url,controlToken;private final HttpClient http=HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(5)).build();
 private final JsonMapper json=new JsonMapper();
 public NativeRuntimeClient(@Value("${dreamcore.native.web-url:}") String url,@Value("${dreamcore.native.control-token:}") String controlToken){this.url=url;this.controlToken=controlToken;}
 public static class NotDispatched extends RuntimeException { public NotDispatched(){super("NATIVE_RUNTIME_NOT_DISPATCHED");} }
 public static boolean beforeConnect(Throwable error){
  for(Throwable e=error;e!=null;e=e.getCause())if(e instanceof java.net.ConnectException||e instanceof java.net.http.HttpConnectTimeoutException||e instanceof java.net.UnknownHostException)return true;
  return false;
 }
 public void available(){if(url.isBlank()||controlToken.length()<32)throw new IdentityException(503,"NATIVE_RUNTIME_UNAVAILABLE");}
 @SuppressWarnings("unchecked") public Map<String,Object> command(UUID id,String token,String action,Map<String,Object> body){
  available();
  try{
   var request=HttpRequest.newBuilder(URI.create(url.replaceAll("/+$","")+"/sdk/"+id+"/"+action)).timeout(Duration.ofSeconds(60)).header("Authorization","Bearer "+token).header("X-Dreamcore-Control",controlToken).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
   var response=http.send(request,HttpResponse.BodyHandlers.ofString());
   if(response.statusCode()!=200)throw new IdentityException(response.statusCode()==409?409:502,"NATIVE_RUNTIME_REJECTED");
   return json.readValue(response.body(),Map.class);
  }catch(IdentityException e){throw e;}catch(Exception e){if(e instanceof InterruptedException)Thread.currentThread().interrupt();if(beforeConnect(e))throw new NotDispatched();var failure=new IdentityException(502,"NATIVE_RUNTIME_UNAVAILABLE");failure.initCause(e);throw failure;}
 }
}
