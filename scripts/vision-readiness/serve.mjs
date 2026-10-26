/** Existing B5 app, loopback only; separate dev dependency cache avoids Vitest invalidating live imports. */
import {createServer} from 'vite';
import {resolve} from 'node:path';
const server=await createServer({cacheDir:resolve('.vision-ai/vite-readiness-cache'),server:{host:'127.0.0.1',port:4350,strictPort:true}});
await server.listen();server.printUrls();
const close=async()=>{await server.close();process.exit(0);};process.on('SIGINT',close);process.on('SIGTERM',close);
