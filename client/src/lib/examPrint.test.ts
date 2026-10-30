import { describe, expect, it, vi } from "vitest";
import { requestExamPrint, type ExamPrintWindow } from "./examPrint";

const html = "<html><body><h1>Basira exam</h1></body></html>";

describe("exam printing from mobile Basira", () => {
  it("uses the native print bridge in iPhone WKWebView without a popup", () => {
    const printHTML = vi.fn();
    const open = vi.fn();
    const request: ExamPrintWindow = {
      __basiraNativeIOS: true, BasiraNativePrint: { printHTML },
      open,
    };
    expect(requestExamPrint(html, request)).toBe(true);
    expect(printHTML).toHaveBeenCalledWith(html);
    expect(open).not.toHaveBeenCalled();
  });

  it("does not pretend that an unconfigured native bridge saved a PDF", () => {
    const open = vi.fn();
    expect(requestExamPrint(html, { __basiraNativeIOS: true, open })).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("preserves the web browser's print flow on non-native platforms", () => {
    const write = vi.fn(), close = vi.fn(), print = vi.fn();
    const popup = { document: { write, close }, print };
    const open = vi.fn().mockReturnValue(popup);
    const schedule = vi.fn((callback: () => void) => callback());
    expect(requestExamPrint(html, { open } as unknown as ExamPrintWindow, schedule)).toBe(true);
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(write).toHaveBeenCalledWith(html);
    expect(close).toHaveBeenCalledOnce();
    expect(print).toHaveBeenCalledOnce();
  });

  it("fails closed on empty print data, blocked windows and native bridge errors", () => {
    const open = vi.fn().mockReturnValue(null);
    expect(requestExamPrint("", { open })).toBe(false);
    expect(requestExamPrint(html, { open })).toBe(false);
    expect(requestExamPrint(html, {
      __basiraNativeIOS: true,
      open,
      BasiraNativePrint: { printHTML: () => { throw Error("bridge unavailable"); } },
    })).toBe(false);
  });
});
