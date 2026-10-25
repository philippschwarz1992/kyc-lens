import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { KycFlow } from './react/KycFlow.js';
import type { CaptureResult, KycFlowProps, KycStep } from './types.js';

/** `KycFlow` settings accepted by the custom element. Callbacks become DOM events; custom React screens are not supported. */
export type KycLensElementConfig = Omit<KycFlowProps, 'onComplete' | 'onCancel' | 'onError' | 'components'>;

/** Attributes the element observes. Any change re-renders the flow. */
export const KYC_LENS_ATTRIBUTES = ['steps', 'locale', 'theme', 'assets-base-url', 'api-base-url', 'simulation'] as const;
export type KycLensAttribute = typeof KYC_LENS_ATTRIBUTES[number];

/** Events dispatched by the element. All bubble and cross shadow roots (`composed`). */
export interface KycLensElementEventMap extends HTMLElementEventMap {
  'kyc-complete': CustomEvent<CaptureResult>;
  'kyc-cancel': CustomEvent<undefined>;
  'kyc-error': CustomEvent<Error>;
}

/** The registered element's instance type. Use it to augment `HTMLElementTagNameMap` in your application. */
export interface KycLensElement extends HTMLElement {
  /** Rich settings. Fields set here take precedence over the matching attributes. */
  config: KycLensElementConfig | undefined;
  addEventListener<K extends keyof KycLensElementEventMap>(type: K, listener: (this: KycLensElement, event: KycLensElementEventMap[K]) => unknown, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof KycLensElementEventMap>(type: K, listener: (this: KycLensElement, event: KycLensElementEventMap[K]) => unknown, options?: boolean | EventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}

/** Reads the element's attributes into `KycFlow` settings. Absent attributes are omitted. */
export function parseKycLensAttributes(getAttribute: (name: KycLensAttribute) => string | null): KycLensElementConfig {
  const config: KycLensElementConfig = {};
  const steps = getAttribute('steps');
  if (steps !== null) config.steps = steps.split(',').map(step => step.trim()).filter(Boolean) as KycStep[];
  const locale = getAttribute('locale');
  if (locale !== null && locale.trim()) config.locale = locale.trim() as KycLensElementConfig['locale'];
  const theme = getAttribute('theme');
  if (theme !== null && theme.trim()) config.theme = theme.trim();
  const assetsBaseUrl = getAttribute('assets-base-url');
  if (assetsBaseUrl !== null && assetsBaseUrl.trim()) config.assets = { baseUrl: assetsBaseUrl.trim() };
  const apiBaseUrl = getAttribute('api-base-url');
  if (apiBaseUrl !== null) config.apiBaseUrl = apiBaseUrl.trim();
  // HTML boolean attribute: presence enables it, whatever its value.
  if (getAttribute('simulation') !== null) config.simulation = true;
  return config;
}

/** Combines attribute settings with the `config` property; the property wins, and asset options are merged field by field. */
export function mergeKycLensConfig(attributes: KycLensElementConfig, config: KycLensElementConfig | undefined): KycLensElementConfig {
  const merged: KycLensElementConfig & Partial<Pick<KycFlowProps, 'onComplete' | 'onCancel' | 'onError' | 'components'>> = { ...attributes, ...config };
  if (attributes.assets || config?.assets) merged.assets = { ...attributes.assets, ...config?.assets };
  // Plain JavaScript hosts may pass these anyway; the element owns callbacks and renders built-in screens.
  delete merged.onComplete; delete merged.onCancel; delete merged.onError; delete merged.components;
  return merged;
}

/**
 * Registers `<tag-name>` as a KYC Lens custom element and returns its constructor.
 * Calling it again for a registered name returns the existing constructor instead of throwing.
 * Returns `undefined` where Custom Elements are unavailable, such as during server rendering.
 */
export function defineKycLensElement(tagName = 'kyc-lens', registry: CustomElementRegistry | undefined = globalThis.customElements): CustomElementConstructor | undefined {
  if (!registry || typeof HTMLElement === 'undefined') return undefined;
  const existing = registry.get(tagName);
  if (existing) return existing;

  // Declared lazily so importing this module never touches HTMLElement on the server.
  class KycLensCustomElement extends HTMLElement {
    static get observedAttributes(): readonly string[] { return KYC_LENS_ATTRIBUTES; }
    #config: KycLensElementConfig | undefined;
    #root: Root | null = null;
    #scheduled = false;

    constructor() {
      super();
      // A host may assign `config` before the element is defined; re-run it through the setter.
      if (Object.prototype.hasOwnProperty.call(this, 'config')) {
        const value = (this as { config?: KycLensElementConfig }).config;
        delete (this as { config?: KycLensElementConfig }).config;
        this.config = value;
      }
    }

    get config(): KycLensElementConfig | undefined { return this.#config; }
    set config(value: KycLensElementConfig | undefined) { this.#config = value ?? undefined; this.#schedule(); }

    connectedCallback(): void {
      this.#root ??= createRoot(this);
      this.#render();
    }

    disconnectedCallback(): void {
      // Unmounting runs the flow's effect cleanups, which stop camera tracks and terminate workers.
      const root = this.#root;
      this.#root = null;
      root?.unmount();
    }

    attributeChangedCallback(): void { this.#schedule(); }

    #schedule(): void {
      if (this.#scheduled || !this.#root) return;
      this.#scheduled = true;
      // Coalesce several attribute or property changes made in one task into one render.
      queueMicrotask(() => { this.#scheduled = false; this.#render(); });
    }

    #emit(type: 'kyc-complete' | 'kyc-cancel' | 'kyc-error', detail?: unknown): void {
      this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    }

    #render(): void {
      if (!this.#root) return;
      const props: KycFlowProps = {
        ...mergeKycLensConfig(parseKycLensAttributes(name => this.getAttribute(name)), this.#config),
        onComplete: result => this.#emit('kyc-complete', result),
        onCancel: () => this.#emit('kyc-cancel'),
        onError: error => this.#emit('kyc-error', error),
      };
      this.#root.render(createElement(KycFlow, props));
    }
  }

  // Each call declares a fresh class, so one registry can hold the element under several names.
  registry.define(tagName, KycLensCustomElement);
  return KycLensCustomElement;
}
