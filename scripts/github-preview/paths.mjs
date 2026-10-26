/** Preview build only: prefix absolute model/API literals, including worker modules. Production sources are unchanged. */
import ts from "typescript";
import { resolve } from "node:path";
export function validBase(base) {
  if (!/^\/[a-zA-Z0-9-]+\/$/.test(base))
    throw Error("Explicit single-project preview base required");
  return base;
}
export function prefixModelPaths(code, base) {
  validBase(base);
  const tree = ts.createSourceFile(
      "preview.tsx",
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    ),
    edits = [];
  const visit = node => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        node.kind === ts.SyntaxKind.TemplateHead) &&
      /^\/(vision|api)(?:\/|$)/.test(node.text)
    ) {
      const value = base + node.text.slice(1),
        replacement =
          node.kind === ts.SyntaxKind.TemplateHead
            ? "`" + value + "${"
            : JSON.stringify(value);
      edits.push({ start: node.getStart(tree), end: node.end, replacement });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  for (const e of edits.sort((a, b) => b.start - a.start))
    code = code.slice(0, e.start) + e.replacement + code.slice(e.end);
  return code;
}
export function previewPathPlugin(base) {
  return {
    name: "basira-preview-project-paths",
    enforce: "pre",
    transform(code, id) {
      if (!/[\\/]client[\\/]src[\\/].*\.[cm]?[jt]sx?(?:\?|$)/.test(id))
        return null;
      if (id.replaceAll("\\", "/").split("?")[0].endsWith("/objectWorker.ts"))
        code =
          "import " +
          JSON.stringify(
            resolve(import.meta.dirname, "install-ranged.ts").replaceAll(
              "\\",
              "/"
            )
          ) +
          ";\n" +
          code;
      if (id.replaceAll("\\", "/").split("?")[0].endsWith("/BrandLogo.tsx"))
        code = code.replace(
          /"https:\/\/files\.manuscdn\.com\/[^"\n]+"/,
          JSON.stringify(base + "basira-icon.svg")
        );
      return {
        code: prefixModelPaths(previewModelLoading(code, id), base),
        map: null,
      };
    },
  };
}
/** Slow public downloads need a separate initialization budget; frame/inference TTLs are unchanged. */
export function previewModelLoading(code, id) {
  const file = id.replaceAll("\\", "/").split("?")[0];
  if (file.endsWith("/workerObjectProvider.ts")) {
    const pattern =
      /withMasks\s*\?\s*45_000\s*:\s*profile\s*\?\s*30_000\s*:\s*15_000/g;
    if ([...code.matchAll(pattern)].length !== 1)
      throw Error(
        "Review changed worker initialization contract before preview build"
      );
    code = code.replace(pattern, "180_000");
  }
  if (file.endsWith("/objectQuality.ts")) {
    const tree = ts.createSourceFile(
        "quality.ts",
        code,
        ts.ScriptTarget.Latest,
        true
      ),
      edits = [];
    const visit = node => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(tree) === "fetch" &&
        node.arguments[0]
          ?.getText(tree)
          .includes("/assets/yolox/yolox_tiny.onnx")
      ) {
        const options = node.arguments[1];
        if (options && ts.isObjectLiteralExpression(options))
          for (const p of options.properties)
            if (
              ts.isPropertyAssignment(p) &&
              p.name.getText(tree) === "cache" &&
              ts.isStringLiteral(p.initializer) &&
              p.initializer.text === "no-store"
            )
              edits.push({
                start: p.initializer.getStart(tree),
                end: p.initializer.end,
              });
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    if (edits.length !== 1)
      throw Error(
        "Review changed pinned model cache contract before preview build"
      );
    for (const e of edits.sort((a, b) => b.start - a.start))
      code = code.slice(0, e.start) + '"force-cache"' + code.slice(e.end);
  }
  return code;
}
