/**
 * A single process-wide browser XR camera owner shared by Basira AR labs.
 * This lock only coordinates Basira labs; it cannot control native camera apps.
 */
let currentOwner: string | null = null;

export function reserveBasiraArCamera(owner: string): boolean {
  if (!owner.trim() || currentOwner !== null) return false;
  currentOwner = owner;
  return true;
}

export function releaseBasiraArCamera(owner: string): void {
  if (currentOwner === owner) currentOwner = null;
}

export function getBasiraArCameraOwner(): string | null {
  return currentOwner;
}
