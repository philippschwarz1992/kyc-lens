'use client';

export { KycFlow } from './react/KycFlow.js';
export { createHttpApi, KycHttpError } from './api.js';
export { DEFAULT_CHALLENGES } from './core/challenges.js';
export { compareFaces, prefetchMatchingAssets } from './matching/client.js';
export { builtInThemes, defineTheme, getTheme, listThemes, registerTheme, resolveTheme, themeCss, themeVariables, unregisterTheme } from './themes.js';
export { builtInIconPacks, defineIconPack, getIconPack, iconNames, listIconPacks, registerIconPack, resolveIconPack, unregisterIconPack } from './icons.js';
export type { KycBuiltInIconPackId, KycIconGlyph, KycIconName, KycIconPack, KycIconPath, KycResolvedIconPack } from './icons.js';
export type { KycLocale, KycStringKey, KycStrings } from './react/strings.js';
export type { KycBuiltInThemeId, KycThemeDefinition, KycThemeInput, KycThemeTokenOverrides, KycThemeTokens } from './themes.js';
export type { CompareFacesOptions, FaceMatchReason } from './matching/protocol.js';
export type { AssetOptions, HandoffOptions, CapturePayload, CaptureResult, ChallengeEvidence, ChallengeFeedback, DocumentCapture, DocumentOptions, DocumentType, FaceChallenge, FaceMatchOptions, FaceMatchResult, FaceObservation, FaceOptions, HttpApiOptions, KycApi, KycErrorStage, KycEvent, KycFlowProps, KycPhase, KycScreenContext, KycSession, KycStep, KycTheme, OutputOptions, RetryOptions, UploadOptions } from './types.js';
