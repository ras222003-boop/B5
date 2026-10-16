import test from 'node:test';import assert from 'node:assert/strict';
import {checkLocalRequest,localCookieName,readLocalCookie} from './local-http.mjs';
const origin='http://127.0.0.1:4318';
const request=(headers={},url='/',method='GET',remote='127.0.0.1')=>({headers:{host:'127.0.0.1:4318',...headers},url,method,socket:{remoteAddress:remote}});
const navigation={'sec-fetch-mode':'navigate','sec-fetch-dest':'document','sec-fetch-user':'?1'};
test('allows direct and same-origin local requests with exact Host and Origin',()=>{
 for(const site of [undefined,'none','same-origin'])assert.equal(checkLocalRequest(request({...site&&{'sec-fetch-site':site},origin}),origin).origin,origin);
});
test('allows user entry navigation from another port/site only to root',()=>{
 for(const site of ['same-site','cross-site'])assert.equal(checkLocalRequest(request({...navigation,'sec-fetch-site':site},'/?access=local-entry'),origin).pathname,'/');
});
test('entry exception never permits API, media, frames, background requests or mutations',()=>{
 for(const site of ['same-site','cross-site'])for(const url of ['/api/login','/api/catalog','/media/image/a','/entry.mjs','/styles.css'])assert.throws(()=>checkLocalRequest(request({...navigation,'sec-fetch-site':site},url),origin),/Cross-site/);
 for(const method of ['POST','PUT','DELETE','HEAD'])assert.throws(()=>checkLocalRequest(request({...navigation,'sec-fetch-site':'same-site'},'/',method),origin),/Cross-site/);
 for(const change of [{'sec-fetch-dest':'iframe'},{'sec-fetch-mode':'cors'},{'sec-fetch-user':undefined}])assert.throws(()=>checkLocalRequest(request({...navigation,'sec-fetch-site':'cross-site',...change}),origin),/Cross-site/);
});
test('Host, foreign/null Origin, remote sockets and absolute-form targets remain blocked',()=>{
 for(const headers of [{host:'localhost:4318'},{host:'evil.test:4318'},{origin:'http://127.0.0.1:4323'},{origin:'null'},{origin:'https://evil.test'}])assert.throws(()=>checkLocalRequest(request({...navigation,'sec-fetch-site':'cross-site',...headers}),origin),/Host|Cross-origin/);
 for(const remote of ['192.168.1.2','::ffff:192.168.1.2','::1'])assert.throws(()=>checkLocalRequest(request({},'/', 'GET',remote),origin),/Host/);
 for(const url of ['http://evil.test/','//evil.test/','/\\evil.test/'])assert.throws(()=>checkLocalRequest(request({},url),origin),/target/);
});
test('cookies have application/port namespaces and do not depend on header order',()=>{
 const studio=localCookieName('studio',4318),demo=localCookieName('demo',4323),value='a'.repeat(64),other='b'.repeat(64);
 assert.notEqual(studio,demo);assert.notEqual(localCookieName('demo',4322),demo);
 for(const header of [`${studio}=${value}; ${demo}=${other}`,`${demo}=${other}; ${studio}=${value}`]){assert.equal(readLocalCookie(header,studio),value);assert.equal(readLocalCookie(header,demo),other);}
 assert.equal(readLocalCookie(`${studio}=${value}; ${studio}=${other}`,studio),null);
 assert.equal(readLocalCookie(`basira_studio=${value}`,studio),null);
});
