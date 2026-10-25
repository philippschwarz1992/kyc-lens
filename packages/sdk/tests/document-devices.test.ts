import { describe, expect, it } from 'vitest';
import { documentVideoConstraints, nextCamera, validateDocumentCameraOptions, videoInputs } from '../src/camera/document-devices.js';

const device = (kind: MediaDeviceKind, deviceId: string, label = '') => ({ kind, deviceId, label });

describe('document camera devices', () => {
  it('keeps unique, identified video inputs in browser order', () => {
    expect(videoInputs([device('audioinput', 'mic'), device('videoinput', 'back', 'Back camera'), device('videoinput', ''),
      device('videoinput', 'front', 'Front camera'), device('videoinput', 'back', 'Back camera'), device('audiooutput', 'speaker')]))
      .toEqual([{ deviceId: 'back', label: 'Back camera' }, { deviceId: 'front', label: 'Front camera' }]);
  });

  it('cycles through cameras and wraps around', () => {
    const cameras = videoInputs([device('videoinput', 'a'), device('videoinput', 'b'), device('videoinput', 'c')]);
    expect(nextCamera(cameras, 'a')).toBe('b');
    expect(nextCamera(cameras, 'b')).toBe('c');
    expect(nextCamera(cameras, 'c')).toBe('a');
  });

  it('starts from the first camera when the active device is unknown and offers nothing for a single camera', () => {
    const cameras = videoInputs([device('videoinput', 'a'), device('videoinput', 'b')]);
    expect(nextCamera(cameras, undefined)).toBe('a');
    expect(nextCamera(cameras, 'unplugged')).toBe('a');
    expect(nextCamera(videoInputs([device('videoinput', 'a')]), 'a')).toBeUndefined();
    expect(nextCamera([], undefined)).toBeUndefined();
  });

  it('merges host constraints over the rear-camera defaults', () => {
    expect(documentVideoConstraints()).toEqual({ facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } });
    expect(documentVideoConstraints({ width: { ideal: 1280 }, frameRate: 30 })).toEqual({ facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1080 }, frameRate: 30 });
  });

  it('lets a chosen device replace facing mode and any host device id', () => {
    const host: MediaTrackConstraints = { facingMode: 'user', deviceId: 'host', height: { ideal: 720 } };
    expect(documentVideoConstraints(host, 'chosen')).toEqual({ width: { ideal: 1920 }, height: { ideal: 720 }, deviceId: { exact: 'chosen' } });
    expect(host).toEqual({ facingMode: 'user', deviceId: 'host', height: { ideal: 720 } });
  });

  it('validates the camera switch and torch options', () => {
    expect(() => validateDocumentCameraOptions(undefined)).not.toThrow();
    expect(() => validateDocumentCameraOptions({ cameraSwitch: false, torch: true })).not.toThrow();
    expect(() => validateDocumentCameraOptions({ cameraSwitch: 'yes' as unknown as boolean })).toThrow('document.cameraSwitch must be true or false.');
    expect(() => validateDocumentCameraOptions({ torch: 1 as unknown as boolean })).toThrow('document.torch must be true or false.');
  });
});
