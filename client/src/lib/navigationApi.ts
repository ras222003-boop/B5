import type { Building, Floor, MapEdge, MapNode, Place, SavedPlace } from '@shared/navigation';

export async function navigationRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/navigation${path}`, {
    credentials: 'include',
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  if (!response.ok) throw new Error(response.status === 401 ? 'sign_in_required' : response.status === 403 ? 'mapper_role_required' : 'request_failed');
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
export type SearchResult = { kind: 'place' | 'saved'; priority: number; item: Place | SavedPlace };
export type BuildingGraph = { building: Building; nodes: MapNode[]; edges: MapEdge[] };
export const navApi = {
  buildings: (q = '') => navigationRequest<{buildings: Building[]}>(`/buildings?q=${encodeURIComponent(q)}`),
  building: (id: string) => navigationRequest<{building: Building}>(`/buildings/${id}`),
  floors: (id: string) => navigationRequest<{floors: Floor[]}>(`/buildings/${id}/floors`),
  places: (id: string, q = '') => navigationRequest<{places: Place[]}>(`/buildings/${id}/places?q=${encodeURIComponent(q)}`),
  graph: (id: string) => navigationRequest<BuildingGraph>(`/buildings/${id}/graph`),
  search: (q: string, currentBuildingId?: string | null, includeOthers = false) => navigationRequest<{results: SearchResult[]}>(`/search?q=${encodeURIComponent(q)}&currentBuildingId=${encodeURIComponent(currentBuildingId ?? '')}&includeOtherBuildings=${includeOthers}`),
  saved: (filter: 'all' | 'favorites' | 'recent' = 'all', q = '') => navigationRequest<{savedPlaces: SavedPlace[]}>(`/saved-places?filter=${filter}&q=${encodeURIComponent(q)}`),
  access: () => navigationRequest<{userId: string | null; role: string | null}>('/access'),
};
