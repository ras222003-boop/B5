import { readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const taxonomyPath = resolve(repo, 'ml/vision/taxonomy.v1.json');
export const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
export const hash = value => createHash('sha256').update(value).digest('hex');
export async function fileHash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
export const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
export const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const jsonHash = value => hash(JSON.stringify(value));
export async function writeJson(path, value) {
  // No silent overwrite of labels, splits, evidence or releases.
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
export function localPath(root, path) {
  requireValue(nonempty(path) && !isAbsolute(path) && !path.includes('\\') && !path.includes(':') &&
    !path.split('/').some(p => p === '..' || p === '.' || !p), `invalid relative path: ${path}`);
  const target = resolve(root, path), rel = relative(resolve(root), target);
  requireValue(rel && !rel.startsWith('..') && !isAbsolute(rel), 'path escapes data root');
  return target;
}
export async function checkedFile(root, path, expectedHash) {
  const target = localPath(root, path);
  const [base, actual] = await Promise.all([realpath(root), realpath(target)]);
  const rel = relative(base, actual);
  requireValue(rel && !rel.startsWith('..') && !isAbsolute(rel), 'symlink escapes data root');
  requireValue((await stat(actual)).isFile(), 'expected regular file');
  requireValue(sha(expectedHash) && await fileHash(actual) === expectedHash, `SHA-256 mismatch: ${path}`);
  return actual;
}
export function validBox(box) {
  return Array.isArray(box) && box.length === 4 && box.every(finite) && box[0] >= 0 && box[1] >= 0 &&
    box[2] > 0 && box[3] > 0 && box[0] + box[2] <= 1 && box[1] + box[3] <= 1;
}
export const asBox = ([x, y, width, height]) => ({ x, y, width, height });
