/** Create local test CA and a private-IP TLS certificate. Does not install trust or change a firewall. */
import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import {resolve,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {isPrivateIPv4,certificateOutputAllowed} from './network-policy.mjs';
const args=process.argv.slice(2),value=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const output=value('--output'),ip=value('--ip'),openssl=value('--openssl');
if(!output||!isPrivateIPv4(ip??'')||!openssl||!isAbsolute(openssl))throw new Error('Use --output new-private-directory --ip valid-private-IPv4 --openssl absolute-openssl-path');
const folder=resolve(output),repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
if(!certificateOutputAllowed(folder,repository))throw new Error('Certificate keys must stay outside the Git repository and protected data');
try{await access(folder);throw new Error('Certificate output must be a new private directory');}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir(folder,{recursive:true});
await writeFile(resolve(folder,'root.cnf'),'[req]\ndistinguished_name=dn\nx509_extensions=v3_ca\nprompt=no\n[dn]\nCN=Basira Local Research CA\n[v3_ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n');
await writeFile(resolve(folder,'server.cnf'),`[req]\ndistinguished_name=dn\nreq_extensions=v3_req\nprompt=no\n[dn]\nCN=Basira Local Camera Lab\n[v3_req]\nsubjectAltName=@alt\n[alt]\nIP.1=${ip}\nIP.2=127.0.0.1\nDNS.1=localhost\n[server_cert]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\nsubjectAltName=@alt\n`);
const run=parts=>execFileSync(openssl,parts,{cwd:folder,stdio:'pipe',windowsHide:true});
run(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','root-key.pem','-out','root-ca.pem','-days','7','-sha256','-config','root.cnf']);
run(['req','-new','-newkey','rsa:2048','-nodes','-keyout','server-key.pem','-out','server.csr','-config','server.cnf']);
run(['x509','-req','-in','server.csr','-CA','root-ca.pem','-CAkey','root-key.pem','-CAcreateserial','-out','server-cert.pem','-days','7','-sha256','-extfile','server.cnf','-extensions','server_cert']);
run(['x509','-in','root-ca.pem','-outform','DER','-out','basira-local-root.cer']);
run(['verify','-CAfile','root-ca.pem','server-cert.pem']);
await writeFile(resolve(folder,'server-chain.pem'),Buffer.concat([await readFile(resolve(folder,'server-cert.pem')),await readFile(resolve(folder,'root-ca.pem'))]));
console.log(JSON.stringify({directory:folder,certificate:resolve(folder,'server-chain.pem'),key:resolve(folder,'server-key.pem'),rootCertificate:resolve(folder,'basira-local-root.cer'),expiresInDays:7,certificateChainVerified:true,trustInstalled:false,firewallChanged:false}));
