const $ = id => document.getElementById(id);
const esc = v =>
  String(v ?? "").replace(
    /[&<>"']/g,
    c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]
  );
const categories = {
  ready: "جاهزة للمراجعة",
  needs_information: "تحتاج معلومات",
  high_risk: "عالية الخطورة",
};
const issues = {
  protected_final_test: "اختبار مستقل محمي — لا تعديلات تطويرية",
  manifest_conflict: "تغير الفهرس",
  rights_rejected: "حقوق مرفوضة",
  source_information: "معلومات المصدر ناقصة",
  source_evidence: "دليل المصدر غير متاح أو تغيرت بصمته",
  media_changed: "تغير ملف الصورة",
  scene_evidence: "ظروف تصوير غير محسومة",
  similarity_unresolved: "تشابه أو فصل مجموعات يحتاج قرارًا",
  preparer_inspection: "تحتاج تأكيد المُعدّ",
  video_requires_frame_review: "تحتاج محرر الفيديو والتتبع",
};
const choices = {
  lighting: {
    unreviewed: "غير مؤكدة — تحتاج أدلة",
    daylight: "نهار",
    indoor: "إضاءة داخلية",
    low_light: "إضاءة ضعيفة",
    mixed: "مختلطة",
  },
  scene: {
    unreviewed: "غير مؤكد — يحتاج أدلة",
    indoor: "داخلي",
    outdoor: "خارجي",
  },
  motion: {
    unreviewed: "غير مؤكدة — تحتاج أدلة التقاط",
    static: "التقاط ثابت",
    moving: "كاميرا متحركة",
    unknown_stairs_still: "غير معروفة — صور الدرج الثابتة فقط؛ لا للحركة أو المسافة",
  },
};
export function batchReviewUI({
  api,
  getActor,
  getCatalog,
  openEditor,
  refresh,
}) {
  let board = { items: [] },
    detail = null,
    epoch = 0,
    busy = false,
    operation = null;
  const queue = new Map();
  let owner = null;
  const stage = () => $("batch-stage").value;
  const className = id =>
    getCatalog()?.taxonomy.classes.find(c => c.id === id)?.ar ?? id;
  function resetIdentity() {
    if (owner !== getActor()?.id) {
      owner = getActor()?.id;
      queue.clear();
      operation = null;
      detail = null;
      epoch++;
      $("batch-detail").close();
    }
  }
  function render() {
    resetIdentity();
    const kind = $("batch-kind").value,
      category = $("batch-category").value,
      search = $("batch-search").value.trim().toLowerCase();
    const items = board.items.filter(
      i =>
        i.contentKind === kind &&
        (!category || i.category === category) &&
        (!search || `${i.id} ${i.batch}`.toLowerCase().includes(search))
    );
    const selected = items.filter(i => queue.has(`${stage()}:${i.key}`));
    $("batch-counts").textContent =
      `${items.length} صور معروضة · جاهزة ${items.filter(i => i.category === "ready").length} · تحتاج معلومات ${items.filter(i => i.category === "needs_information").length} · عالية الخطورة ${items.filter(i => i.category === "high_risk").length} · فُحصت لهذه العملية ${selected.length}`;
    $("batch-commit").textContent =
      stage() === "prepare" ? "تأكيد تجهيز الدفعة" : "اعتماد الدفعة المؤهلة";
    $("batch-commit").disabled = busy || !selected.length;
    for (const id of [
      "batch-stage",
      "batch-kind",
      "batch-category",
      "batch-search",
      "batch-refresh",
    ])
      $(id).disabled = busy;
    $("batch-training-panel").hidden = !getActor()?.roles.includes("labels");
    const checked = new Set(
      [...$("batch-training-selection").querySelectorAll("input:checked")].map(
        e => e.value
      )
    );
    $("batch-training-selection").innerHTML =
      board.items
        .filter(i => i.status === "approved" && i.contentKind === "real")
        .map(
          i =>
            `<label class="check"><input type="checkbox" value="${i.key}" ${checked.has(i.key) ? "checked" : ""}/>${esc(i.id)} · إصدار ${i.version}</label>`
        )
        .join("") || "<p>لا توجد عينة حقيقية مكتملة الاعتماد بعد.</p>";
    $("batch-board").innerHTML = items
      .map(
        i =>
          `<article class="batch-card ${esc(i.category)}"><img loading="lazy" src="/media/image/${i.key}" alt="${esc(i.id)}"/><div><strong>${esc(i.id)}</strong><small>${esc([...new Set(i.classes)].map(className).join("، "))} · إصدار ${i.version}</small><p>${queue.has(`${stage()}:${i.key}`) ? "✓ فُحصت — بانتظار زر الدفعة" : categories[i.category]}</p><small>${esc(i.exceptions.map(x => issues[x] ?? x).join(" · "))}</small><button class="quiet" data-batch-inspect="${i.key}" ${stage() === "approve" && !i.independent ? "disabled" : ""}>${stage() === "approve" && !i.independent ? "لا يمكنك اعتماد عمل ساهمت فيه" : "فتح الصورة والأدلة"}</button></div></article>`
      )
      .join("");
    $("batch-board")
      .querySelectorAll("[data-batch-inspect]")
      .forEach(b => (b.onclick = () => inspect(b.dataset.batchInspect)));
    $("batch-exceptions").innerHTML =
      items
        .filter(i => i.exceptions.length)
        .map(
          i =>
            `<p><strong>${esc(i.id)}</strong> — ${esc(i.exceptions.map(x => issues[x] ?? x).join("، "))}</p>`
        )
        .join("") ||
      "<p>لا توجد استثناءات في العرض الحالي. يلزم فحص كل صورة فعليًا قبل أي قرار.</p>";
  }
  async function open() {
    resetIdentity();
    const a = getActor();
    if (!a) return;
    if (!a.roles.includes("annotator")) $("batch-stage").value = "approve";
    $("batch-stage").querySelector("[value=prepare]").disabled =
      !a.roles.includes("annotator");
    $("batch-stage").querySelector("[value=approve]").disabled = ![
      "rights",
      "privacy",
      "labels",
    ].every(x => a.roles.includes(x));
    try {
      board = await api("/api/batch/board");
      render();
    } catch (e) {
      $("batch-result").textContent =
        `تعذر تحديث الدفعة: ${e.serverError ?? e.message}`;
    }
  }
  async function image(url) {
    const i = new Image();
    i.src = url;
    await i.decode();
    return i;
  }
  function draw(canvas, img, objects) {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const c = canvas.getContext("2d");
    c.drawImage(img, 0, 0);
    c.lineWidth = Math.max(2, canvas.width / 300);
    c.font = `${Math.max(14, canvas.width / 40)}px Tahoma`;
    for (const o of objects) {
      const [x, y, w, h] = o.box.map(
        (v, n) => v * (n % 2 ? canvas.height : canvas.width)
      );
      c.strokeStyle = "#e6ac08";
      c.strokeRect(x, y, w, h);
      c.fillStyle = "#063c30";
      c.fillText(String(className(o.classId)), x, Math.max(20, y));
    }
  }
  function proposalObjects() {
    const objects = structuredClone(detail.sample.annotation.objects);
    for (const x of detail.report?.proposals ?? [])
      if ($(`batch-proposal-${x.id}`).value === "accept") {
        const o = x.objectId ? objects.find(o => o.id === x.objectId) : null;
        if (o) {
          o.box = x.box;
          o.classId = x.classId;
        } else objects.push({ classId: x.classId, box: x.box });
      }
    return objects;
  }
  function redraw() {
    if (detail?.previewImage)
      draw($("batch-preview"), detail.previewImage, proposalObjects());
  }
  async function inspect(key) {
    if (busy) return;
    const request = ++epoch;
    $("batch-detail-status").textContent = "جارٍ تحميل النسخة والأدلة…";
    $("batch-fields").disabled = true;
    $("batch-detail").showModal();
    try {
      const d = await api("/api/batch/inspect", { key, stage: stage() });
      if (request !== epoch) return;
      detail = d;
      $("batch-title").textContent =
        `${d.id} · إصدار ${d.version} · ${d.stage === "prepare" ? "فحص المُعدّ" : "فحص مستقل"}`;
      const [original, preview] = await Promise.all([
        image(d.original),
        image(d.preview),
      ]);
      if (request !== epoch) return;
      detail.previewImage = preview;
      draw($("batch-original"), original, d.sample.annotation.objects);
      draw($("batch-preview"), preview, d.sample.annotation.objects);
      const proposals = d.report?.proposals ?? [];
      $("batch-labels").innerHTML =
        `<p>${d.sample.annotation.objects.length} أجسام أصلية — ${esc(d.sample.annotation.objects.map(o => className(o.classId)).join("، "))}</p>` +
          d.sample.annotation.objects.filter(o => o.classId === 23).map(o => `<p>اتجاه الدرج: ${esc(o.stairsDirection?.label ?? 'لم يُراجع')} · الدليل: ${esc(o.stairsDirection?.evidence ?? 'مطلوب قبل تدريب الاتجاه')} · موضع داخل الصورة فقط، بلا قياس أمتار.</p>`).join('') +
          `<p>${esc((d.report?.issues ?? []).map(x => `${x.type}: ${x.action ?? ""}`).join(" · "))}</p>` +
        proposals
          .map(
            x =>
              `<label class="batch-proposal">اقتراح ${esc(className(x.classId))} · ${esc(x.type)} · ثقة ${esc(x.score ?? x.confidence ?? "غير مسجلة")}<select id="batch-proposal-${esc(x.id)}"><option value="defer">غير محسوم</option><option value="accept">فحصته — قبول التصحيح</option><option value="reject">فحصته — إبقاء الوسم الحالي ورفض الاقتراح</option></select></label>`
          )
          .join("");
      $("batch-labels")
        .querySelectorAll("select")
        .forEach(s => (s.onchange = redraw));
      $("batch-keep-labels").hidden =
        d.stage !== "prepare" || !proposals.length;
      $("batch-conditions").innerHTML = Object.entries(choices)
        .map(
          ([k, values]) =>
            `<label>${{ lighting: "الإضاءة", scene: "المكان", motion: "حركة الالتقاط" }[k]}<select id="batch-condition-${k}" ${d.stage === "approve" ? "disabled" : ""}>${Object.entries(
              values
            )
              .map(
                ([v, t]) =>
                  `<option value="${v}" ${v === d.sample.conditions?.[k] ? "selected" : ""}>${t}</option>`
              )
              .join("")}</select></label>`
        )
        .join("");
      $("batch-condition-note").textContent =
        `سطوع تقريبي: ${d.report?.conditions.brightness ?? "لا تقرير حالي"}. لا يحدد السطوع المكان أو حركة الكاميرا. أبقِ غير المؤكد ضمن الاستثناءات؛ لا تُستنتج أمتار.`;
      $("batch-privacy").innerHTML = ["faces", "plates", "personalText"]
        .map(
          k =>
            `<label>${{ faces: "وجوه", plates: "لوحات", personalText: "نصوص شخصية" }[k]}<select id="batch-privacy-${k}"><option value="unreviewed">تحتاج فحصًا</option><option value="absent">فحصت — غير موجودة</option><option value="redacted">فحصت — منقحة بالكامل</option></select></label>`
        )
        .join("");
      // Prior preparer choices are evidence, not preselected independent reviewer decisions.
      if (d.preparation)
        $("batch-condition-note").textContent +=
          ` · المُعدّ: ${d.preparation.actor} · خصوصية مُقترحة: ${JSON.stringify(d.preparation.assessment.privacy)}`;
      $("batch-evidence").innerHTML = d.sources
        .map(
          s =>
            `<details open><summary>${esc(s.id)} · ${esc(s.license)}</summary><p>${esc(s.origin)}</p><pre>${esc(d.evidence.find(e => e.sourceId === s.id)?.text ?? "الدليل غير متاح")}</pre><small>SHA-256 ${esc(d.evidence.find(e => e.sourceId === s.id)?.sha256 ?? "غير متاح")}</small></details>`
        )
        .join("");
      for (const id of [
        "batch-seen-labels",
        "batch-seen-privacy",
        "batch-seen-sources",
        "batch-commercial",
      ])
        $(id).checked = false;
      $("batch-commercial-wrap").hidden = d.stage !== "approve";
      $("batch-reason").value =
        d.stage === "prepare"
          ? "فحصت الأصل والنسخة المقترحة والوسوم والأدلة لهذه الصورة؛ أكدت التجهيز فقط."
          : "راجعت هذه الصورة وأدلة الحقوق والخصوصية والوسوم بصورة مستقلة وأعتمد النتائج المسجلة.";
      $("batch-detail-status").textContent = d.problems.length
        ? d.problems.map(x => issues[x] ?? x).join("، ")
        : "الفحص الآلي اقتراح فقط. أكمل فحص هذه الصورة ثم أضفها للقائمة.";
      $("batch-fields").disabled = false;
    } catch (e) {
      if (request === epoch)
        $("batch-detail-status").textContent = e.serverError ?? e.message;
    }
  }
  $("batch-attest").onclick = async () => {
    if (busy || !detail) return;
    busy = true;
    $("batch-fields").disabled = true;
    const d = detail,
      proposals = d.report?.proposals ?? [];
    const payload = {
      receipt: d.receipt,
      labelsInspected: $("batch-seen-labels").checked,
      privacyInspected: $("batch-seen-privacy").checked,
      sourcesInspected: $("batch-seen-sources").checked,
      commercialTrainingRights: $("batch-commercial").checked,
      reason: $("batch-reason").value,
      conditions: Object.fromEntries(
        Object.keys(choices).map(k => [k, $(`batch-condition-${k}`).value])
      ),
      privacy: Object.fromEntries(
        ["faces", "plates", "personalText"].map(k => [
          k,
          $(`batch-privacy-${k}`).value,
        ])
      ),
      proposalIds: proposals
        .filter(x => $(`batch-proposal-${x.id}`).value === "accept")
        .map(x => x.id),
      rejectedProposalIds: proposals
        .filter(x => $(`batch-proposal-${x.id}`).value === "reject")
        .map(x => x.id),
    };
    try {
      const r = await api("/api/batch/attest", payload);
      queue.set(`${d.stage}:${d.key}`, r);
      operation = null;
      $("batch-detail").close();
      render();
    } catch (e) {
      $("batch-detail-status").textContent =
        `لم تُضف الصورة؛ اختياراتك باقية: ${e.serverError ?? e.message}`;
    } finally {
      busy = false;
      $("batch-fields").disabled = false;
      render();
    }
  };
  $("batch-commit").onclick = async () => {
    if (busy) return;
    const visible = new Set(
      [...$("batch-board").querySelectorAll("[data-batch-inspect]")].map(
        b => b.dataset.batchInspect
      )
    );
    const selected = [...queue.entries()].filter(
      ([k, r]) => k.startsWith(`${stage()}:`) && visible.has(r.key)
    );
    if (!selected.length) return;
    busy = true;
    render();
    // Reuse the same operation ID after a lost response; the server never replays a decision.
    operation ??= {
      operationId: crypto.randomUUID(),
      stage: stage(),
      receipts: selected.map(([, r]) => r.receipt),
    };
    try {
      const result = await api("/api/batch/commit", operation);
      if (result.status !== "completed") {
        $("batch-result").textContent =
          "العملية جارية أو انقطعت؛ افحص سجل الإصدارات قبل إعادة فحص الصور. لن يعاد تسجيل القرارات تلقائيًا.";
        return;
      }
      for (const [k, r] of selected)
        if (result.results.some(x => x.key === r.key && x.saved))
          queue.delete(k);
      $("batch-result").textContent =
        `حُفظت ${result.results.filter(x => x.saved).length} صور · استثناءات ${result.results.filter(x => !x.saved).length}. ` +
        result.results
          .filter(x => !x.saved)
          .map(x => `${x.key}: ${x.error}`)
          .join(" · ") +
        (result.preparation
          ? ` · تجهيز التدريب: ${result.preparation.status}`
          : "");
      operation = null;
      await refresh();
      await open();
    } catch (e) {
      $("batch-result").textContent =
        `لم تكتمل العملية. الاختيارات باقية؛ إعادة المحاولة تستخدم نفس معرّف العملية: ${e.serverError ?? e.message}`;
    } finally {
      busy = false;
      render();
    }
  };
  $("batch-close").onclick = () => {
    if (!busy) {
      epoch++;
      $("batch-detail").close();
    }
  };
  $("batch-detail").addEventListener("cancel", e => {
    if (busy) e.preventDefault();
    else epoch++;
  });
  $("batch-keep-labels").onclick = () => {
    $("batch-labels")
      .querySelectorAll("select")
      .forEach(s => (s.value = "reject"));
    redraw();
  };
  $("batch-edit").onclick = () => {
    const key = detail?.key;
    epoch++;
    $("batch-detail").close();
    if (key) openEditor(key);
  };
  $("batch-refresh").onclick = open;
  $("batch-quick-check").onclick = () => {
    // Explicit assertion for this one open image; never invoked by navigation or bulk commit.
    for (const id of [
      "batch-seen-labels",
      "batch-seen-privacy",
      "batch-seen-sources",
    ])
      $(id).checked = true;
    for (const k of ["faces", "plates", "personalText"])
      $(`batch-privacy-${k}`).value = "absent";
    if (detail?.stage === "prepare")
      $("batch-labels")
        .querySelectorAll("select")
        .forEach(s => (s.value = "reject"));
    redraw();
  };
  const trainingKeys = () =>
    [...$("batch-training-selection").querySelectorAll("input:checked")].map(
      e => e.value
    );
  $("batch-register-test").onclick = async () => {
    if (busy) return;
    busy = true;
    render();
    try {
      const r = await api("/api/batch/register-test", {
        keys: trainingKeys(),
        evidence: {
          path: $("batch-test-evidence").value,
          sha256: $("batch-test-sha").value,
        },
        reason: $("batch-test-reason").value,
        newSessionsInspected: $("batch-test-inspected").checked,
        neverUsedForTuning: $("batch-test-inspected").checked,
      });
      $("batch-training-result").textContent =
        `سُجلت ${r.registered} عينات اختبار محمية. لم يبدأ التدريب.`;
    } catch (e) {
      $("batch-training-result").textContent = e.serverError ?? e.message;
    } finally {
      busy = false;
      render();
    }
  };
  $("batch-prepare-training").onclick = async () => {
    if (busy) return;
    busy = true;
    render();
    try {
      const r = await api("/api/batch/prepare-training", {
        keys: trainingKeys(),
      });
      $("batch-training-result").textContent = JSON.stringify(r, null, 2);
    } catch (e) {
      $("batch-training-result").textContent = e.serverError ?? e.message;
    } finally {
      busy = false;
      render();
    }
  };
  for (const id of [
    "batch-stage",
    "batch-kind",
    "batch-category",
    "batch-search",
  ])
    $(id).addEventListener(id === "batch-search" ? "input" : "change", () => {
      if (!busy) {
        operation = null;
        render();
      }
    });
  return {
    open,
    reset: resetIdentity,
    hasPending: () => queue.size > 0 || busy,
  };
}
