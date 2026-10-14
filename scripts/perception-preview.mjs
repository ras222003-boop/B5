/** Local-only preview: no API implementation, environment files, credentials or database. */
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import {vitePluginOnnxRuntimeRawAssets} from '../server/onnxRuntimeAssetPlugin.ts';
const root=path.resolve(import.meta.dirname,'..');
const server=await createServer({configFile:false,envFile:false,envDir:false,
  root:path.join(root,'client'),publicDir:path.join(root,'client/public'),
  resolve:{alias:{'@':path.join(root,'client/src'),'@shared':path.join(root,'shared')}},
  plugins:[vitePluginOnnxRuntimeRawAssets(),react(),tailwindcss(),{name:'isolated-no-api',configureServer(server){
    server.middlewares.use('/api',(req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      if(req.url?.startsWith('/auth/get-session')){res.end('null');return;}
      res.statusCode=503;res.end(JSON.stringify({code:'isolated_preview',message:'Cloud services and database are disabled in this local preview.'}));
    });
  }}],server:{host:'127.0.0.1',port:4186,strictPort:true,fs:{allow:[root]}}});
await server.listen();
console.log('Isolated Basira preview: http://127.0.0.1:4186/navigation/vision');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
