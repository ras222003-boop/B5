/** Opens the existing exam HTML through the system's print flow.
 * Embedded iPhone WebKit cannot rely on window.open + window.print. The
 * native print bridge is installed only by our approved iOS host and performs
 * its own main-frame, origin, and route validation.
 */
export type ExamPrintWindow = {
  __basiraNativeIOS?: boolean;
  BasiraNativePrint?: { printHTML: (html: string) => void };
  open: (url: string, target: string) => Pick<Window, "document" | "print"> | null;
};

export function requestExamPrint(
  html: string,
  target: ExamPrintWindow,
  schedule: (callback: () => void) => void = callback => { setTimeout(callback, 500); },
): boolean {
  if (!html || html.trim().length < 10 || html.length > 1_000_000) return false;
  if (target.__basiraNativeIOS) {
    // Never silently fall back to an unusable popup inside WKWebView.
    if (!target.BasiraNativePrint?.printHTML) return false;
    try {
      target.BasiraNativePrint.printHTML(html);
      return true; // request submitted, not proof of printed PDF
    } catch {
      return false;
    }
  }

  let popup: Pick<Window, "document" | "print"> | null = null;
  try { popup = target.open("", "_blank"); } catch { return false; }
  if (!popup) return false;
  try {
    popup.document.write(html);
    popup.document.close();
    schedule(() => { try { popup?.print(); } catch { /* no print capability */ } });
    return true;
  } catch {
    return false;
  }
}
