// A host page without React code: register the element, then listen for DOM events.
import { defineKycLensElement, type KycLensElement } from '@sdk/element';
import '@sdk/styles.css';

declare global {
  interface HTMLElementTagNameMap { 'kyc-lens': KycLensElement }
  interface Window { kycLensEvents: { type: string; detail: unknown }[] }
}

window.kycLensEvents = [];
for (const type of ['kyc-complete', 'kyc-cancel', 'kyc-error']) {
  document.addEventListener(type, event => {
    const { detail } = event as CustomEvent;
    window.kycLensEvents.push({ type, detail: detail instanceof Error ? detail.message : detail });
  });
}
defineKycLensElement('kyc-lens');
