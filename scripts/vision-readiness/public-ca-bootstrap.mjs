/** Public certificate ONLY. No media, app assets, keys, pairing secrets or writable endpoints. */
import http from 'node:http';
import {X509Certificate} from 'node:crypto';
export function publicCertificateHandler(bytes,hostHeader,onRead=()=>{}){
 return (req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  if(req.headers.host!==hostHeader||req.url!=='/basira-root.cer'){res.writeHead(404);res.end();return;}
  if(!['GET','HEAD'].includes(req.method)||req.headers['transfer-encoding']||Number(req.headers['content-length']??0)>0){res.writeHead(405);res.end();return;}
  onRead({type:'PUBLIC_CERTIFICATE_READ',atUtc:new Date().toISOString(),remoteAddress:req.socket?.remoteAddress??null,userAgent:req.headers['user-agent']?.slice(0,300)??null});
  res.writeHead(200,{'Content-Type':'application/x-x509-ca-cert','Content-Disposition':'attachment; filename="basira-local-root.cer"'});res.end(req.method==='HEAD'?undefined:bytes);
 };
}
export async function startPublicCertificate({bytes,host,port=4362,onRead}){
 if(bytes.length>65536||new X509Certificate(bytes).ca!==true)throw Error('Only a small public root CA certificate may be served');
 const server=http.createServer(publicCertificateHandler(bytes,`${host}:${port}`,onRead));
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,host,done);});
 return {url:`http://${host}:${port}/basira-root.cer`,close:()=>{server.closeAllConnections();return new Promise(done=>server.close(done));}};
}
