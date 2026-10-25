import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineKycLensElement, KYC_LENS_ATTRIBUTES, mergeKycLensConfig, parseKycLensAttributes, type KycLensAttribute } from '../src/element';

const attributes = (values: Partial<Record<KycLensAttribute, string>>) => (name: KycLensAttribute) => values[name] ?? null;

describe('parseKycLensAttributes', () => {
  it('omits absent attributes', () => {
    expect(parseKycLensAttributes(attributes({}))).toEqual({});
  });

  it('reads every observed attribute', () => {
    expect(parseKycLensAttributes(attributes({
      steps: ' intro, face ,review,,result ', locale: 'de', theme: 'aurora',
      'assets-base-url': '/static/kyc-assets', 'api-base-url': '/api/kyc', simulation: '',
    }))).toEqual({
      steps: ['intro', 'face', 'review', 'result'], locale: 'de', theme: 'aurora',
      assets: { baseUrl: '/static/kyc-assets' }, apiBaseUrl: '/api/kyc', simulation: true,
    });
  });

  it('treats simulation as an HTML boolean attribute and ignores blank values', () => {
    expect(parseKycLensAttributes(attributes({ simulation: 'false' })).simulation).toBe(true);
    expect(parseKycLensAttributes(attributes({ locale: ' ', theme: '', 'assets-base-url': ' ' }))).toEqual({});
  });

  it('observes exactly the documented attributes', () => {
    expect(KYC_LENS_ATTRIBUTES).toEqual(['steps', 'locale', 'theme', 'assets-base-url', 'api-base-url', 'simulation']);
  });
});

describe('mergeKycLensConfig', () => {
  it('lets the config property win and merges asset options', () => {
    expect(mergeKycLensConfig(
      { locale: 'de', theme: 'ledger', assets: { baseUrl: '/a' }, simulation: true },
      { theme: 'pebble', assets: { workerUrl: '/w.js' }, face: { challenges: ['center'] } },
    )).toEqual({ locale: 'de', theme: 'pebble', assets: { baseUrl: '/a', workerUrl: '/w.js' }, simulation: true, face: { challenges: ['center'] } });
  });

  it('drops callbacks and custom screens passed from untyped JavaScript', () => {
    const merged = mergeKycLensConfig({}, { locale: 'en', onComplete() {}, onCancel() {}, onError() {}, components: {} } as never);
    expect(merged).toEqual({ locale: 'en' });
  });
});

describe('defineKycLensElement', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function fakeRegistry() {
    const defined = new Map<string, CustomElementConstructor>();
    return {
      defined,
      get: (name: string) => defined.get(name),
      define: vi.fn((name: string, constructor: CustomElementConstructor) => {
        if (defined.has(name)) throw new Error(`${name} already defined`);
        defined.set(name, constructor);
      }),
    } as unknown as CustomElementRegistry & { defined: Map<string, CustomElementConstructor>; define: ReturnType<typeof vi.fn> };
  }

  it('is a no-op without Custom Elements, as during server rendering', () => {
    expect(typeof HTMLElement).toBe('undefined');
    expect(defineKycLensElement('kyc-lens')).toBeUndefined();
    expect(defineKycLensElement('kyc-lens', fakeRegistry())).toBeUndefined();
  });

  it('defines once and returns the existing constructor on repeated calls', () => {
    vi.stubGlobal('HTMLElement', class {});
    const registry = fakeRegistry();
    const first = defineKycLensElement('kyc-lens', registry);
    expect(first).toBeTypeOf('function');
    expect(defineKycLensElement('kyc-lens', registry)).toBe(first);
    expect(registry.define).toHaveBeenCalledTimes(1);
    expect((first as unknown as { observedAttributes: readonly string[] }).observedAttributes).toEqual(KYC_LENS_ATTRIBUTES);
  });

  it('registers distinct classes under different names', () => {
    vi.stubGlobal('HTMLElement', class {});
    const registry = fakeRegistry();
    const first = defineKycLensElement('kyc-lens', registry);
    const second = defineKycLensElement('identity-capture', registry);
    expect(second).not.toBe(first);
    expect([...registry.defined.keys()]).toEqual(['kyc-lens', 'identity-capture']);
  });
});
