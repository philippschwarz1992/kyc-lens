import { describe, expect, it } from 'vitest';
import { prefersHandoff, validateHandoffOptions } from '../src/react/Handoff.js';

describe('phone handoff options', () => {
  it('accepts absolute http(s) URLs and the show modes', () => {
    expect(() => validateHandoffOptions(undefined)).not.toThrow();
    expect(() => validateHandoffOptions({ url: 'https://example.com/kyc?handoff=abc' })).not.toThrow();
    expect(() => validateHandoffOptions({ url: 'http://localhost:5173/', show: 'always' })).not.toThrow();
  });
  it('rejects URLs a phone cannot open and unknown modes', () => {
    for (const url of ['/relative', 'javascript:alert(1)', 'data:text/html,x', `https://example.com/${'a'.repeat(2048)}`]) expect(() => validateHandoffOptions({ url })).toThrow(/handoff\.url/);
    expect(() => validateHandoffOptions({ url: 'https://example.com', show: 'never' as 'always' })).toThrow(/handoff\.show/);
    expect(() => validateHandoffOptions([] as unknown as { url: string })).toThrow(/options object/);
  });
  it('shows on every device only when asked, and never without a window', () => {
    expect(prefersHandoff('always')).toBe(true);
    expect(prefersHandoff('desktop')).toBe(false);
  });
});
