import type { FaceObservation } from '../types.js';

/** An explicitly synthetic camera source for the opt-in demo only. */
export function createSimulatedCamera() {
  const canvas = document.createElement('canvas');
  canvas.width = 720; canvas.height = 900;
  const context = canvas.getContext('2d');
  if (!context || typeof canvas.captureStream !== 'function') throw new Error('videoUnsupported');
  const render = (pose: Pick<FaceObservation, 'relativeSize' | 'yaw' | 'pitch'>) => {
    const gradient = context.createLinearGradient(0, 0, 720, 900);
    gradient.addColorStop(0, '#d7eaf4'); gradient.addColorStop(1, '#e8def4');
    context.fillStyle = gradient; context.fillRect(0, 0, 720, 900);
    const height = pose.relativeSize * canvas.height;
    const width = height * .74;
    context.fillStyle = '#6991b3'; context.beginPath(); context.ellipse(360, 900, width * 1.5, height * .9, 0, 0, Math.PI * 2); context.fill();
    context.save(); context.translate(360, 450); context.scale(width / 280, height / 390);
    context.fillStyle = '#e4b793'; context.beginPath(); context.ellipse(0, 0, 140, 195, 0, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#253c59'; context.beginPath(); context.ellipse(0, -125, 140, 75, 0, Math.PI, Math.PI * 2); context.fill();
    const offset = -pose.yaw * 1.1;
    for (const x of [-48, 48]) { context.beginPath(); context.arc(x + offset, -12 + pose.pitch * .8, 10, 0, Math.PI * 2); context.fill(); }
    context.strokeStyle = '#976854'; context.lineWidth = 6; context.beginPath(); context.arc(offset, 64 + pose.pitch * .8, 42, .15, Math.PI - .15); context.stroke();
    context.restore();
    context.fillStyle = '#112741'; context.font = 'bold 24px sans-serif'; context.textAlign = 'center';
    context.fillText('SIMULATION · DEMO ONLY', 360, 86);
    context.fillText('SIMULATION · DEMO ONLY', 360, 820);
  };
  render({ relativeSize: .4, yaw: 0, pitch: 0 });
  const stream = canvas.captureStream(12);
  return {
    stream, render,
    snapshot(): Promise<Blob> {
      return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not capture the simulation image.')), 'image/jpeg', .92));
    },
    stop() { stream.getTracks().forEach(track => track.stop()); },
  };
}
