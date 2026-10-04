import type { SavedPlace } from '@shared/navigation';
import { navApi } from '@/lib/navigationApi';

/** Never resolve a private saved-place ID from session storage without rechecking the owner endpoint. */
export async function authorizedSavedPlace(id:string):Promise<SavedPlace|null>{
  try{return (await navApi.savedPlace(id)).savedPlace;}catch{return null;}
}
