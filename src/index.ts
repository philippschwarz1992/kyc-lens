'use client';

export { KycFlow } from './react/KycFlow.js';
export { createHttpApi, KycHttpError } from './api.js';
export { DEFAULT_CHALLENGES } from './core/challenges.js';
export { compareFaces } from './matching/client.js';
export type { CompareFacesOptions, FaceMatchReason } from './matching/protocol.js';
export type { AssetOptions, CapturePayload, CaptureResult, ChallengeEvidence, ChallengeFeedback, DocumentCapture, DocumentOptions, DocumentType, FaceChallenge, FaceMatchOptions, FaceMatchResult, FaceObservation, FaceOptions, KycApi, KycFlowProps, KycScreenContext, KycSession, KycStep, KycTheme } from './types.js';
