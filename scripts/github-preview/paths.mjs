/** Preview build only: prefix absolute model/API literals, including worker modules. Production sources are unchanged. */
import ts from "typescript";
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
      return { code: prefixModelPaths(code, base), map: null };
    },
  };
}
