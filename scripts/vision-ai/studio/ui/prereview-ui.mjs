const $ = id => document.getElementById(id);
const esc = x =>
  String(x ?? "").replace(
    /[&<>"']/g,
    c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]
  );
const names = {
  rights: "حقوق",
  privacy: "خصوصية",
  labels: "وسوم",
  no_objects_review_hard_negative: "عينة بلا أجسام: راجع السلبية الصعبة",
  synthetic_separate: "اصطناعية منفصلة",
  manifest_conflict: "تعارض الفهرس",
  original_unmatched: "جسم أصلي بلا كشف مطابق",
  incomplete_labels: "اكتمال الوسوم يحتاج مراجعة",
  unsupported_baseline_class: "فئة لا يدعمها النموذج الأساسي",
  metadata_privacy: "بيانات وصفية تحتاج إزالة",
  exposure: "إضاءة تحتاج فحصًا",
  low_resolution: "دقة منخفضة",
  sensitive_text_candidate: "نص حساس محتمل",
  box_disagreement: "اختلاف مربع",
  class_disagreement: "اختلاف تصنيف",
  unlabeled_candidate: "جسم محتمل بلا وسم",
  privacy_region_review: "مراجعة الوجه أو اللوحة",
  low_detail: "تفاصيل قليلة أو طمس محتمل",
  orientation_review: "اتجاه الصورة يحتاج تصحيحًا",
  rights_rejected: "حقوق مرفوضة",
  hash_verified: "بصمة الدليل مطابقة",
  hash_mismatch: "بصمة الدليل مختلفة",
  unreadable: "الدليل غير مقروء",
  missing: "غير متوفر",
  independent_commercial_training_rights_review:
    "مراجعة مستقلة لحقوق التدريب التجاري",
  source_evidence: "دليل المصدر",
  source_origin: "مرجع المصدر",
  license_terms: "شروط الترخيص",
  available_unverified_candidates: "اقتراحات غير معتمدة",
  failed: "تعطل — يحتاج فحصًا يدويًا",
  not_configured: "غير مهيأ",
  completed: "اكتمل تقنيًا؛ ليس تصريح خصوصية",
  blocked_orientation: "متوقف لاختلاف اتجاه الصورة",
};
export function prereviewUI({
  api,
  getCatalog,
  getActor,
  openEditor,
  refresh,
  notify,
  setSequence,
  editRegions,
}) {
  let state = { items: [] },
    busy = false,
    runner,
    detailEpoch = 0;
  async function open() {
    state = await api("/api/prereview");
    const items = state.items.filter(
      i => i.contentKind === $("prereview-kind").value
    );
    $("prereview-progress").textContent =
      `حقيقية ${state.summary.real} · اصطناعية ${state.summary.synthetic} · تقارير حالية ${state.summary.analyzed} · مؤهلة للقطة ${state.summary.eligible}`;
    $("prereview-board").innerHTML = items
      .map(
        i =>
          `<article class="assistant-issue"><label class="check"><input type="checkbox" data-pilot="${i.key}" ${i.eligibleSnapshot ? "" : "disabled"} />${esc(i.id)}</label><small>${esc(i.classIds.map(id => getCatalog().taxonomy.classes.find(c => c.id === id)?.ar ?? id).join("، "))}</small><p>${i.report ? `${i.report.proposals.length} اقتراحات · ${i.report.privacy.regions.length} مناطق خصوصية محتملة` : i.stale ? "تقرير قديم — أعد التحليل" : "لم يُجهز تقرير بعد"} · ${esc(i.blockers.map(x => names[x] ?? x).join("، "))}</p><small>جلسة/مجموعة: ${esc(i.leakageGroup ?? "تحتاج أدلة")} · تقسيم ${esc(i.split ?? "غير مجمد")}</small><button class="quiet" data-open-prereview="${i.key}">فتح الأدلة والاقتراحات</button></article>`
      )
      .join("");
    $("prereview-board")
      .querySelectorAll("[data-open-prereview]")
      .forEach(
        b =>
          (b.onclick = () => {
            setSequence(items.map(i => i.key));
            openEditor(b.dataset.openPrereview);
          })
      );
    $("prereview-export").disabled = !getActor()?.roles.includes("labels");
    const pairs = (state.related?.pairs ?? []).filter(
      p => items.some(i => i.key === p.a) && items.some(i => i.key === p.b)
    );
    $("prereview-related").innerHTML =
      `<h4>الحالات المرتبطة للتنقل</h4><p>نتيجة آخر فحص محفوظ؛ أعد الفحص في قسم التشابه قبل القرار المستقل. لا اعتماد أو دمج أو حذف عبر هذه الأزرار.</p>` +
      pairs
        .map(
          (p, n) =>
            `<button class="quiet" data-related-pair="${n}">زوج ${n + 1} · ${p.requiresReview ? "غير محسوم" : p.decision ? "راجع القرار المسجل" : "تطابق آلي؛ ليس اعتمادًا"}</button>`
        )
        .join("");
    $("prereview-related")
      .querySelectorAll("[data-related-pair]")
      .forEach(
        b =>
          (b.onclick = () => {
            const p = pairs[+b.dataset.relatedPair];
            setSequence([p.a, p.b]);
            openEditor(p.a);
          })
      );
  }
  async function detail(key) {
    const epoch = ++detailEpoch;
    $("prereview-detail").textContent = "جارٍ تحميل المراجعة المسبقة…";
    state = await api("/api/prereview");
    if (epoch !== detailEpoch) return;
    const item = state.items.find(i => i.key === key),
      r = item?.report ?? item?.previousReport;
    if (!r) {
      $("prereview-detail").textContent =
        "لا تقرير حالي لهذه العينة. شغّل التجهيز من المساعد.";
      return;
    }
    const preparer = getActor()?.roles.includes("annotator") && !item.stale;
    $("prereview-detail").innerHTML =
      `<h3>اقتراح آلي — لم يعتمد بشريًا</h3>${item.stale ? '<p class="warning">تقرير إصدار سابق للقراءة فقط. راجع التصحيحات وهوية المُعدّ في تاريخ العينة؛ أعد التحليل لإصدار اقتراحات حالية.</p>' : ""}<p>المنتج: ${esc(r.producer.id)} · الكشف ${esc(names[r.modelStatus] ?? r.modelStatus)} · فحص الخصوصية ${esc(names[r.privacy.status] ?? r.privacy.status)}</p>
      <p>الإضاءة: ${esc(r.conditions.lighting.value ?? "غير مؤكدة")} (متوسط السطوع ${r.conditions.brightness.toFixed(1)}، قرينة فقط). المكان والحركة يحتاجان أدلة مستقلة.</p>
      <details><summary>أدلة الحقوق والنواقص</summary>${r.rights.map(s => `<p>${esc(s.sourceId)} · ${esc(s.license)} · ${esc(names[s.evidenceStatus] ?? s.evidenceStatus)}</p><p>${esc(s.origin)}</p><p>ناقص: ${esc(s.gaps.map(g => names[g] ?? g).join("، "))}</p>`).join("")}<p>صحة بصمة الدليل لا تعني صحة الحقوق التجارية.</p><button id="prereview-evidence" class="quiet">عرض نصوص الأدلة المحلية المتحققة</button><pre id="prereview-evidence-text"></pre></details>
      <details open><summary>مشكلات تحتاج التحقق</summary>${r.issues.map(x => `<p>${esc(names[x.type] ?? x.type)} — ${esc(x.action)} ${x.objectId ? `(${esc(x.objectId)})` : ""}</p>`).join("")}</details>
      <p>حدد الاقتراحات التي تحققت منها بصريًا فقط. الدرجة ليست احتمال صحة معايرًا. الأجسام الأصلية غير المطابقة تبقى محفوظة. غير المحدد مؤجل ولا يعني رفضًا. راجع الحجب والاقتطاع للأجسام المضافة في المحرر؛ افتراضهما الأولي «لا» لا يعد دليلًا.</p>
      ${r.proposals.map(p => `<label class="check"><input type="checkbox" data-confirm-proposal="${p.id}" ${preparer ? "" : "disabled"} />${esc(getCatalog().taxonomy.classes.find(c => c.id === p.classId)?.ar)} · ${esc(names[p.type] ?? p.type)} · ${Math.round(p.confidence * 100)}% <button type="button" class="quiet" data-focus-proposal="${p.id}">عرض المربع</button></label><label class="check"><input type="checkbox" data-reject-proposal="${p.id}" ${preparer ? "" : "disabled"} />أرفض هذا الاقتراح في التجهيز</label>`).join("")}
      <p>${r.privacy.regions.length} مناطق حساسة محتملة. غياب الكشف لا يثبت خلو الصورة. لا تغطِّ نسب العمل أو العلامات المائية لتجاوز شروط الحقوق. كواشف الوجوه قد تفوت الحجب والزوايا والإضاءة الضعيفة، وكاشف اللوحات محدود النطاق وغير معتمد للوحات السعودية. أنماط OCR ليست شاملة.</p>
      ${r.draft && !item.stale ? `<details><summary>مقارنة الأصل والنسخة المقترحة غير المفعلة</summary><div class="prereview-compare"><figure><img src="/media/image/${key}?original=1" alt="الأصل المحفوظ" /><figcaption>الأصل</figcaption></figure><figure><img src="/media/prereview/${r.id}" alt="نسخة التنقيح المقترحة" /><figcaption>مقترح بلا بيانات وصفية — يحتاج فحص التغطية</figcaption></figure></div></details>` : ""}
      <label class="check"><input id="prereview-confirm-human" type="checkbox" ${preparer ? "" : "disabled"} />فحصت الصورة والاختيارات بنفسي بصفتي المُعدّ الحالي؛ هذا تصحيح وليس اعتمادًا مستقلًا</label>
      <button id="prereview-save-proposals" class="primary" ${preparer ? "" : "disabled"}>تأكيد المختار وحفظ إصدار وسوم</button>
      <button id="prereview-use-draft" class="quiet" ${preparer && r.draft ? "" : "disabled"}>تفعيل النسخة كتصحيح المُعدّ فقط</button>
      <button id="prereview-edit-regions" class="quiet" ${preparer ? "" : "disabled"}>تعديل المناطق في محرر التنقيح القائم</button>
      <p>السبب من حقل «سبب التعديل» أدناه. كل حفظ يبطل التقرير السابق ويعيد بوابات المراجعة. سجل المُعدّ في تاريخ العينة؛ لا تسجل الأداة قرارًا باسم رائد أو عامر.</p>`;
    $("prereview-edit-regions").onclick = () => {
      try {
        editRegions(r);
        notify(
          "نُقلت المناطق للمحرر فقط. احذف الاقتراحات الخاطئة وأضف الناقص ثم أكد حفظ نسخة مستقلة."
        );
      } catch (e) {
        notify(e.message);
      }
    };
    for (const checkbox of $("prereview-detail").querySelectorAll(
      "[data-confirm-proposal], [data-reject-proposal]"
    )) {
      checkbox.onchange = () => {
        if (!checkbox.checked) return;
        const id =
          checkbox.dataset.confirmProposal ?? checkbox.dataset.rejectProposal;
        const other = $("prereview-detail").querySelector(
          checkbox.dataset.confirmProposal
            ? '[data-reject-proposal="' + id + '"]'
            : '[data-confirm-proposal="' + id + '"]'
        );
        if (other) other.checked = false;
      };
    }
    $("prereview-evidence").onclick = async () => {
      try {
        const proof = await api("/api/evidence/" + key);
        if (epoch !== detailEpoch) return;
        $("prereview-evidence-text").textContent = JSON.stringify(
          proof,
          null,
          2
        );
      } catch (e) {
        if (epoch === detailEpoch)
          $("prereview-evidence-text").textContent = e.message;
      }
    };
    $("prereview-detail")
      .querySelectorAll("[data-focus-proposal]")
      .forEach(
        b =>
          (b.onclick = () => {
            const p = r.proposals.find(p => p.id === b.dataset.focusProposal),
              [x, y, w, h] = p.box;
            $("review-task-overlay").innerHTML =
              `<rect x="${x * 1000}" y="${y * 1000}" width="${w * 1000}" height="${h * 1000}" fill="none" stroke="#bd3d47" stroke-width="4"/>`;
          })
      );
    async function confirm(action) {
      try {
        await api("/api/prereview/confirm", {
          reportId: r.id,
          version: r.itemVersion,
          action,
          reason: $("reason").value,
          confirm: $("prereview-confirm-human").checked,
          rejectedProposalIds: [
            ...$("prereview-detail").querySelectorAll(
              "[data-reject-proposal]:checked"
            ),
          ].map(x => x.dataset.rejectProposal),
          proposalIds: [
            ...$("prereview-detail").querySelectorAll(
              "[data-confirm-proposal]:checked"
            ),
          ].map(x => x.dataset.confirmProposal),
        });
        await refresh();
        await openEditor(key);
        notify("حُفظ التصحيح باسم حسابك الفعلي. يحتاج مراجعة مستقلة.");
      } catch (e) {
        notify(e.message);
      }
    }
    $("prereview-save-proposals").onclick = () => confirm("labels");
    $("prereview-use-draft").onclick = () => confirm("draft");
  }
  $("prereview-kind").onchange = () => open().catch(e => notify(e.message));
  $("prereview-refresh").onclick = () => open().catch(e => notify(e.message));
  $("prereview-run").onclick = async () => {
    if (busy) return;
    busy = true;
    $("prereview-run").disabled = true;
    let complete = 0,
      failed = 0;
    try {
      runner ??= await import("/local-models.mjs");
      const kind = $("prereview-kind").value,
        items = getCatalog().items.filter(i => i.contentKind === kind);
      for (const i of items) {
        $("prereview-progress").textContent =
          `تجهيز ${complete + failed + 1}/${items.length} · أخطاء ${failed}`;
        try {
          await api("/api/assistant/analyze", { key: i.key });
          const out = await runner.analyzeLocalImage(
            `/media/image/${i.key}?v=${i.version}`,
            getCatalog().taxonomy,
            { withOCR: true }
          );
          await api("/api/assistant/model-results", {
            key: i.key,
            version: i.version,
            imageSha256: i.activeSha256 ?? i.sample.sha256,
            ...out,
          });
          await api("/api/prereview/analyze", { key: i.key });
          complete++;
        } catch {
          failed++;
        }
      }
      await api("/api/assistant/scan", {});
      await open();
      notify(
        `اكتمل ${complete}؛ تعذر ${failed}. راجع تشابه الصور في القسم القائم أدناه.`
      );
    } catch (e) {
      notify(e.message);
    } finally {
      busy = false;
      $("prereview-run").disabled = false;
    }
  };
  $("prereview-export").onclick = async () => {
    try {
      const keys = [
        ...$("prereview-board").querySelectorAll("[data-pilot]:checked"),
      ].map(x => x.dataset.pilot);
      const result = await api("/api/export-reviewed-selection", { keys });
      notify(`لقطة ${result.samples} عينات: ${result.path}. لم يبدأ التدريب.`);
    } catch (e) {
      notify(e.message);
    }
  };
  $("prereview-packet").onclick = async () => {
    try {
      const packet = await api("/api/prereview/packet");
      const url = URL.createObjectURL(
          new Blob([JSON.stringify(packet, null, 2)], {
            type: "application/json",
          })
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = "basira-prereview-chatgpt.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify(
        "تقرير تجميعي بلا صور أو أسماء ملفات أو OCR. راجعه ثم شاركه يدويًا."
      );
    } catch (e) {
      notify(e.message);
    }
  };
  return {
    open,
    detail,
    cancel: () => {
      detailEpoch++;
    },
  };
}
