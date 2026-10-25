import {resolve} from 'node:path';
import {registerCompletion,listRegistered,scanCompletions,defaultRegistry} from './registry.mjs';
const check=(value,message)=>{if(!value)throw new Error(message);};

  const args=process.argv.slice(2),command=args[0],value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  const options={root:value('--registry')??process.env.BASIRA_EXPERIMENTAL_MODELS_ROOT??defaultRegistry,python:value('--python')};
  if(command==='register')console.log(JSON.stringify(await registerCompletion(args[1],options)));
  else if(command==='list')console.log(JSON.stringify(await listRegistered(options.root)));
  else if(command==='watch'){
    check(value('--inbox'),'--inbox required');let previous='';let running=false;
    const scan=async()=>{if(running)return;running=true;try{const results=await scanCompletions(resolve(value('--inbox')),options),serialized=JSON.stringify(results);if(serialized!==previous){console.log(serialized);previous=serialized;}}finally{running=false;}};
    await scan();setInterval(()=>void scan().catch(e=>console.error(e.message)),5000);
  }else throw new Error('Use register <completion.json>, list, or watch --inbox <directory> [--registry path] [--python path]');
