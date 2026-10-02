import type { Lang } from "./config";

/**
 * Turns the Arabic source dictionary into the structural contract that the
 * English and Chinese dictionaries must satisfy: same keys, same nesting,
 * same array shapes and the same interpolation function signatures.
 */
export type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => string
    ? (...args: A) => string
    : T extends readonly (infer U)[]
      ? readonly Widen<U>[]
      : T extends object
        ? { readonly [K in keyof T]: Widen<T[K]> }
        : T;

export type Messages<T> = Record<Lang, Widen<T>>;

/**
 * Declare one translation namespace. The Arabic object is the source of
 * truth; TypeScript rejects missing or extra keys in `en` and `zh-CN`.
 */
export function defineMessages<T extends object>(messages: { ar: T; en: Widen<T>; "zh-CN": Widen<T> }): Messages<T> {
  return messages as Messages<T>;
}
