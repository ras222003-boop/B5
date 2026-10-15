import { assistantUI } from "./assistant-ui.mjs";
const $ = id => document.getElementById(id),
  esc = v =>
    String(v ?? "").replace(
      /[&<>"']/g,
      c =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]
    );
let csrf,
  actor,
  catalog,
  selected,
  objects = [],
  fingerprint = "",
  drawing = null,
  polling = false;
let reviewQueue = { items: [], stale: 0 };
let visibleKeys = [],
  sequence = [],
  eligibility = { allowedKinds: [] },
  editorRequest = 0;
const states = {
  approved: "مكتملة المراجعة",
  pending: "بانتظار المراجعة",
  incomplete: "ناقصة",
  rejected: "مرفوضة",
};
const notify = message => {
  $("message").textContent = message;
  setTimeout(() => {
    if ($("message").textContent === message) $("message").textContent = "";
  }, 7000);
};
const errorText = text => {
  for (const [pattern, message] of [
    [
      /Role not authorized|reviewer role required/,
      "حسابك لا يملك صلاحية هذا القرار.",
    ],
    [/Independent reviewer/, "يجب أن يراجع العمل شخص مختلف عن المحرر."],
    [/Revision conflict/, "يوجد إصدار أحدث. أعد فتح العينة قبل حفظ التعديل."],
    [
      /Manifest changed/,
      "تغير فهرس الدفعة. تحتاج التعديلات السابقة إلى تسوية في دفعة جديدة.",
    ],
    [
      /SHA-256 mismatch|SHA mismatch/,
      "تغيرت بصمة أحد الملفات. راجع المصدر قبل الاستكمال.",
    ],
    [
      /Strip metadata/,
      "أرفق نسخة منقحة خالية من البيانات الوصفية قبل اعتماد الخصوصية.",
    ],
    [/Scene conditions/, "حدد الإضاءة والمكان وحركة الالتقاط بعد مراجعتها."],
    [/Explicit privacy/, "سجل نتيجة مراجعة الوجوه واللوحات والنصوص الشخصية."],
    [/Exhaustive/, "أكمل مراجعة كل الأجسام والوسوم أولًا."],
    [
      /Invalid class|bounding box|Duplicate box/,
      "راجع التصنيف وحدود الصناديق وتكرارها.",
    ],
    [
      /Entire batch/,
      "تحتاج جميع عينات الدفعة الحقيقية إلى مراجعات مستقلة مكتملة.",
    ],
    [/No local users/, "أنشئ حسابات الفريق المحلية باستخدام --add-user."],
    [/Invalid credentials/, "معرّف الحساب أو كلمة المرور غير صحيحة."],
    [/locked/, "توقفت محاولات الدخول مؤقتًا. أعد المحاولة بعد دقيقة."],
    [/Session|CSRF/, "أعد تحميل اللوحة لتجديد جلسة العمل."],
    [/Decision reason/, "اكتب سببًا واضحًا للتعديل أو القرار."],
  ])
    if (pattern.test(text)) return message;
  return text;
};
async function api(path, data) {
  const r = await fetch(path, {
    headers: data
      ? { "Content-Type": "application/json", "X-Studio-CSRF": csrf }
      : {},
    method: data ? "POST" : "GET",
    body: data ? JSON.stringify(data) : undefined,
  });
  const value = await r.json();
  if (!r.ok) throw new Error(errorText(value.error));
  return value;
}
const classes = () =>
  catalog?.taxonomy.classes.filter(c => c.kind !== "surface") ?? [];
const className = id => classes().find(c => c.id === id)?.ar ?? String(id);
function boxesSvg(item) {
  return (item.sample.annotation?.objects ?? [])
    .map(
      o =>
        `<rect x="${o.box[0] * item.sample.width}" y="${o.box[1] * item.sample.height}" width="${o.box[2] * item.sample.width}" height="${o.box[3] * item.sample.height}" fill="none" stroke="#ebd568" stroke-width="2" vector-effect="non-scaling-stroke"/>`
    )
    .join("");
}
function render() {
  if (!catalog) return;
  const s = catalog.summary;
  $("content-counts").textContent =
    `بيانات حقيقية: ${catalog.items.filter(i => i.contentKind === "real").length} · اصطناعية: ${catalog.items.filter(i => i.contentKind === "synthetic").length} (مستبعدة من التقييم الحقيقي والمعايرة)`;
  for (const [id, v] of Object.entries({
    total: s.images,
    approved: s.approved,
    rejected: s.rejected,
    incomplete: s.incomplete,
  }))
    $(id).textContent = v;
  $("catalog-note").textContent =
    `${catalog.batches.length} دفعات · ${s.pending} بانتظار المراجعة · ${s.videos} فيديوهات`;
  const value = $("class-filter").value;
  const sourceValue = $("source-filter").value;
  $("source-filter").innerHTML =
    '<option value="">كل المصادر</option><option value="licensed_dataset">مجموعة مرخصة</option><option value="basira_team">فريق بصيرة</option>' +
    catalog.batches
      .map(
        b =>
          `<option value="batch:${esc(b.key)}">${esc(b.id)} · ${esc(b.manifest.split("/").slice(0, -1).join("/"))}</option>`
      )
      .join("");
  $("source-filter").value = sourceValue;
  $("class-filter").innerHTML =
    '<option value="">كل الفئات</option>' +
    classes()
      .map(c => `<option value="${c.id}">${esc(c.ar)}</option>`)
      .join("");
  $("class-filter").value = value;
  $("class-counts").innerHTML = Object.entries(s.classCounts)
    .map(
      ([id, n]) =>
        `<span class="class-chip">${esc(className(+id))} · ${n}</span>`
    )
    .join("");
  const query = $("search").value.toLowerCase(),
    cls = $("class-filter").value,
    source = $("source-filter").value,
    status = $("status-filter").value;
  const list = catalog.items.filter(
    i =>
      (!$("content-filter").value ||
        i.contentKind === $("content-filter").value) &&
      (!cls ||
        i.sample.annotation?.objects?.some(o => o.classId === +cls) ||
        i.sample.candidateClassId === +cls) &&
      (!source ||
        (source.startsWith("batch:")
          ? i.batchKey === source.slice(6)
          : i.sources.some(s => s.kind === source))) &&
      (!status || i.status === status) &&
      `${i.sample.id} ${i.batch} ${(i.sample.annotation?.objects ?? []).map(o => className(o.classId)).join(" ")}`
        .toLowerCase()
        .includes(query)
  );
  list.sort(
    (a, b) =>
      (reviewQueue.items.find(i => i.key === a.key)?.priority ?? 99) -
      (reviewQueue.items.find(i => i.key === b.key)?.priority ?? 99)
  );
  visibleKeys = list.map(i => i.key);
  $("start-final-review").disabled = !visibleKeys.length;
  $("review-plan-note").textContent = reviewQueue.items.length
    ? `قائمة مراجعة مرتبة: ${reviewQueue.items.length} عينات · ${reviewQueue.stale} قوائم قديمة محجوبة. الاقتراحات ليست وسومًا أو اعتمادات.`
    : "لا توجد قائمة مراجعة محلية بعد.";
  $("grid").innerHTML = list
    .map(
      i =>
        `<button class="card" data-item="${i.key}" aria-label="مراجعة ${esc(i.sample.id)}"><div class="thumbnail"><span class="badge ${i.status}">${states[i.status]}</span><img src="/media/image/${i.key}?v=${i.version}" width="${i.sample.width ?? 640}" height="${i.sample.height ?? 480}" loading="lazy" alt="${esc(i.sample.id)}"><svg viewBox="0 0 ${i.sample.width ?? 640} ${i.sample.height ?? 480}" aria-hidden="true">${boxesSvg(i)}</svg></div><div class="card-body"><div class="card-title">${esc(i.sample.id)}</div><div class="card-meta">${esc(i.batch)} ${i.contentKind === "synthetic" ? "· اصطناعي" : ""}</div><div class="card-footer"><span class="tag">${i.sample.annotation?.objects?.length ?? 0} وسوم</span>${[
          ...new Set((i.sample.annotation?.objects ?? []).map(o => o.classId)),
        ]
          .slice(0, 3)
          .map(id => `<span class="tag">${esc(className(id))}</span>`)
          .join("")}</div></div></button>`
    )
    .join("");
  $("empty").hidden = !!list.length;
  $("issues").hidden = !catalog.issues.length;
  $("issues").textContent =
    `${catalog.issues.length} ملف أو مسار يحتاج فحصًا: ${catalog.issues
      .map(i => i.error)
      .slice(0, 3)
      .join(" · ")}`;
  $("videos").innerHTML = catalog.videos.length
    ? catalog.videos
        .map(
          v =>
            `<article class="video-card"><video src="/media/video/${v.key}" controls preload="metadata"></video><p>${esc(v.batch)} · ${esc(v.path.split("/").at(-1))}</p><span class="badge pending">مراجعة الأصل والصوت مطلوبة</span></article>`
        )
        .join("")
    : '<p class="muted">لا توجد فيديوهات مفهرسة حاليًا.</p>';
  $("grid")
    .querySelectorAll("[data-item]")
    .forEach(b => (b.onclick = () => startReview(b.dataset.item)));
  renderExport();
}
async function refresh() {
  if (!actor || polling) return;
  polling = true;
  try {
    const c = await api("/api/catalog");
    reviewQueue = await api("/api/review-plan");
    const f = JSON.stringify({ catalog: c, reviewQueue });
    catalog = c;
    if (f !== fingerprint) {
      fingerprint = f;
      render();
    }
    $("sync").textContent =
      "تم التحديث " +
      new Date().toLocaleTimeString("ar-SA", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
  } catch (e) {
    notify(e.message);
  } finally {
    polling = false;
  }
}
function renderExport() {
  const previous = $("batch-export").value;
  $("batch-export").innerHTML = catalog.batches
    .map(
      b =>
        `<option value="${esc(b.key)}">${esc(b.id)} · ${esc(b.manifest.split("/").slice(0, -1).join("/"))}</option>`
    )
    .join("");
  if (previous) $("batch-export").value = previous;
  const items = catalog.items.filter(
    i => i.batchKey === $("batch-export").value
  );
  $("export-reviewed").disabled =
    !actor?.roles.includes("labels") ||
    !items.length ||
    items.some(i => i.status !== "approved" || i.contentKind !== "real");
}
function renderObjects() {
  $("objects").innerHTML = objects
    .map(
      (o, index) =>
        `<div class="object-row"><div class="object-top"><select aria-label="فئة الجسم ${index + 1}" data-class="${index}">${classes()
          .map(
            c =>
              `<option value="${c.id}" ${c.id === o.classId ? "selected" : ""}>${esc(c.ar)}</option>`
          )
          .join(
            ""
          )}</select><button class="danger remove" data-remove="${index}" aria-label="حذف الجسم ${index + 1}">×</button></div><div class="coords">${["x", "y", "w", "h"].map((name, j) => `<label>${name}<input data-coord="${index},${j}" type="number" min="0" max="1" step="0.001" value="${o.box[j]}"></label>`).join("")}</div></div>`
    )
    .join("");
  $("objects")
    .querySelectorAll("[data-class]")
    .forEach(
      el =>
        (el.onchange = () => {
          objects[+el.dataset.class].classId = +el.value;
          drawBoxes();
        })
    );
  $("objects")
    .querySelectorAll("[data-remove]")
    .forEach(
      el =>
        (el.onclick = () => {
          objects.splice(+el.dataset.remove, 1);
          renderObjects();
        })
    );
  $("objects")
    .querySelectorAll("[data-coord]")
    .forEach(
      el =>
        (el.oninput = () => {
          const [i, j] = el.dataset.coord.split(",").map(Number);
          objects[i].box[j] = +el.value;
          drawBoxes();
        })
    );
  drawBoxes();
}
function drawBoxes() {
  $("overlay").innerHTML = objects
    .map(
      (o, i) =>
        `<rect x="${o.box[0] * 1000}" y="${o.box[1] * 1000}" width="${o.box[2] * 1000}" height="${o.box[3] * 1000}" fill="none" stroke="#f8dc59" stroke-width="3" vector-effect="non-scaling-stroke"/><text x="${o.box[0] * 1000 + 7}" y="${o.box[1] * 1000 + 30}" fill="#17332e" stroke="#fff" stroke-width="1" font-size="28">${i + 1}</text>`
    )
    .join("");
}
async function openEditor(key) {
  const request = ++editorRequest;
  if (!sequence.includes(key)) sequence = [key];
  selected = structuredClone(catalog.items.find(i => i.key === key));
  eligibility = { allowedKinds: [] };
  updateReviewButtons();
  const position = sequence.indexOf(key);
  $("review-position").textContent =
    `صورة ${position + 1} من ${sequence.length} · ${selected.contentKind === "synthetic" ? "اصطناعية — مستبعدة من التقييم الحقيقي" : "حقيقية"}`;
  $("review-previous").disabled = position <= 0;
  $("review-next").disabled = position < 0 || position >= sequence.length - 1;
  objects = structuredClone(selected.sample.annotation?.objects ?? []);
  assistant.reset();
  $("review-task-overlay").replaceChildren();
  const plan = reviewQueue.items.find(
    i => i.key === key && i.version === selected.version
  );
  $("review-tasks").innerHTML = plan
    ? `<p>أولوية ${plan.priority} · راجع الأصل والنسخة. لا اعتماد آلي.</p>` +
      plan.tasks
        .map(
          (t, n) =>
            `<article class="assistant-issue"><strong>${esc(t.label)}</strong>${t.classId ? `<p>${esc(className(t.classId))}</p>` : ""}${t.box ? `<button class="quiet" data-focus-task="${n}">عرض المنطقة المرشحة</button>` : ""}${t.score !== null ? `<small>درجة نموذج غير معايرة: ${Math.round(t.score * 100)}%</small>` : ""}</article>`
        )
        .join("")
    : "لا مهام محلية لهذا الإصدار.";
  $("review-tasks")
    .querySelectorAll("[data-focus-task]")
    .forEach(
      b =>
        (b.onclick = () => {
          const [x, y, w, h] = plan.tasks[+b.dataset.focusTask].box;
          $("review-task-overlay").innerHTML =
            `<rect x="${x * 1000}" y="${y * 1000}" width="${w * 1000}" height="${h * 1000}" fill="none" stroke="#bd3d47" stroke-width="4" stroke-dasharray="10 6"/>`;
        })
    );
  $("editor-title").textContent = selected.sample.id;
  $("revision").textContent =
    `الإصدار ${selected.version} · ${states[selected.status]}`;
  $("editor-image").src = `/media/image/${key}?v=${selected.version}`;
  $("reason").value = "";
  $("confirm-review").checked = false;
  for (const name of ["faces", "plates", "personalText"])
    $(name).value = "unreviewed";
  $("evidence").textContent = JSON.stringify(
    {
      sources: selected.sources,
      privacy: selected.sample.privacy,
      annotation: selected.sample.annotation,
      motionSegments: selected.motionSegments,
      conflict: selected.conflict,
    },
    null,
    2
  );
  try {
    const proof = await api("/api/evidence/" + key);
    if (request !== editorRequest) return;
    $("evidence").textContent += "\n\n" + JSON.stringify(proof, null, 2);
  } catch (e) {
    if (request !== editorRequest) return;
    $("evidence").textContent += "\n\n" + e.message;
  }
  $("review-status").innerHTML = ["rights", "privacy", "labels"]
    .map(k => {
      const record =
        selected.decisions?.[k] ??
        (k === "privacy"
          ? selected.sample.privacy
          : k === "labels"
            ? selected.sample.annotation
            : selected.sources[0]?.rightsReview);
      const status =
        record?.status === "reviewed"
          ? "approved"
          : (record?.status ?? "pending");
      return `<p>${{ rights: "الحقوق", privacy: "الخصوصية", labels: "الوسوم" }[k]}: ${esc(states[status] ?? "بانتظار المراجعة")} ${esc(record?.reviewer ?? "")}</p>`;
    })
    .join("");
  $("spatial").innerHTML =
    "<strong>المسافة والحركة المرجعية</strong>" +
    objects
      .map(o => {
        const d = o.spatial?.distance;
        return `<p>${esc(className(o.classId))}: ${d?.status === "measured" && selected.measurements?.[o.id]?.validContract ? `قياس مرجعي مسجل ${esc(d.meters)} م ± ${esc(d.uncertaintyMeters)} · ${esc(d.method)} · يحتاج اعتماد الدليل` : "المسافة غير مؤكدة — لا يوجد قياس متري متحقق منه"}<br>اتجاه الكاميرا: ${esc({ unknown: "غير معلوم", left: "يسار الصورة", center: "وسط الصورة", right: "يمين الصورة" }[o.spatial?.direction?.sector ?? "unknown"])}</p>`;
      })
      .join("") +
    `<p>${selected.motionSegments.length} مقاطع حركة مسجلة؛ التفاصيل في الأدلة أدناه.</p>`;
  for (const name of ["lighting", "scene", "motion"])
    $("condition-" + name).value =
      selected.sample.conditions?.[name] ?? "unreviewed";
  renderObjects();
  try {
    const e = await api("/api/review-eligibility/" + key);
    if (request !== editorRequest) return;
    if (selected.key === key && e.version === selected.version) eligibility = e;
  } catch (e) {
    if (request !== editorRequest) return;
    notify(e.message);
  }
  updateReviewButtons();
  $("save-labels").disabled = !actor.roles.includes("annotator");
  $("derivative").disabled = !actor.roles.includes("annotator");
  if (!$("editor").open) $("editor").showModal();
  const h = await api("/api/history/" + key);
  if (request !== editorRequest) return;
  $("history").innerHTML = h.revisions.length
    ? h.revisions
        .map(
          r =>
            `<div class="history-row">إصدار ${r.version} · ${esc(r.actor)} · ${esc(r.at)}<br>${esc(r.action)} — ${esc(r.reason)}</div>`
        )
        .join("")
    : '<p class="muted">لم تُسجل تعديلات بعد.</p>';
}
function startReview(key = visibleKeys[0]) {
  sequence = [...visibleKeys];
  return openEditor(key);
}
$("start-final-review").onclick = () => startReview();
async function moveReview(offset) {
  const key = sequence[sequence.indexOf(selected?.key) + offset];
  if (!key) return;
  await refresh();
  if (!catalog.items.some(i => i.key === key)) {
    notify("العينة لم تعد متاحة. أعد بدء المراجعة من المكتبة.");
    return;
  }
  $("editor").close();
  await openEditor(key);
}
$("review-previous").onclick = () => moveReview(-1);
$("review-next").onclick = () => moveReview(1);
function updateReviewButtons() {
  const kind = $("review-kind").value;
  const forbidden = !eligibility.allowedKinds.includes(kind);
  $("approve").disabled = forbidden;
  $("reject").disabled = forbidden;
  $("privacy-fields").hidden = kind !== "privacy";
  $("review-eligibility").textContent = forbidden
    ? "القرار محجوب: يلزم دور المراجعة واستقلال الحساب عن جميع المساهمين في إعداد العينة، وسلامة إصدارها."
    : "حسابك مؤهل للمراجعة المستقلة لهذا الإصدار. القبول يتطلب الفحص الفعلي والأدلة والسبب.";
  const conditions = selected?.sample.conditions;
  $("review-blockers").textContent =
    kind === "labels" &&
    (!conditions || Object.values(conditions).includes("unreviewed"))
      ? "الوسوم غير جاهزة للقبول: يجب أن يستكمل مُعِدّ مستقل ظروف المشهد قبل مراجعتك. إذا عدلتها بنفسك فلن تستطيع اعتماد عملك."
      : "غياب اقتراح آلي لا يثبت سلامة الخصوصية أو اكتمال الوسوم. القبول يخص نوع المراجعة المحدد فقط.";
}
$("review-kind").onchange = updateReviewButtons;
async function change(payload) {
  if (!selected) return;
  try {
    await api("/api/items/" + selected.key, {
      ...payload,
      version: selected.version,
      reason: $("reason").value,
    });
    const key = selected.key;
    await refresh();
    $("editor").close();
    await openEditor(key);
    notify("حُفظ إصدار مستقل مع هويتك ووقت القرار.");
  } catch (e) {
    notify(e.message);
  }
}
$("save-labels").onclick = () =>
  change({
    action: "labels",
    objects,
    conditions: Object.fromEntries(
      ["lighting", "scene", "motion"].map(n => [n, $("condition-" + n).value])
    ),
  });
$("batch-export").onchange = renderExport;
$("export-reviewed").onclick = async () => {
  try {
    const r = await api("/api/export-reviewed", {
      batch: $("batch-export").value,
    });
    $("export-result").textContent =
      `حُفظ ${r.path} · ${r.frozenSplitPreserved ? "حُفظ التقسيم الأصلي المجمد" : "يحتاج تقسيمًا مجمدًا"} والتحقق بأدوات vision-ai؛ لم يبدأ تدريب.`;
    notify("حُفظت لقطة المراجعات للمسار القائم.");
  } catch (e) {
    notify(e.message);
  }
};
$("approve").onclick = () => {
  if (!$("confirm-review").checked) {
    notify("أكد إتمام المراجعة البشرية أولًا.");
    return;
  }
  change({
    action: "review",
    kind: $("review-kind").value,
    status: "approved",
    exhaustive: true,
    metadataStripped: true,
    faces: $("faces").value,
    plates: $("plates").value,
    personalText: $("personalText").value,
  });
};
$("reject").onclick = () => {
  if (!$("confirm-review").checked) {
    notify("أكد إتمام المراجعة البشرية أولًا.");
    return;
  }
  return change({
    action: "review",
    kind: $("review-kind").value,
    status: "rejected",
  });
};
$("derivative").onchange = async () => {
  const file = $("derivative").files[0];
  if (!file) return;
  if (file.size > 16_000_000) {
    notify("الحد الأقصى 16MB");
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  await change({ action: "derivative", image: btoa(binary) });
  $("derivative").value = "";
};
const point = e => {
  const r = $("overlay").getBoundingClientRect();
  return [
    Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
    Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
  ];
};
$("overlay").onpointerdown = e => {
  if (!actor?.roles.includes("annotator")) return;
  drawing = point(e);
  $("overlay").setPointerCapture(e.pointerId);
};
$("overlay").onpointerup = e => {
  if (!drawing) return;
  const p = point(e),
    x = Math.min(p[0], drawing[0]),
    y = Math.min(p[1], drawing[1]),
    w = Math.abs(p[0] - drawing[0]),
    h = Math.abs(p[1] - drawing[1]);
  drawing = null;
  if (w < 0.005 || h < 0.005) return;
  if (assistant.isRedactionMode()) {
    assistant.addRegion([x, y, w, h]);
    return;
  }
  objects.push({
    id: crypto.randomUUID(),
    classId: classes()[0].id,
    box: [x, y, w, h],
    trackId: selected.sample.media?.kind === "video_frame" ? "new-track" : null,
    occluded: false,
    truncated: false,
    groundContact: "unknown",
  });
  renderObjects();
};
$("overlay").onpointercancel = () => {
  drawing = null;
};
$("close-editor").onclick = () => $("editor").close();
for (const id of [
  "search",
  "class-filter",
  "source-filter",
  "status-filter",
  "content-filter",
])
  $(id).addEventListener(id === "search" ? "input" : "change", render);
async function setActor(a) {
  actor = a;
  $("identity").textContent = a ? `${a.name} · ${a.id}` : "لم تسجّل الدخول";
  $("login-panel").hidden = !!a;
  $("workspace").hidden = !a;
  $("logout").hidden = !a;
  if (a) await refresh();
}
$("login").onsubmit = async e => {
  e.preventDefault();
  const values = new FormData(e.target);
  try {
    const r = await api("/api/login", {
      id: values.get("id"),
      password: values.get("password"),
    });
    csrf = r.csrf;
    e.target.reset();
    await setActor(r.actor);
  } catch (e) {
    notify(e.message);
  }
};
$("logout").onclick = async () => {
  const r = await api("/api/logout", {});
  csrf = r.csrf;
  if ($("editor").open) $("editor").close();
  catalog = null;
  fingerprint = "";
  $("grid").replaceChildren();
  await setActor(null);
};
document.querySelectorAll("[data-tab]").forEach(
  b =>
    (b.onclick = async () => {
      document
        .querySelectorAll("[data-tab]")
        .forEach(el => el.classList.toggle("active", el === b));
      $("gallery-panel").hidden = b.dataset.tab !== "gallery";
      $("experiments-panel").hidden = b.dataset.tab !== "experiments";
      $("assistant-panel").hidden = b.dataset.tab !== "assistant";
      if (b.dataset.tab === "assistant" && actor) await assistant.open();
      if (b.dataset.tab === "experiments" && actor) {
        const r = await api("/api/experiments");
        $("experiment-list").innerHTML = r.results.length
          ? r.results
              .map(
                e =>
                  `<article class="panel experiment"><h3>${esc(e.path)}</h3><pre>${esc(JSON.stringify(e.result ?? e.error, null, 2))}</pre></article>`
              )
              .join("")
          : '<div class="empty">لا توجد نتائج تدريب مسجلة. يبدأ سجل التجارب بعد الاعتماد وتشغيل المسار القائم.</div>';
      }
    })
);
const assistant = assistantUI({
  api,
  getCatalog: () => catalog,
  getSelected: () => selected,
  getActor: () => actor,
  refresh,
  openEditor,
  notify,
  acceptProposal: p => {
    const o = p.objectId ? objects.find(o => o.id === p.objectId) : null;
    if (o) {
      o.classId = p.classId;
      o.box = p.box;
    } else
      objects.push({
        id: crypto.randomUUID(),
        classId: p.classId,
        box: p.box,
        trackId:
          selected.sample.media?.kind === "video_frame" ? "new-track" : null,
        occluded: false,
        truncated: false,
        groundContact: "unknown",
      });
    renderObjects();
  },
});
try {
  const bootstrap = await api("/api/bootstrap");
  csrf = bootstrap.csrf;
  await setActor(bootstrap.actor);
} catch (e) {
  notify(e.message);
}
setInterval(refresh, 2000);
