import type { DocumentOptions } from '../types.js';

export interface DocumentCamera { deviceId: string; label: string; }

/** Usable, unique video inputs in browser order. Devices without an id (before permission) are ignored. */
export function videoInputs(devices: readonly Pick<MediaDeviceInfo, 'kind' | 'deviceId' | 'label'>[]): DocumentCamera[] {
  const seen = new Set<string>();
  const cameras: DocumentCamera[] = [];
  for (const { kind, deviceId, label } of devices) {
    if (kind !== 'videoinput' || !deviceId || deviceId === 'default' || seen.has(deviceId)) continue;
    seen.add(deviceId); cameras.push({ deviceId, label });
  }
  return cameras;
}

/** The camera after `current`, wrapping around; the first other camera when `current` is unknown. */
export function nextCamera(cameras: readonly DocumentCamera[], current?: string): string | undefined {
  if (cameras.length < 2) return undefined;
  const index = cameras.findIndex(camera => camera.deviceId === current);
  return cameras[(index + 1) % cameras.length]!.deviceId;
}

/** Rear-camera defaults, host constraints, then an explicitly chosen device, which replaces any facing mode. */
export function documentVideoConstraints(camera?: MediaTrackConstraints, deviceId?: string): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, ...camera };
  if (!deviceId) return constraints;
  delete constraints.facingMode;
  return { ...constraints, deviceId: { exact: deviceId } };
}

export function validateDocumentCameraOptions(options?: DocumentOptions): void {
  if (options?.cameraSwitch !== undefined && typeof options.cameraSwitch !== 'boolean') throw new Error('document.cameraSwitch must be true or false.');
  if (options?.torch !== undefined && typeof options.torch !== 'boolean') throw new Error('document.torch must be true or false.');
}
