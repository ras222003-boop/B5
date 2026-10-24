import {isIP} from 'node:net';
import {resolve,relative,isAbsolute,sep} from 'node:path';
export function isPrivateIPv4(host){
  if(isIP(host)!==4)return false;
  const[a,b]=host.split('.').map(Number);
  return a===10||(a===192&&b===168)||(a===172&&b>=16&&b<=31);
}
export function certificateOutputAllowed(folder,repository){
  const destination=resolve(folder),repo=resolve(repository),path=relative(repo,destination);
  if(path===''||(!path.startsWith(`..${sep}`)&&path!=='..'&&!isAbsolute(path)))return false;
  return !destination.split(/[\\/]/).some(part=>['.git','basira-vision-datasets'].includes(part.toLowerCase()));
}
