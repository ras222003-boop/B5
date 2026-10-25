"""Create a private, hash-verified V3 camera-lab bundle without publishing it."""
import argparse,json,shutil
from pathlib import Path
from train_small import sha256


def package(root,run,output,browser_report):
    root,run,output=root.resolve(),run.resolve(),output.resolve()
    if root not in run.parents or root not in output.parents:raise ValueError('Private experiment paths required')
    lock=json.loads((run/'selection-lock.json').read_text(encoding='utf-8'))
    comparison=json.loads((root/'comparison/comparison.json').read_text(encoding='utf-8'))
    browser=json.loads(browser_report.read_text(encoding='utf-8'))
    if comparison['v3WeightsSha256']!=lock['weightsSha256'] or browser['modelSha256']!=lock['onnxSha256']:
        raise ValueError('Model comparison/browser evidence binding changed')
    if browser['pageErrors'] or browser['externalRequests'] or browser['privateMediaUploaded']:
        raise ValueError('Desktop browser validation failed')
    artifacts=[('weights.pt',Path(lock['weights']),lock['weightsSha256']),
        ('model.onnx',Path(lock['onnx']),lock['onnxSha256']),
        ('checkpoint.pt',Path(lock['selectedCheckpoint']),lock['checkpointSha256'])]
    for _,path,expected in artifacts:
        if sha256(path)!=expected:raise ValueError(f'Artifact hash changed: {path.name}')
    output.mkdir(parents=True,exist_ok=False)
    for name,path,_ in artifacts:shutil.copyfile(path,output/name)
    for name,path in [('entry.json',run/'entry.json'),('config.json',run/'config.json'),
        ('selection-lock.json',run/'selection-lock.json'),('comparison.json',root/'comparison/comparison.json'),
        ('validation.json',root/'validation.json'),('browser-validation.json',browser_report)]:
        shutil.copyfile(path,output/name)
    (output/'README.md').write_text('# Basira stairs V3 research bundle\n\n'
        'Local ONNX camera-lab model with independent presence/direction heads.\n'
        'Input: RGB NCHW160, letterbox gray127, range0..1. Confidence is uncalibrated.\n'
        'Use scripts/vision-ai/camera-lab/server.mjs --entry <this-folder>/entry.json.\n'
        'Desktop image/video/synthetic-camera checks passed. A physical iPhone and real-camera accuracy were not tested.\n'
        'Synthetic test: fixed-stair FP58->24/64, up8->22/32, down31->23/32, missed fixed stairs9->18/80.\n'
        'No navigation audio, production integration, or navigation-safety approval.\n',encoding='utf-8')
    hashes={path.name:sha256(path) for path in output.iterdir() if path.is_file()}
    (output/'artifact-manifest.json').write_text(json.dumps(dict(scope='private_local_research',files=hashes,
        productionEnabled=False,confidenceCalibrated=False),indent=2),encoding='utf-8')
    return dict(bundle=str(output),files=len(hashes)+1,bytes=sum(p.stat().st_size for p in output.iterdir() if p.is_file()))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('root','run','output','browser-report'):parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args();print(json.dumps(package(args.root,args.run,args.output,args.browser_report)))
