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
  source_provenance:
    "إثبات أن الأصل صورة حقيقية ناقص — أرفق دليل المصدر قبل القبول",
  unsupported_ramp: "منحدر خارج أول دفعة — لا تُعد تصنيفه لتمرير الفحص",
  stairs_direction_pending:
    "اتجاه الدرج يحتاج اختيارًا بصريًا ودليلًا داخل شاشة المراجعة",
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
    unknown_stairs_still:
      "غير معروفة — صور الدرج الثابتة فقط؛ لا للحركة أو المسافة",
  },
};
const readinessText = r => {
  if (!r)
    return "تبدأ فحوص التغطية والتجميد تلقائيًا بعد الاعتماد الحقيقي. لا يبدأ التدريب.";
  const code = r.preflight?.status ?? r.status,
    labels = {
      WAITING_APPROVED_STAIRS_DATA:
        "تنتظر صور درج معتمدة الاتجاهات والوسوم والحقوق والخصوصية.",
      WAITING_INDEPENDENT_TEST_REGISTRATION:
        "تنتظر اعتماد وتسجيل جلسات الاختبار المستقلة وأدلتها. لا تُستبدل بصور التطوير.",
      WAITING_LOCAL_PREFLIGHT_CONFIGURATION:
        "التقسيم مجمد؛ يلزم تهيئة مفسر Python ووصف الأوزان محليًا.",
      WAITING_PRETRAINED_RIGHTS_REVIEW:
        "التقسيم مجمد؛ حقوق الأوزان المسبقة لم تُعتمد بعد.",
      DATA_GATES_BLOCKED: "التغطية أو أدلة البيانات ناقصة؛ بقيت البوابة مغلقة.",
      DATA_PREFLIGHT_BLOCKED: "لم ينجح الفحص المسبق؛ لا إذن لتشغيل التدريب.",
      READY_REQUEST_EXPLICIT_TRAINING_PERMISSION:
        "نجحت بوابات البيانات والأوزان والفحص المسبق. أطلب موافقة صاحب المشروع الصريحة على إعداد التدريب والتكلفة قبل أي تشغيل.",
    };
  return `${labels[code] ?? code} ${r.reason ?? ""} لم يبدأ تدريب أو استخدام خدمة مدفوعة.`;
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
  let quick = false,
    progress = { revision: 0, drafts: {} },
    dirty = false,
    draftTimer,
    saveChain = Promise.resolve(),
    selectedObject = 0;
  const draftKey = (d = detail) => `${d.stage}:${d.key}`;
  const localKey = d => `basira-review-draft-v1:${owner}:${draftKey(d)}`;
  const filtered = () =>
    board.items.filter(
      i =>
        i.contentKind === $("batch-kind").value &&
        (!quick || i.stairsCandidate) &&
        (!$("batch-category").value ||
          i.category === $("batch-category").value) &&
        (!$("batch-search").value ||
          `${i.id} ${i.batch}`
            .toLowerCase()
            .includes($("batch-search").value.trim().toLowerCase()))
    );
  const sequence = () =>
    filtered().filter(
      i =>
        i.category !== "high_risk" &&
        (stage() === "approve"
          ? i.preparedBy && i.independent && i.status !== "approved"
          : !(
              i.preparedBy && !i.exceptions.includes("stairs_direction_pending")
            ))
    );
  function draftValues() {
    return {
      conditions: Object.fromEntries(
        Object.keys(choices).map(k => [k, $(`batch-condition-${k}`).value])
      ),
      privacy: Object.fromEntries(
        ["faces", "plates", "personalText"].map(k => [
          k,
          $(`batch-privacy-${k}`).value,
        ])
      ),
      proposalChoices: Object.fromEntries(
        (detail.report?.proposals ?? []).map(p => [
          p.id,
          $(`batch-proposal-${p.id}`).value,
        ])
      ),
      objects: quick ? proposalObjects() : undefined,
      reason: $("batch-reason").value,
      deferReason: detail.deferReason,
    };
  }
  function remember() {
    if (!detail || busy || $("batch-fields").disabled) return;
    dirty = true;
    const d = detail,
      values = draftValues();
    try {
      localStorage.setItem(
        localKey(d),
        JSON.stringify({ stamp: d.stamp, values, at: new Date().toISOString() })
      );
    } catch {
      $("batch-draft-status").textContent =
        "تعذر حفظ المسودة في المتصفح؛ أبقِ الصفحة حتى تأكيد الحفظ المحلي.";
    }
    queue.delete(draftKey(d));
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => flushDraft().catch(() => {}), 350);
  }
  async function flushDraft() {
    clearTimeout(draftTimer);
    if (!detail || !dirty) return saveChain;
    const d = detail,
      values = draftValues(),
      actor = owner;
    dirty = false;
    saveChain = saveChain
      .catch(() => {})
      .then(async () => {
        try {
          const r = await api(
            "/api/batch/draft",
            {
              receipt: d.receipt,
              version: d.version,
              expectedRevision: progress.revision,
              draft: values,
            },
            { keepalive: true }
          );
          if (owner !== actor) return;
          progress.revision = r.revision;
          progress.drafts[draftKey(d)] = { stamp: d.stamp, values };
          $("batch-draft-status").textContent =
            "حُفظت مسودة حسابك محليًا؛ ليست تأكيد تجهيز أو اعتمادًا.";
        } catch (e) {
          if (owner === actor) {
            dirty = true;
            $("batch-draft-status").textContent =
              `المسودة باقية في المتصفح؛ لم تُكتب فوق تقدم آخر: ${e.serverError ?? e.message}`;
            throw e;
          }
        }
      });
    return saveChain;
  }
  function objectFields() {
    if (!quick || !detail) return;
    const objects = detail.customObjects,
      editable = detail.stage === "prepare";
    $("batch-inline-objects").innerHTML = objects
      .map(
        (o, n) =>
          `<article class="quick-object"><strong>جسم ${n + 1}: ${esc(className(o.classId))}</strong>${o.classId === 23 ? `<label>اتجاه الدرج<select data-quick-direction="${n}" ${editable ? "" : "disabled"}><option value="">غير مراجع — ليس اتجاهًا غير مؤكد</option>${["stairs_up", "stairs_down", "stairs_present_uncertain_direction"].map(k => `<option value="${k}" ${o.stairsDirection?.label === k ? "selected" : ""}>${k}</option>`).join("")}</select></label><label>دليل الاتجاه أو سبب الالتباس<input data-quick-evidence="${n}" value="${esc(o.stairsDirection?.evidence ?? "")}" ${editable ? "" : "disabled"}/></label>` : ""}<details><summary>تصحيح المربع أو التصنيف — اسحب على الصورة لتعديل المربع المحدد</summary><select data-quick-class="${n}" ${editable ? "" : "disabled"}>${getCatalog()
            .taxonomy.classes.filter(c => c.kind !== "surface")
            .map(
              c =>
                `<option value="${c.id}" ${o.classId === c.id ? "selected" : ""}>${esc(c.ar)}</option>`
            )
            .join(
              ""
            )}</select>${o.box.map((v, j) => `<label>${["X", "Y", "W", "H"][j]}<input type="number" min="0" max="1" step="0.001" data-quick-box="${n}:${j}" value="${v}" ${editable ? "" : "disabled"}/></label>`).join("")}<button class="quiet" data-quick-select="${n}" ${editable ? "" : "disabled"}>تحديد هذا المربع للسحب</button></details></article>`
      )
      .join("");
    $("batch-inline-objects")
      .querySelectorAll(
        "[data-quick-direction],[data-quick-evidence],[data-quick-class],[data-quick-box]"
      )
      .forEach(
        input =>
          (input.oninput = () => {
            const n = +(
                input.dataset.quickDirection ??
                input.dataset.quickEvidence ??
                input.dataset.quickClass ??
                input.dataset.quickBox?.split(":")[0]
              ),
              o = detail.customObjects[n];
            if (input.dataset.quickBox)
              o.box[+input.dataset.quickBox.split(":")[1]] = +input.value;
            else if (input.dataset.quickClass) {
              o.classId = +input.value;
              if (o.classId !== 23) delete o.stairsDirection;
              objectFields();
            } else
              o.stairsDirection = {
                label: document.querySelector(`[data-quick-direction="${n}"]`)
                  .value,
                evidence: document.querySelector(`[data-quick-evidence="${n}"]`)
                  .value,
              };
            redraw();
            remember();
          })
      );
    $("batch-inline-objects")
      .querySelectorAll("[data-quick-select]")
      .forEach(
        b =>
          (b.onclick = () => {
            selectedObject = +b.dataset.quickSelect;
            $("batch-draft-status").textContent =
              `اسحب على النسخة لتصحيح مربع الجسم ${selectedObject + 1}.`;
          })
      );
    if (editable)
      for (const [n, o] of objects.entries())
        if (o.classId === 23) {
          const panel = document.createElement("div");
          panel.className = "button-row";
          for (const [label, text, evidence] of [
            [
              "stairs_up",
              "أرى درجًا صاعدًا",
              "فحصت الصورة بصريًا: رحلة الدرج ترتفع بالنسبة إلى موضع الكاميرا.",
            ],
            [
              "stairs_down",
              "أرى درجًا هابطًا",
              "فحصت الصورة بصريًا: رحلة الدرج تهبط بالنسبة إلى موضع الكاميرا.",
            ],
            [
              "stairs_present_uncertain_direction",
              "أرى الدرج ولا أستطيع حسم اتجاهه",
              "فحصت وجود الدرج؛ الأدلة المرئية غير كافية لحسم صعود أو هبوط بالنسبة إلى الكاميرا.",
            ],
          ]) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "quiet";
            b.textContent = text;
            b.dataset.visualDirection = `${n}:${label}`;
            b.onclick = () => {
              detail.customObjects[n].stairsDirection = { label, evidence };
              objectFields();
              redraw();
              remember();
            };
            panel.append(b);
          }
          $("batch-inline-objects").children[n].prepend(panel);
        }
  }
  async function advance(delta = 1) {
    await flushDraft();
    const items = sequence(),
      n = items.findIndex(i => i.key === detail?.key),
      next = items[n + delta];
    if (next) await inspect(next.key);
    else {
      $("batch-detail").close();
      $("batch-result").textContent =
        "انتهى المسار الحالي. احفظ الصور المفحوصة بزر الدفعة؛ لا تُقبل الاستثناءات تلقائيًا.";
    }
  }
  let owner = null;
  const stage = () => $("batch-stage").value;
  const className = id =>
    getCatalog()?.taxonomy.classes.find(c => c.id === id)?.ar ?? id;
  const deferred = i =>
    progress.drafts[`${stage()}:${i.key}`]?.stamp === i.stamp
      ? (progress.drafts[`${stage()}:${i.key}`]?.values.deferReason ?? "")
      : "";
  function resetIdentity() {
    if (owner !== getActor()?.id) {
      owner = getActor()?.id;
      queue.clear();
      operation = null;
      detail = null;
      progress = { revision: 0, drafts: {} };
      dirty = false;
      clearTimeout(draftTimer);
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
        (!quick || i.stairsCandidate) &&
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
        .filter(i => i.exceptions.length || deferred(i))
        .map(
          i =>
            `<p><strong>${esc(i.id)}</strong> — ${esc(i.exceptions.map(x => issues[x] ?? x).join("، "))} ${esc(deferred(i))}</p>`
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
      progress = await api("/api/batch/progress");
      queue.clear();
      for (const r of progress.queued) queue.set(`${r.stage}:${r.key}`, r);
      operation =
        progress.operation?.status !== "completed" ? progress.operation : null;
      $("batch-progress-status").textContent =
        `فحوص محفوظة لحسابك: ${progress.queued.length} · تحتاج إعادة فحص: ${progress.stale.length}. ${progress.stale.map(r => r.reason).join(" · ")} لا اعتماد تلقائي عند الاستعادة.`;
      $("batch-training-result").textContent = readinessText(board.readiness);
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
    if (quick && detail.customObjects)
      return structuredClone(detail.customObjects);
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
    try {
      await flushDraft();
    } catch (e) {
      $("batch-detail-status").textContent = e.serverError ?? e.message;
      return;
    }
    dirty = false;
    const request = ++epoch;
    $("batch-detail-status").textContent = "جارٍ تحميل النسخة والأدلة…";
    $("batch-fields").disabled = true;
    if (!$("batch-detail").open) $("batch-detail").showModal();
    try {
      const d = await api("/api/batch/inspect", { key, stage: stage() });
      if (request !== epoch) return;
      detail = d;
      detail.customObjects = structuredClone(d.sample.annotation.objects);
      selectedObject = Math.max(
        0,
        detail.customObjects.findIndex(o => o.classId === 23)
      );
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
        d.sample.annotation.objects
          .filter(o => o.classId === 23)
          .map(
            o =>
              `<p>اتجاه الدرج: ${esc(o.stairsDirection?.label ?? "لم يُراجع")} · الدليل: ${esc(o.stairsDirection?.evidence ?? "مطلوب قبل تدريب الاتجاه")} · موضع داخل الصورة فقط، بلا قياس أمتار.</p>`
          )
          .join("") +
        `<p>${esc((d.report?.issues ?? []).map(x => `${x.type}: ${x.action ?? ""}`).join(" · "))}</p>` +
        proposals
          .map(
            x =>
              `<label class="batch-proposal">اقتراح ${esc(className(x.classId))} · ${esc(x.type)} · ثقة ${esc(x.score ?? x.confidence ?? "غير مسجلة")}<select id="batch-proposal-${esc(x.id)}"><option value="defer">غير محسوم</option><option value="accept">فحصته — قبول التصحيح</option><option value="reject">فحصته — إبقاء الوسم الحالي ورفض الاقتراح</option></select></label>`
          )
          .join("");
      $("batch-labels")
        .querySelectorAll("select")
        .forEach(
          s =>
            (s.onchange = () => {
              if (quick) {
                const x = proposals.find(
                  x => `batch-proposal-${x.id}` === s.id
                );
                if (x) {
                  const old = d.sample.annotation.objects.find(
                      o => o.id === x.objectId
                    ),
                    id = x.objectId ?? `proposal-${x.id}`,
                    at = detail.customObjects.findIndex(o => o.id === id);
                  if (s.value === "accept") {
                    const o = {
                      ...(at >= 0
                        ? detail.customObjects[at]
                        : {
                            id,
                            trackId: null,
                            occluded: false,
                            truncated: false,
                            groundContact: "unknown",
                          }),
                      box: x.box,
                      classId: x.classId,
                    };
                    if (at >= 0) detail.customObjects[at] = o;
                    else detail.customObjects.push(o);
                  } else if (old && at >= 0)
                    detail.customObjects[at] = structuredClone(old);
                  else if (!old && at >= 0) detail.customObjects.splice(at, 1);
                }
                objectFields();
              }
              redraw();
              remember();
            })
        );
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
            `<article><strong>${esc(s.id)} · ${esc(s.license)}</strong><p>${esc(s.origin)}</p><small>SHA-256 ${esc(d.evidence.find(e => e.sourceId === s.id)?.sha256 ?? "غير متاح")} — البصمة تثبت هوية الملف ولا تثبت الإذن التجاري.</small><details ${quick ? "" : "open"}><summary>افتح سجل المصدر والترخيص الكامل للتحقق</summary><pre>${esc(d.evidence.find(e => e.sourceId === s.id)?.text ?? "الدليل غير متاح")}</pre></details></article>`
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
      if (quick) {
        const tasks = d.tasks
            .filter(
              t =>
                ![
                  "actual_preparer",
                  "source_inspection",
                  "boxes_exhaustive",
                  "privacy_actual_inspection",
                  "capture_motion",
                ].includes(t.kind)
            )
            .map(t => t.label)
            .join(" · "),
          before = JSON.stringify(d.sourceObjects),
          after = JSON.stringify(d.sample.annotation.objects);
        $("batch-detail-status").textContent +=
          ` ${tasks} ${d.preparation ? `المُعدّ: ${d.preparation.actor} · ${before === after ? "لا اختلاف هندسي مسجل عن المصدر" : "توجد تغييرات عن وسوم المصدر؛ افحص المربعات والاتجاهات"}` : ""} ${!d.report ? "لا تحليل آلي حالي؛ لا تُستنتج اتجاهات أو خصوصية من غيابه." : ""}`;
      }
      const cached = d.report ?? d.preparerReport;
      $("batch-diff").innerHTML = quick
        ? `${d.preparerReport ? "<p>نعرض تحليل إصدار المُعدّ المحفوظ للسياق فقط، وليس استدلالًا جديدًا على الإصدار الحالي.</p>" : ""}<p>مناطق خصوصية آلية مرشحة: ${cached?.privacy?.regions?.length ?? "لا تقرير"}. غياب الكشف لا ينفي المخاطر.</p>${d.preparation ? `<details><summary>مقارنة وسوم المصدر بالإصدار الذي جهزه ${esc(d.preparation.actor)}</summary><pre>${esc(JSON.stringify({ source: d.sourceObjects, prepared: d.sample.annotation.objects, preparerPrivacy: d.preparation.assessment.privacy, reportId: d.preparation.reportId }, null, 2))}</pre></details>` : ""}`
        : "";
      let own = progress.drafts[draftKey(d)];
      try {
        const local = JSON.parse(localStorage.getItem(localKey(d)) ?? "null");
        if (local && (!own?.at || local.at > own.at)) own = local;
      } catch {}
      if (own?.stamp === d.stamp) {
        const v = own.values;
        detail.deferReason = v.deferReason;
        for (const [k, value] of Object.entries(v.conditions ?? {}))
          if ($(`batch-condition-${k}`))
            $(`batch-condition-${k}`).value = value;
        for (const [k, value] of Object.entries(v.privacy ?? {}))
          $(`batch-privacy-${k}`).value = value;
        for (const [k, value] of Object.entries(v.proposalChoices ?? {}))
          if ($(`batch-proposal-${k}`)) $(`batch-proposal-${k}`).value = value;
        if (quick && v.objects)
          detail.customObjects = structuredClone(v.objects);
        $("batch-reason").value = v.reason ?? $("batch-reason").value;
        $("batch-draft-status").textContent =
          "استُعيدت مسودتك فقط؛ يجب تأكيد الفحص بنفسك.";
      } else
        $("batch-draft-status").textContent = own
          ? "مسودة إصدار سابق محفوظة؛ لم تطبق على الإصدار الجديد. افتح المحرر للتسوية أو افحص الإصدار الحالي."
          : "";
      $("batch-fast-nav").hidden = !quick;
      $("batch-fields").classList.toggle("quick-review", quick);
      $("batch-inline-objects").hidden = !quick;
      $("batch-fast-privacy").hidden = !quick;
      $("batch-add-stairs").hidden = !quick || d.stage !== "prepare";
      $("batch-defer").hidden = !quick;
      for (const id of [
        "batch-seen-labels",
        "batch-seen-privacy",
        "batch-seen-sources",
        "batch-commercial",
      ])
        $(id).closest("label").hidden =
          quick || (id === "batch-commercial" && d.stage !== "approve");
      $("batch-quick-check").hidden = quick;
      $("batch-privacy-preparer").hidden =
        d.stage !== "approve" || !d.preparation;
      $("batch-attest").textContent = quick
        ? d.stage === "prepare"
          ? "فحصت الصورة والوسوم والخصوصية وأدلة المصدر — تأكيد تجهيز وإضافة"
          : "راجعت مستقلاً الصورة والحقوق التجارية والخصوصية والوسوم — إضافة للاعتماد النهائي"
        : "فحصت هذه الصورة وأدلتها — أضفها لقائمة الدفعة";
      const list = sequence();
      $("batch-position").textContent =
        `${list.findIndex(i => i.key === key) + 1} / ${list.length}`;
      $("batch-previous").disabled = list.findIndex(i => i.key === key) <= 0;
      objectFields();
      redraw();
      $("batch-fields").disabled = false;
    } catch (e) {
      if (request === epoch)
        $("batch-detail-status").textContent = e.serverError ?? e.message;
    }
  }
  $("batch-attest").onclick = async () => {
    if (busy || !detail) return;
    try {
      await flushDraft();
    } catch {
      return;
    }
    if (quick) {
      for (const k of [
        "batch-seen-labels",
        "batch-seen-privacy",
        "batch-seen-sources",
      ])
        $(k).checked = true;
      $("batch-commercial").checked = detail.stage === "approve";
    }
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
      ...(quick
        ? { objects: proposalObjects(), task: "basira-stairs-v1" }
        : {}),
    };
    try {
      const r = await api("/api/batch/attest", payload);
      progress.revision = r.progressRevision;
      dirty = false;
      try {
        localStorage.removeItem(localKey(d));
      } catch {}
      queue.set(`${d.stage}:${d.key}`, r);
      operation = null;
      if (!quick) $("batch-detail").close();
      render();
    } catch (e) {
      $("batch-detail-status").textContent =
        `لم تُضف الصورة؛ اختياراتك باقية: ${e.serverError ?? e.message}`;
    } finally {
      busy = false;
      $("batch-fields").disabled = false;
      render();
    }
    if (quick && queue.has(`${d.stage}:${d.key}`)) await advance();
  };
  $("batch-commit").onclick = async () => {
    if (busy) return;
    const visible = new Set(
      [...$("batch-board").querySelectorAll("[data-batch-inspect]")].map(
        b => b.dataset.batchInspect
      )
    );
    const selected = [...queue.entries()].filter(
      ([k, r]) => k.startsWith(`${stage()}:`) && (quick || visible.has(r.key))
    );
    if (!selected.length) return;
    busy = true;
    render();
    // Reuse the same operation ID after a lost response; the server never replays a decision.
    operation ??= {
      operationId: crypto.randomUUID(),
      stage: stage(),
      receipts: selected.map(([, r]) => r.receipt),
      ...(quick ? { task: "basira-stairs-v1" } : {}),
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
        (result.preparation ? ` · ${readinessText(result.preparation)}` : "");
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
      flushDraft().catch(() => {});
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
    if (quick) {
      detail.customObjects = structuredClone(detail.sample.annotation.objects);
      objectFields();
    }
    redraw();
    remember();
  };
  $("batch-edit").onclick = () => {
    flushDraft().catch(() => {});
    const key = detail?.key;
    epoch++;
    $("batch-detail").close();
    if (key) openEditor(key);
  };
  $("batch-refresh").onclick = open;
  $("batch-fast-start").onclick = async () => {
    quick = true;
    await open();
    const items = sequence(),
      next = items.find(
        i =>
          !queue.has(`${stage()}:${i.key}`) &&
          i.category !== "high_risk" &&
          !(
            progress.drafts[`${stage()}:${i.key}`]?.stamp === i.stamp &&
            progress.drafts[`${stage()}:${i.key}`]?.values.deferReason
          ) &&
          (stage() !== "approve" || (i.status !== "approved" && i.independent))
      );
    if (next) await inspect(next.key);
    else
      $("batch-result").textContent =
        "لا صور غير مفحوصة في العرض الحالي. راجع القائمة أو احفظ الدفعة المفحوصة.";
  };
  $("batch-show-all").onclick = () => {
    quick = false;
    render();
  };
  $("batch-next").onclick = () =>
    advance().catch(e => ($("batch-detail-status").textContent = e.message));
  $("batch-previous").onclick = () =>
    advance(-1).catch(e => ($("batch-detail-status").textContent = e.message));
  $("batch-defer").onclick = async () => {
    try {
      detail.deferReason =
        "أجلت هذه الصورة لاستكمال الأدلة أو التصحيحات المعروضة؛ لم أعتمدها.";
      remember();
      await flushDraft();
      await advance();
    } catch (e) {
      $("batch-detail-status").textContent = e.serverError ?? e.message;
    }
  };
  $("batch-privacy-absent").onclick = () => {
    for (const k of ["faces", "plates", "personalText"])
      $(`batch-privacy-${k}`).value = "absent";
    remember();
  };
  $("batch-privacy-preparer").onclick = () => {
    for (const [k, v] of Object.entries(detail.preparation.assessment.privacy))
      $(`batch-privacy-${k}`).value = v;
    remember();
  };
  $("batch-add-stairs").onclick = () => {
    detail.customObjects.push({
      id: crypto.randomUUID(),
      classId: 23,
      box: [0.1, 0.1, 0.8, 0.8],
      trackId: null,
      occluded: false,
      truncated: false,
      groundContact: "unknown",
    });
    selectedObject = detail.customObjects.length - 1;
    objectFields();
    redraw();
    remember();
  };
  $("batch-fields").addEventListener("input", remember);
  $("batch-fields").addEventListener("change", remember);
  let drag = null;
  const point = e => {
    const r = $("batch-preview").getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    ];
  };
  $("batch-preview").onpointerdown = e => {
    if (quick && detail?.stage === "prepare" && !busy) {
      drag = point(e);
      e.target.setPointerCapture(e.pointerId);
    }
  };
  $("batch-preview").onpointerup = e => {
    if (!drag) return;
    const end = point(e),
      box = [
        Math.min(drag[0], end[0]),
        Math.min(drag[1], end[1]),
        Math.abs(drag[0] - end[0]),
        Math.abs(drag[1] - end[1]),
      ];
    drag = null;
    if (
      box[2] > 0.002 &&
      box[3] > 0.002 &&
      detail.customObjects[selectedObject]
    ) {
      detail.customObjects[selectedObject].box = box;
      objectFields();
      redraw();
      remember();
    }
  };
  document.addEventListener("keydown", e => {
    if (!quick || !$("batch-detail").open || busy) return;
    const typing =
      /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) ||
      e.target.isContentEditable;
    if (e.ctrlKey && e.key === "Enter") {
      e.preventDefault();
      $("batch-attest").click();
    } else if (!typing) {
      const action = {
        j: "batch-next",
        k: "batch-previous",
        s: "batch-defer",
        0: "batch-privacy-absent",
      }[e.key.toLowerCase()];
      if (action) {
        e.preventDefault();
        $(action).click();
      }
    }
  });
  window.addEventListener("pagehide", () => flushDraft().catch(() => {}));
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
        ...(quick ? { task: "basira-stairs-v1" } : {}),
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
        ...(quick ? { task: "basira-stairs-v1" } : {}),
      });
      $("batch-training-result").textContent = quick
        ? readinessText(r)
        : JSON.stringify(r, null, 2);
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
    hasPending: () => dirty || busy,
  };
}
