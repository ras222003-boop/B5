"""Run and resume the bounded, offline synthetic stairs proof of work.

No real dataset paths, official review records, production models, downloads, or
network services are used. Each interrupted attempt is retained for inspection.
"""
import argparse
import ctypes
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path


HERE = Path(__file__).resolve().parent


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def journal(root, stage, status, detail=None):
    event = {'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
             'stage': stage, 'status': status, 'detail': detail}
    with (root / 'journal.jsonl').open('a', encoding='utf-8') as stream:
        stream.write(json.dumps(event, ensure_ascii=False) + '\n')
        stream.flush()
        os.fsync(stream.fileno())


def tree_bytes(root):
    total = 0
    for folder, _, files in os.walk(root):
        for name in files:
            try:
                total += (Path(folder) / name).stat().st_size
            except FileNotFoundError:
                pass
    return total


def working_set_bytes(pid):
    if sys.platform != 'win32':
        return None
    size_t = ctypes.c_size_t

    class Counters(ctypes.Structure):
        _fields_ = [('cb', ctypes.c_ulong), ('PageFaultCount', ctypes.c_ulong),
                    ('PeakWorkingSetSize', size_t), ('WorkingSetSize', size_t),
                    ('QuotaPeakPagedPoolUsage', size_t), ('QuotaPagedPoolUsage', size_t),
                    ('QuotaPeakNonPagedPoolUsage', size_t), ('QuotaNonPagedPoolUsage', size_t),
                    ('PagefileUsage', size_t), ('PeakPagefileUsage', size_t)]

    handle = ctypes.windll.kernel32.OpenProcess(0x1010, False, pid)
    if not handle:
        return None
    try:
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        if not ctypes.windll.psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
            return None
        return int(counters.WorkingSetSize)
    finally:
        ctypes.windll.kernel32.CloseHandle(handle)


def bounded_process(root, stage, args, deadline, memory_limit, storage_limit, env):
    log_path = root / f'{stage}.log'
    journal(root, stage, 'started', {'command': [Path(args[0]).name, Path(args[1]).name],
                                     'log': log_path.name})
    with log_path.open('ab') as log:
        child = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=log,
                                 stderr=subprocess.STDOUT, env=env, cwd=HERE)
        peak = 0
        try:
            while child.poll() is None:
                if time.monotonic() >= deadline:
                    raise TimeoutError('Authorized 30-minute wall-time limit reached')
                memory = working_set_bytes(child.pid)
                if memory is not None:
                    peak = max(peak, memory)
                    if memory > memory_limit:
                        raise MemoryError('Child process exceeded the configured RAM limit')
                if tree_bytes(root) > storage_limit:
                    raise OSError('Proof output exceeded the configured storage limit')
                time.sleep(0.5)
        except BaseException as error:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
            journal(root, stage, 'stopped', str(error))
            raise
    result = {'exitCode': child.returncode, 'peakWorkingSetBytes': peak,
              'storageBytes': tree_bytes(root), 'log': log_path.name}
    journal(root, stage, 'completed' if child.returncode == 0 else 'failed', result)
    if child.returncode:
        raise RuntimeError(f'{stage} exited {child.returncode}; inspect {log_path}')
    return result


def next_dataset(root):
    if (root / 'manifest.json').is_file():
        return root, True
    completed = sorted((p for p in root.glob('data-attempt-*')
                        if (p / 'manifest.json').is_file()), reverse=True)
    if completed:
        return completed[0], True
    index = 1
    while (root / f'data-attempt-{index:03d}').exists():
        index += 1
    return root / f'data-attempt-{index:03d}', False


def verified_completed_run(candidate, manifest_sha):
    report_path = candidate / 'report.json'
    if not report_path.is_file():
        return False
    try:
        report = json.loads(report_path.read_text(encoding='utf-8'))
        if (report.get('status') != 'completed' or
                report.get('manifestSha256') != manifest_sha or
                report.get('trainingPerformed') is not True or
                report.get('optimizerSteps', 0) < 1 or
                report.get('onnxCheckerPassed') is not True or
                report.get('onnxRuntimeInferencePassed') is not True):
            return False
        for name, hash_name in (('checkpoint', 'checkpointSha256'),
                                ('weights', 'weightsSha256'), ('onnx', 'onnxSha256')):
            path = Path(report[name]).resolve()
            if path.parent != candidate.resolve() or not path.is_file():
                return False
            if sha256(path) != report[hash_name]:
                return False
        return True
    except (OSError, KeyError, TypeError, ValueError):
        return False


def resumable_partial_run(candidate, manifest_sha):
    checkpoint = candidate / 'checkpoint-last.pt'
    state = candidate / 'run-state.json'
    if not checkpoint.is_file() or not state.is_file():
        return False
    try:
        return json.loads(state.read_text(encoding='utf-8')).get('manifestSha256') == manifest_sha
    except (OSError, ValueError):
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True,
                        help='Private experiment folder, separate from real datasets')
    parser.add_argument('--minutes', type=int, default=30)
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--memory-mb', type=int, default=4096)
    parser.add_argument('--storage-mb', type=int, default=2048)
    parser.add_argument('--ffmpeg', type=Path)
    args = parser.parse_args()
    if not 1 <= args.minutes <= 30 or not 1 <= args.threads <= 4:
        raise ValueError('Proof authorization permits at most 30 minutes and four CPU threads')
    if not 512 <= args.memory_mb <= 4096 or not 128 <= args.storage_mb <= 2048:
        raise ValueError('Proof authorization permits at most 4 GB RAM and 2 GB storage')
    root = args.output.resolve()
    repository = HERE.parents[2]
    if root == repository or repository in root.parents:
        raise ValueError('Generated media and model artifacts must stay outside the Git repository')
    if 'Basira-Vision-Datasets' in root.parts or '.git' in root.parts:
        raise ValueError('Output must be separate from real data and Git internals')
    root.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + args.minutes * 60
    env = {**os.environ, 'CUDA_VISIBLE_DEVICES': '', 'OMP_NUM_THREADS': str(args.threads),
           'MKL_NUM_THREADS': str(args.threads), 'HTTP_PROXY': '', 'HTTPS_PROXY': '',
           'ALL_PROXY': '', 'NO_PROXY': '*'}
    ffmpeg = args.ffmpeg or (Path.home() / 'AppData/Local/ms-playwright/ffmpeg-1011/ffmpeg-win64.exe')
    data, complete = next_dataset(root)
    if complete:
        journal(root, 'generate', 'resumed', {'manifest': str(data / 'manifest.json')})
    else:
        command = [sys.executable, str(HERE / 'generate.py'), '--output', str(data)]
        if ffmpeg.is_file():
            command += ['--ffmpeg', str(ffmpeg)]
        bounded_process(root, 'generate', command, deadline, args.memory_mb * 1024**2,
                        args.storage_mb * 1024**2, env)
    manifest = data / 'manifest.json'
    if not manifest.is_file():
        raise RuntimeError('Generator did not produce a manifest')
    validation_path = root / 'validation.json'
    bounded_process(root, 'validate', [sys.executable, str(HERE / 'validate.py'),
                    '--manifest', str(manifest), '--output', str(validation_path)], deadline,
                    args.memory_mb * 1024**2, args.storage_mb * 1024**2, env)
    validation = json.loads(validation_path.read_text(encoding='utf-8'))
    if not validation.get('passed'):
        raise RuntimeError('Synthetic data validation failed; training not started')
    runs = root / 'runs'
    runs.mkdir(exist_ok=True)
    manifest_sha = sha256(manifest)
    completed = [candidate for candidate in sorted(runs.glob('proof-*'))
                 if verified_completed_run(candidate, manifest_sha)]
    if completed:
        run = completed[-1]
    else:
        partial = sorted(p for p in runs.glob('proof-*')
                         if p.is_dir() and resumable_partial_run(p, manifest_sha))
        if partial:
            run = partial[-1]
        else:
            index = 1
            while (runs / f'proof-{index:03d}').exists():
                index += 1
            run = runs / f'proof-{index:03d}'
    if verified_completed_run(run, manifest_sha):
        journal(root, 'train', 'resumed_completed', {'report': str(run / 'report.json')})
    else:
        remaining = max(1, int((deadline - time.monotonic()) / 60))
        command = [sys.executable, str(HERE / 'train_small.py'), '--manifest', str(manifest),
                   '--output', str(run), '--epochs', '3', '--threads', str(args.threads),
                   '--minutes', str(remaining), '--memory-mb', str(args.memory_mb),
                   '--max-storage-mb', str(args.storage_mb)]
        if run.exists():
            command.append('--resume')
        bounded_process(root, 'train', command, deadline, args.memory_mb * 1024**2,
                        args.storage_mb * 1024**2, env)
    report = json.loads((run / 'report.json').read_text(encoding='utf-8'))
    summary = {'schemaVersion': 1, 'status': 'PROOF_COMPLETED',
               'scope': 'synthetic_ground_truth_cpu_proof',
               'manifest': str(manifest), 'validation': str(validation_path),
               'trainingReport': str(run / 'report.json'), 'data': validation,
               'training': report, 'realCameraEvaluation': 'not_performed',
               'blindNavigationSafety': 'not_established',
               'productionIntegration': False, 'storageBytes': tree_bytes(root)}
    (root / 'proof-report.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False),
                                             encoding='utf-8')
    journal(root, 'proof', 'completed', {'report': str(root / 'proof-report.json')})
    print(json.dumps({'status': 'PROOF_COMPLETED', 'report': str(root / 'proof-report.json'),
                      'storageBytes': tree_bytes(root)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
