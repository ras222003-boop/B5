import { execFileSync } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateSource } from './data.mjs';
import { checkedFile, localPath, requireValue as check, nonempty } from './common.mjs';

/** Explicit team/licensed source only. FFmpeg/ffprobe are local prerequisites; nothing is downloaded. */
export async function extractFrames(record, root, relativeOutput, runProcess = execFileSync) {
  await validateSource(record.source, root);
  check(nonempty(record.leakageGroup) && nonempty(record.video?.id) &&
    Number.isSafeInteger(record.stride) && record.stride > 0, 'video id, leakageGroup and positive frame stride required');
  const input = await checkedFile(root, record.video.path, record.video.sha256);
  const timestamps = JSON.parse(runProcess('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames',
    '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', input], { maxBuffer: 100 * 1024 * 1024 })).frames
    .filter((_, i) => i % record.stride === 0).map(f => Number(f.best_effort_timestamp_time) * 1000);
  check(timestamps.length > 0 && timestamps.every((v, i) => Number.isFinite(v) && v >= 0 && (!i || v > timestamps[i - 1])), 'valid monotonic video presentation timestamps required');
  const output = localPath(root, relativeOutput); await mkdir(output);
  runProcess('ffmpeg', ['-v', 'error', '-nostdin', '-n', '-i', input, '-map', '0:v:0', '-vf',
    `select=not(mod(n\\,${record.stride}))`, '-fps_mode', 'vfr', '-map_metadata', '-1', '-start_number', '0',
    resolve(output, 'frame-%06d.png')], { stdio: ['ignore', 'ignore', 'pipe'] });
  const files = (await readdir(output)).filter(f => /^frame-\d{6}\.png$/.test(f)).sort();
  check(files.length === timestamps.length, 'frame/timestamp count mismatch; inspect incomplete extraction');
  return { schemaVersion: 1, id: `basira-${record.video.id}`, sources: [record.source],
    samples: files.map((f, i) => ({ id: `${record.video.id}-${i}`, path: `${relativeOutput}/${f}`, sourceId: record.source.id,
      leakageGroup: record.leakageGroup, conditions: record.conditions, hardNegatives: [],
      media: { kind: 'video_frame', video: record.video, timestampMs: timestamps[i] } })) };
}
