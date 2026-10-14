import { readJson, taxonomyPath } from './common.mjs';
const examples = {
  person: 'standing/walking; occlusion; different clothing', chair: 'legs/arms; occupied/empty; low contrast',
  table: 'edges/legs; glass and low tables', bicycle: 'parked/moving; partial wheels', car: 'parked/crossing; front/side/rear',
  bus: 'bus body/doors; parked/moving', truck: 'large body; partial view', motorcycle: 'parked/moving; rider present/absent',
  traffic_sign: 'traffic lights/stop signs; glare; do not infer right of way', sofa: 'low edges/feet; clutter', bed: 'bed frames; low furniture',
  backpack: 'on floor/carried', handbag: 'on floor/carried', suitcase: 'standing/lying; extended handle', bottle: 'upright/lying; transparent/opaque',
  dog: 'standing/lying/moving; scale variation', cat: 'standing/lying/moving; low contrast', door: 'open/closed/ajar; glass',
  pole_column: 'thin/wide; low contrast; partial occlusion', barrier: 'temporary/permanent; reflective', cart: 'stationary/moving; different loads',
  box: 'low/tall; floor clutter', stairs_visible: 'visible edges; oblique view; no ascent/descent inference',
  curb_step_edge: 'low/high visible edges; curb versus painted line', pothole_visible: 'shallow/deep appearance; dry/wet; shadows',
  open_hole_visible: 'guarded staged sites; lids/shadows as negatives', raised_tile: 'subtle height edges; tile patterns as negatives',
  cable_hose: 'thin/thick; floor contrast; shadows as negatives', debris_rock: 'small/large; irregular clusters',
  surface_crack: 'thin/wide visible cracks; grout as negatives', overhanging_obstacle: 'head/torso height; branches/signs/open doors',
  floor: 'tile/carpet; transitions; polygon masks', road: 'asphalt/concrete; markings; polygon masks',
  sidewalk: 'paving/curbs; polygon masks', path: 'dirt/gravel/paving; polygon masks'
};

export async function dataNeeds(data = null) {
  const taxonomy = await readJson(taxonomyPath);
  return { schemaVersion: 1, status: 'PLANNING_TARGETS_NOT_ACCEPTANCE_OR_ACCURACY_EVIDENCE',
    classes: taxonomy.classes.map(c => {
      const targets = c.kind === 'ground_hazard' || c.id === 31 ? { train: 600, validation: 150, test: 200 } : { train: 300, validation: 75, test: 100 };
      const counts = { train: 0, validation: 0, test: 0 };
      for (const s of data?.samples ?? []) if (s.split in counts) counts[s.split] +=
        [...s.annotation.objects, ...s.annotation.surfaces].filter(o => o.classId === c.id).length;
      return { classId: c.id, key: c.key, ar: c.ar, kind: c.kind, annotation: c.kind === 'surface' ? 'polygon-not-used-by-SSDLite' : 'box-and-attributes',
        examples: examples[c.key], targets, observedAnnotations: counts,
        missingAnnotations: Object.fromEntries(Object.keys(counts).map(k => [k, Math.max(0, targets[k] - counts[k])])) };
    }), minimumIndependentSessionsPerClass: { train: 10, validation: 3, test: 5 },
    requiredSlices: ['daylight', 'indoor', 'low_light', 'moving', 'static', 'occlusion', 'small objects', 'hard negatives'],
    motion: { labels: ['approaching', 'receding', 'lateral_left', 'lateral_right', 'stationary', 'uncertain'],
      cameraControls: ['rotation', 'zoom', 'translation', 'mixed'], targetIndependentClipsPerLabel: { train: 50, validation: 20, test: 30 },
      requirement: 'Persistent track IDs; presentation timestamps; measured endpoints for approach/recede; object rotation separately labeled.' },
    proximity: { targetMeasuredObjectsPerBandAndPilotClass: { train: 100, validation: 30, test: 50 },
      requirement: 'Five metric bands plus deliberate uncertain cases; count by independent sessions, not adjacent duplicate frames.' },
    noDataAvailable: !data?.samples?.length, trainingPerformed: false };
}
