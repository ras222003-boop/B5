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
const names = {
  metadata_privacy: "بيانات وصفية قد تمس الخصوصية",
  low_resolution: "دقة منخفضة",
  exposure: "الإضاءة تحتاج مراجعة",
  low_detail: "تفاصيل قليلة أو طمس محتمل",
  incomplete_labels: "اكتمال الوسوم غير مراجع",
  privacy_region_review: "مراجعة الوجه أو اللوحة",
  rights_rejected: "حقوق مرفوضة",
  unlabeled_candidate: "جسم محتمل بلا وسم",
  class_disagreement: "اختلاف تصنيف",
  box_disagreement: "اختلاف مربع",
  sensitive_text_candidate: "نص حساس محتمل",
  orientation_review: "اتجاه الصورة يحتاج تسوية",
};
export function assistantUI({
  api,
  getCatalog,
  getSelected,
  getActor,
  refresh,
  openEditor,
  acceptProposal,
  notify,
}) {
  let latest = null,
    regions = [],
    busy = false,
    runner;
  const show = r => {
    if (
      getSelected()?.key !== r.itemKey ||
      getSelected()?.version !== r.itemVersion
    ) {
      notify("سُجل تقرير لإصدار آخر؛ أعد فتح العينة لعرضه.");
      return;
    }
    latest = r;
    regions = r.redactionRegions?.map(x => x.box) ?? [];
    $("assistant-result").innerHTML =
      `<p>تحليل محلي · ${esc(r.scope)} · الاقتراحات تحتاج مراجعة، ولا تعتمد الصورة.</p>` +
      r.issues
        .map(
          i =>
            `<article class="assistant-issue"><strong>${esc(names[i.type] ?? i.type)}</strong><p>${esc(i.action)}</p><small>الثقة: ${i.confidence === null ? "غير مقدرة" : Math.round(i.confidence * 100) + "%"} · ${esc(i.confidenceKind)}</small></article>`
        )
        .join("") +
      r.proposals
        .map(
          p =>
            `<article class="assistant-issue"><p>اقتراح ${esc(getCatalog().taxonomy.classes.find(c => c.id === p.classId)?.ar)} · ${Math.round(p.confidence * 100)}% (درجة نموذج)</p><button class="quiet" data-proposal="${p.id}">نقل الاقتراح للمحرر</button></article>`
        )
        .join("") +
      `<p>${regions.length} مناطق نصية مقترحة. تحديد الوجوه واللوحات يحتاج نموذجًا متخصصًا أو تحديدًا يدويًا. ${esc(JSON.stringify(r.modelFailures ?? []))}</p>`;
    $("assistant-result")
      .querySelectorAll("[data-proposal]")
      .forEach(b => {
        b.disabled = !getActor()?.roles.includes("annotator");
        b.onclick = () => {
          const s = getSelected();
          if (s.key !== r.itemKey || s.version !== r.itemVersion) {
            notify("الاقتراح قديم؛ أعد التحليل.");
            return;
          }
          acceptProposal(r.proposals.find(p => p.id === b.dataset.proposal));
          notify("اقتراح داخل المحرر فقط. راجعه ثم احفظ إصدارًا بسبب واضح.");
        };
      });
    renderRegions();
  };
  function renderRegions() {
    $("redaction-overlay").innerHTML = regions
      .map(
        ([x, y, w, h]) =>
          `<rect x="${x * 1000}" y="${y * 1000}" width="${w * 1000}" height="${h * 1000}" fill="#b52e3333" stroke="#b52e33" stroke-width="3" vector-effect="non-scaling-stroke"/>`
      )
      .join("");
    $("redaction-regions").innerHTML = regions
      .map(
        (box, n) =>
          `<p>منطقة ${n + 1}: ${box.map(v => v.toFixed(3)).join(" · ")} <button class="quiet" data-remove-region="${n}" aria-label="حذف منطقة ${n + 1}">×</button></p>`
      )
      .join("");
    $("redaction-regions")
      .querySelectorAll("[data-remove-region]")
      .forEach(
        b =>
          (b.onclick = () => {
            regions.splice(+b.dataset.removeRegion, 1);
            renderRegions();
          })
      );
  }
  const run = async models => {
    if (busy) return;
    const item = getSelected();
    if (!item) return;
    busy = true;
    $("assistant-result").textContent = "جارٍ التحليل محليًا على هذا الجهاز…";
    try {
      const base = await api("/api/assistant/analyze", { key: item.key });
      show(base);
      if (models) {
        runner ??= await import("/local-models.mjs");
        const out = await runner.analyzeLocalImage(
          `/media/image/${item.key}?v=${item.version}`,
          getCatalog().taxonomy,
          { withOCR: $("use-ocr").checked }
        );
        show(
          await api("/api/assistant/model-results", {
            key: item.key,
            version: item.version,
            imageSha256: item.activeSha256 ?? item.sample.sha256,
            ...out,
          })
        );
      }
    } catch (e) {
      notify(e.message);
    } finally {
      busy = false;
    }
  };
  $("analyze-quality").onclick = () => run(false);
  $("analyze-models").onclick = () => run(true);
  $("apply-redaction").onclick = async () => {
    const i = getSelected();
    try {
      await api("/api/assistant/redact", {
        key: i.key,
        version: i.version,
        regions,
        confirm: $("confirm-redaction").checked,
        reason: $("reason").value,
        reportIds: latest ? [latest.id] : [],
      });
      await refresh();
      $("editor").close();
      await openEditor(i.key);
      notify("حُفظت نسخة منقحة؛ الحقوق والخصوصية والوسوم تحتاج مراجعة جديدة.");
    } catch (e) {
      notify(e.message);
    }
  };
  $("compare-versions").onclick = () => {
    const i = getSelected();
    $("comparison").hidden = false;
    $("compare-before").src = `/media/image/${i.key}?original=1`;
    $("compare-after").src = `/media/image/${i.key}?v=${i.version}`;
  };
  $("scan-similarity").onclick = async () => {
    try {
      const r = await api("/api/assistant/scan", {});
      $("similarity-results").innerHTML =
        `<p>${r.indexed} عينات · ${r.pairs.length} أزواج · لا حذف أو إعادة تقسيم تلقائية.</p>` +
        r.pairs
          .map(
            p =>
              `<article class="assistant-issue"><strong>${p.kind === "exact" ? "تطابق بايتات أو بكسلات" : "تشابه محتمل"} · ${Math.round(p.score * 100)}%</strong><p>${p.crossSplit ? "تسرب بين تقسيمات مجمدة — يمنع التصدير" : "راجع اللقطتين والجلسة"}</p><div class="comparison"><img src="/media/image/${p.a}" alt="العينة الأولى للمقارنة"><img src="/media/image/${p.b}" alt="العينة الثانية للمقارنة"></div><label>سبب القرار<input data-pair-reason="${p.id}" placeholder="ما الدليل على العلاقة؟"></label><button data-pair="${p.id}" data-relation="same" class="quiet">نفس اللقطة أو الجلسة</button><button data-pair="${p.id}" data-relation="different" class="quiet" ${p.kind === "exact" ? "disabled" : ""}>مشهد مستقل</button><p>القرار: ${esc(p.decision?.relation ?? "بانتظار مراجعة مستقلة")}</p></article>`
          )
          .join("");
      $("similarity-results")
        .querySelectorAll("[data-pair]")
        .forEach(
          b =>
            (b.onclick = async () => {
              try {
                await api("/api/assistant/review-pair", {
                  id: b.dataset.pair,
                  relation: b.dataset.relation,
                  reason: $("similarity-results").querySelector(
                    `[data-pair-reason="${b.dataset.pair}"]`
                  ).value,
                });
                notify(
                  "سُجل قرار التشابه. لا يُنقل test إلى train؛ تعارض التقسيم يبقى محجوبًا."
                );
              } catch (e) {
                notify(e.message);
              }
            })
        );
    } catch (e) {
      notify(e.message);
    }
  };
  $("batch-quality").onclick = async () => {
    if (busy) return;
    busy = true;
    try {
      let n = 0;
      for (const i of getCatalog().items) {
        await api("/api/assistant/analyze", { key: i.key });
        $("batch-progress").textContent =
          `فُحصت ${++n} من ${getCatalog().items.length} محليًا (جودة وقواعد وسوم فقط)`;
      }
      notify("اكتملت تقارير الجودة دون اعتماد أي صورة.");
    } catch (e) {
      notify(e.message);
    } finally {
      busy = false;
    }
  };
  $("batch-models").onclick = async () => {
    if (busy) return;
    busy = true;
    try {
      runner ??= await import("/local-models.mjs");
      let n = 0;
      for (const item of getCatalog().items) {
        await api("/api/assistant/analyze", { key: item.key });
        const out = await runner.analyzeLocalImage(
          `/media/image/${item.key}?v=${item.version}`,
          getCatalog().taxonomy,
          { withOCR: $("batch-ocr").checked }
        );
        await api("/api/assistant/model-results", {
          key: item.key,
          version: item.version,
          imageSha256: item.activeSha256 ?? item.sample.sha256,
          ...out,
        });
        $("batch-progress").textContent =
          `اقتراحات محلية ${++n} / ${getCatalog().items.length} — دون تعديل أو اعتماد`;
      }
      document.querySelector('[data-tab="assistant"]').click();
    } catch (e) {
      notify(e.message);
    } finally {
      busy = false;
    }
  };
  $("export-chatgpt").onclick = async () => {
    try {
      const r = await api("/api/assistant/packet", {});
      $("packet-preview").textContent = JSON.stringify(r.packet, null, 2);
      $("packet-panel").hidden = false;
    } catch (e) {
      notify(e.message);
    }
  };
  $("download-packet").onclick = () => {
    const a = document.createElement("a");
    const url = URL.createObjectURL(
      new Blob([$("packet-preview").textContent], { type: "application/json" })
    );
    a.href = url;
    a.download = "basira-chatgpt-review.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("synthetic-form").onsubmit = async e => {
    e.preventDefault();
    try {
      const f = $("synthetic-file").files[0];
      if (!f || f.size > 16_000_000) throw new Error("اختر صورة أقل من 16MB");
      const form = new FormData(e.target),
        bytes = new Uint8Array(await f.arrayBuffer());
      let data = "";
      for (let n = 0; n < bytes.length; n += 8192)
        data += String.fromCharCode(...bytes.subarray(n, n + 8192));
      await api("/api/assistant/synthetic", {
        image: btoa(data),
        generator: form.get("generator"),
        model: form.get("model"),
        prompt: form.get("prompt"),
        settings: JSON.parse(form.get("settings")),
        seed: form.get("seed"),
        generatedAt: form.get("generatedAt"),
        origin: form.get("origin"),
        license: form.get("license"),
        rightsText: form.get("rightsText"),
        independentCreation: form.get("independentCreation") === "on",
        noUserData: form.get("noUserData") === "on",
      });
      await refresh();
      notify(
        "استوردت صورة اصطناعية في فئة منفصلة، غير معتمدة وغير مؤهلة للتقييم الحقيقي أو المعايرة."
      );
      e.target.reset();
    } catch (e) {
      notify(e.message);
    }
  };
  return {
    useRegions: report => {
      const item = getSelected();
      if (
        !getActor()?.roles.includes("annotator") ||
        item?.key !== report.itemKey ||
        item.version !== report.itemVersion
      )
        throw new Error("Current preparer and image version required");
      latest = report;
      regions = (report.privacy?.regions ?? []).map(r =>
        structuredClone(r.box)
      );
      $("confirm-redaction").checked = false;
      renderRegions();
      $("redaction-regions").scrollIntoView({ block: "center" });
    },
    addRegion: box => {
      regions.push(box);
      renderRegions();
    },
    isRedactionMode: () => $("redaction-mode").checked,
    reset: () => {
      latest = null;
      regions = [];
      $("assistant-result").textContent = "لم يُحلل هذا الإصدار بعد.";
      $("redaction-mode").checked = false;
      $("confirm-redaction").checked = false;
      $("comparison").hidden = true;
      renderRegions();
    },
    open: async () => {
      try {
        const r = await api("/api/assistant/capabilities");
        $("assistant-capabilities").textContent =
          `نماذج المتصفح: الكشف ${r.objectDetector.status} · OCR ${r.ocr.status}. حالة كواشف الخصوصية الإضافية تظهر في تقرير المراجعة المسبقة لكل عينة. السحابة معطلة. إطارات الفيديو تُحلل كصور؛ الأصل والصوت يحتاجان مراجعة مستقلة.`;
        const reports = await api("/api/assistant/reports");
        $("issue-summary").innerHTML =
          reports.reports
            .filter(r =>
              getCatalog().items.some(
                i => i.key === r.itemKey && i.version === r.itemVersion
              )
            )
            .slice(0, 50)
            .map(
              r =>
                `<article class="assistant-issue"><button class="quiet" data-report="${r.id}">فتح العينة · ${r.issues.length} مشكلات</button><small>${esc(r.scope)} · ${esc(r.at)}</small>${r.issues.map(i => `<p><strong>${esc(names[i.type] ?? i.type)}</strong> · ${i.confidence === null ? "الثقة غير مقدرة" : Math.round(i.confidence * 100) + "% — درجة غير معايرة"}</p><p>${esc(i.action)}</p>`).join("")}</article>`
            )
            .join("") ||
          "لا تقارير بعد. افتح عينة لتحليلها أو افحص جودة المكتبة.";
        $("issue-summary")
          .querySelectorAll("[data-report]")
          .forEach(
            b =>
              (b.onclick = async () => {
                const r = reports.reports.find(r => r.id === b.dataset.report);
                await openEditor(r.itemKey);
                show(r);
              })
          );
      } catch (e) {
        notify(e.message);
      }
    },
  };
}
