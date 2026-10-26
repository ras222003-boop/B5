/** Swappable offline image-agent contract: analyze(item, context) -> detections. */
const $ = id => document.getElementById(id);
const agents = {
  'studio-segformer': async (item, context) => {
    const quality = await context.api('/api/assistant/analyze', { key: item.key });
    const model = await import('/local-models.mjs');
    const detections = await model.analyzeLocalStairs(`/media/image/${item.key}?v=${item.version}`);
    return { detections, modelSha256: context.capabilities.semanticSegmenter.sha256,
      issues: [
        ...quality.issues.map(x => `${x.type}: ${x.action}`),
        'SegFormer يقترح منطقة سلالم فقط؛ اتجاه الصعود أو النزول غير مؤكد، والثقة تقدير مساحة غير معاير.',
      ] };
  },
  'studio-local': async (item, context) => {
    const quality = await context.api('/api/assistant/analyze', { key: item.key });
    const model = await import('/local-models.mjs');
    const result = await model.analyzeLocalImage(`/media/image/${item.key}?v=${item.version}`,
      context.taxonomy, { withOCR: false });
    if (result.failures?.length) throw new Error(result.failures.map(x => x.error).join('; '));
    return {
      detections: result.detections.filter(d => d.classId === 23).map(d => ({
        classId: 2303, box: d.box, score: d.score,
      })),
      modelSha256: context.capabilities.objectDetector.sha256,
      issues: [
        ...quality.issues.map(x => `${x.type}: ${x.action}`),
        ...(!result.detections.some(d => d.classId === 23) ?
          ['الكاشف المحلي الحالي لا يملك فئة سلالم؛ لا يمكن استنتاج غياب السلالم من عدم كشفها.'] : []),
      ],
    };
  },
};

export function selfTrainingUI({ api, getCatalog, notify }) {
  let running = false, cancelled = false, poller, latest;
  function display(j) {
    latest = j;
    $('self-status').textContent = `${j.status ?? 'idle'}${j.reason ? ' · ' + j.reason : ''}`;
    $('self-report').textContent = JSON.stringify(j, null, 2);
    $('self-stop').disabled = !['analyzing', 'training', 'exporting'].includes(j.status);
    $('self-start').disabled = running || !['idle', 'completed', 'stopped', 'failed'].includes(j.status);
    $('self-download').disabled = !j.id;
  }
  async function refresh() {
    try { display(await api('/api/self-training')); }
    catch (e) { $('self-status').textContent = e.message; }
  }
  function images() {
    const c = getCatalog();
    if (!c) return;
    const previous = $('self-image').value;
    $('self-image').replaceChildren(...c.items.filter(i => i.sample.media?.kind === 'image').map(i => {
      const o = document.createElement('option');
      o.value = i.key;
      o.textContent = `${i.sample.id} · ${i.batch} · ${i.status}`;
      return o;
    }));
    if (c.items.some(i => i.key === previous)) $('self-image').value = previous;
    $('self-image').hidden = $('self-mode').value !== 'single';
  }
  $('self-mode').onchange = images;
  $('self-download').onclick = () => {
    if (!latest?.id) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(latest, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `basira-research-${latest.id}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('self-stop').onclick = async () => {
    cancelled = true;
    try { display(await api('/api/self-training/stop', {})); }
    catch (e) { notify(e.message); }
  };
  $('self-start').onclick = async () => {
    if (running) return;
    running = true; cancelled = false;
    try {
      if (!$('self-authorize').checked) throw new Error('حدد التفويض المحلي المحدود أولًا.');
      const provider = $('self-provider').value;
      if (!agents[provider]) throw new Error('هذا الوكيل غير متاح دون موصل محلي موثوق.');
      const capabilities = await api('/api/assistant/capabilities');
      const j = await api('/api/self-training/start', {
        authorization: true, noncommercialResearch: true, device: 'cpu', mode: $('self-mode').value,
        key: $('self-image').value, provider,
        maxMinutes: Number($('self-minutes').value), threads: Number($('self-threads').value),
      });
      display(j);
      if (j.status !== 'analyzing') return;
      const context = { taxonomy: getCatalog().taxonomy, capabilities, api };
      for (const item of j.selected) {
        if (cancelled) break;
        try {
          const out = await agents[provider](item, context);
          if (cancelled) break;
          display(await api('/api/self-training/submit', { id: j.id, key: item.key, ...out }));
        } catch (e) {
          await api('/api/self-training/fail', { reason: e.message }).catch(() => {});
          throw e;
        }
      }
      if (!cancelled) display(await api('/api/self-training/finish', {}));
    } catch (e) { notify(e.message); $('self-status').textContent = e.message; }
    finally { running = false; await refresh(); }
  };
  return { open: async () => {
    images(); await refresh();
    poller ??= setInterval(() => { if (!$('experiments-panel').hidden) refresh(); }, 2000);
  }, refresh };
}
