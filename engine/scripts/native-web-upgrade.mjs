import {request} from 'node:http';
/** Auth must finish before calling this carrier. Own both upgraded sockets so
 * revocation and shutdown cannot leave an authenticated channel running. */
export function upgrade(req,socket,head,url,headers,sockets){
 sockets.add(socket);socket.once('close',()=>sockets.delete(socket));
 const upstream=request(url,{method:'GET',headers});
 upstream.once('upgrade',(response,peer,initial)=>{
  sockets.add(peer);peer.once('close',()=>sockets.delete(peer));
  socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n`+Object.entries(response.headers).filter(([k])=>k!=='set-cookie').map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');
  if(initial.length)socket.write(initial);if(head.length)peer.write(head);
  socket.pipe(peer);peer.pipe(socket);socket.once('error',()=>peer.destroy());peer.once('error',()=>socket.destroy());socket.once('close',()=>peer.destroy());peer.once('close',()=>socket.destroy());
 });
 upstream.once('response',()=>socket.destroy());upstream.once('error',()=>socket.destroy());socket.once('close',()=>upstream.destroy());upstream.end();
}
