import { rangedAssetFetch } from "./ranged-fetch.mjs";
globalThis.fetch = rangedAssetFetch(
  globalThis.fetch.bind(globalThis),
  globalThis.location.origin,
  import.meta.env.BASE_URL
);
