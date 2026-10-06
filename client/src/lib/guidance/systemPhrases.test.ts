import { describe, expect, it } from 'vitest';
import { guidancePhrases } from './systemPhrases';

describe('Basira-generated guidance phrases', () => {
  it('keeps MSA and Saudi messages distinct and safety clear', () => {
    expect(guidancePhrases('ar', 'MSA').offRoute).toContain('سأعيد حساب الطريق');
    expect(guidancePhrases('ar', 'SAUDI').offRoute).toContain('بحسب لك طريق جديد');
    expect(guidancePhrases('ar', 'SAUDI').lost).toContain('وقف');
    expect(guidancePhrases('ar', 'SAUDI').whereKnown('الدور الأول', 'غرفة 121')).toContain('غرفة 121');
  });
  it('has English and Chinese system messages', () => {
    expect(guidancePhrases('en', 'MSA').visionUnavailable).toContain('Vision');
    expect(guidancePhrases('zh-CN', 'MSA').visionUnavailable).toContain('视觉');
  });
});
