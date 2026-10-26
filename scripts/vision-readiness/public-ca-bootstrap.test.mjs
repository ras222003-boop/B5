import test from 'node:test';import assert from 'node:assert/strict';
import {publicCertificateHandler} from './public-ca-bootstrap.mjs';
test('public certificate bootstrap cannot serve keys, private pairing URLs, app assets or receive media',()=>{
 const handle=publicCertificateHandler(Buffer.from('public-certificate-only'),'192.168.1.2:4362');
 const run=(url,method='GET',host='192.168.1.2:4362')=>{const out={};const res={setHeader(){},writeHead:s=>out.status=s,end:b=>out.body=b};handle({url,method,headers:{host}},res);return out;};
 assert.equal(run('/basira-root.cer').status,200);assert.equal(run('/basira-root.cer','HEAD').body,undefined);
 for(const path of ['/server-key.pem','/phone-access.private.json','/navigation/vision','/../root-key.pem'])assert.equal(run(path).status,404);
 assert.equal(run('/basira-root.cer','POST').status,405);assert.equal(run('/basira-root.cer','GET','attacker.invalid').status,404);
});
