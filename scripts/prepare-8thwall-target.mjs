/**
 * Prepare a real CLI-processed 8th Wall lab marker from the existing Basira SVG.
 *
 * Steps:
 *   node scripts/prepare-8thwall-target.mjs source
 *   npx @8thwall/image-target-cli@latest
 *     input: client/public/ar/targets/basira-lab-entrance_source.png
 *     type: flat, default crop: yes
 *     output: .basira-image-targets
 *     name: basira-lab-entrance
 *   node scripts/prepare-8thwall-target.mjs import
 *
 * This script never downloads external binaries or activates the web camera.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root=path.resolve(import.meta.dirname,'..');
const publicDir=path.join(root,'client/public/ar/targets');
const sourceSvg=path.join(publicDir,'basira-lab-marker.svg');
const sourcePng=path.join(publicDir,'basira-lab-entrance_source.png');
const cliDir=path.join(root,'.basira-image-targets');
const targetName='basira-lab-entrance';

async function exists(f) {try{await fs.access(f);return true}catch{return false}}

async function source(){
  await fs.mkdir(publicDir,{recursive:true});
  const svg=await fs.readFile(sourceSvg);
  await sharp(svg,{density:192}).resize({width:960,height:1280,fit:'fill'}).png().toFile(sourcePng);
  process.stdout.write(`Generated source image: ${path.relative(root,sourcePng)}\n`+
  'NEXT: run npx @8thwall/image-target-cli@latest and choose flat, default crop,\n'+
  'input client/public/ar/targets/basira-lab-entrance_source.png,\n'+
  'output .basira-image-targets, target name basira-lab-entrance.\n'+
  'Then: node scripts/prepare-8thwall-target.mjs import\n');
}

const files=[
  targetName+'.json',
  targetName+'_luminance.png',
  targetName+'_original.png',
  targetName+'_cropped.png',
];
const optional=[targetName+'_thumbnail.png'];

async function importCli(){
  for(const name of files)if(!await exists(path.join(cliDir,name)))throw new Error('CLI output missing: '+name);
  const json=JSON.parse(await fs.readFile(path.join(cliDir,targetName+'.json'),'utf8'));
  if(json.name!==targetName||json.type!=='PLANAR'||!json.properties||!Number.isFinite(json.created)) {
    throw new Error('This is not a processed planar target for the Basira demo');
  }
  const lumPath=path.join(cliDir,targetName+'_luminance.png');
  const metadata=await sharp(lumPath).metadata();
  // Official CLI may encode grayscale pixels in RGBA PNG (4 channels).\n  if(metadata.width!==480||metadata.height!==640||![1,2,3,4].includes(metadata.channels)) {
    throw new Error('Expected official CLI 480x640 luminance PNG; got '+JSON.stringify({width:metadata.width,height:metadata.height,channels:metadata.channels}));
  }
  const imagePath='/ar/targets/'+targetName+'_luminance.png';
  const newJson={
    ...json,imagePath,
    resources:{
      ...json.resources,
      originalImage:targetName+'_original.png',
      croppedImage:targetName+'_cropped.png',
      luminanceImage:targetName+'_luminance.png',
    },
  };
  await fs.mkdir(publicDir,{recursive:true});
  for(const name of [...files.slice(1),...optional]) {
    const from=path.join(cliDir,name);
    if(await exists(from))await fs.copyFile(from,path.join(publicDir,name));
  }
  await fs.writeFile(path.join(publicDir,targetName+'.json'),JSON.stringify(newJson,null,2)+'\n');
  process.stdout.write('Imported the processed 8th Wall marker into client/public/ar/targets.\n'+
    'Commit the PNG and JSON outputs on a feature branch and run CI before enabling the lab.\n');
}
const command=process.argv[2];
if(command==='source')await source();
else if(command==='import')await importCli();
else {process.stderr.write('Usage: node scripts/prepare-8thwall-target.mjs source|import\n');process.exitCode=2}
