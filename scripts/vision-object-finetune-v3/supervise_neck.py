"""External hard deadline for the known neck-training process tree only."""
from pathlib import Path
import json,sys,time
import psutil
from rights import read

root=Path(sys.argv[1]).resolve();already=read(root/'training/selection-lock.heads-only.json')['wallSeconds']
matches=[]
for p in psutil.process_iter(['pid','cmdline','create_time']):
    try:
        args=p.info['cmdline'] or []
        if any(str(a).replace('\\','/').endswith('/train_neck.py') for a in args) and any(str(root)==str(Path(a).resolve()) for a in args[1:] if 'object-finetune-v3-001' in str(a)):
            matches.append(p)
    except (psutil.NoSuchProcess,psutil.AccessDenied,OSError):pass
if not matches:
    print(json.dumps(dict(watchdog='No matching training process remained')));raise SystemExit()
process=min(matches,key=lambda p:p.create_time());created=process.create_time()
deadline=created+max(0,read(root/'protocol.json')['hardSupervisorSeconds']-already);killed=False
while process.is_running() and process.create_time()==created:
    if time.time()>=deadline:
        for child in reversed(process.children(recursive=True)):
            try:child.terminate()
            except psutil.NoSuchProcess:pass
        process.terminate();killed=True;break
    time.sleep(5)
(root/'training/neck-supervisor.json').write_text(json.dumps(dict(knownProcessTreeMonitored=True,deadlineReached=killed,
    hardAggregateSeconds=3660,privateMediaRead=False),indent=2))
print(json.dumps(dict(knownProcessTreeMonitored=True,deadlineReached=killed)))
