import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { readDocumentZone } from '../src/mrz/index.js';
import { checkDigit, decodeMrz, MRZ_ALPHABET, summarizeMrz, type MrzFormat } from '../src/mrz/parse.js';

// Fictional ICAO 9303 specimens (Utopia, Anna Maria Eriksson).
const td3 = ['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C36UTO7408122F1204159ZE184226B<<<<<10'];
const td1 = ['I<UTOD231458907<<<<<<<<<<<<<<<', '7408122F1204159UTO<<<<<<<<<<<6', 'ERIKSSON<<ANNA<MARIA<<<<<<<<<<'];
const td2 = ['I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<', 'D231458907UTO7408122F1204159<<<<<<<6'];

/** Classifier-like probabilities: mostly confident, with chosen positions confused. */
function scores(lines: string[], confuse: Record<string, string> = {}): number[][][] {
  return lines.map((line, l) => [...line].map((char, p) => {
    const vector = new Array(MRZ_ALPHABET.length).fill(0.001);
    const wrong = confuse[`${l}:${p}`];
    if (wrong) { vector[MRZ_ALPHABET.indexOf(wrong)] = 0.6; vector[MRZ_ALPHABET.indexOf(char)] = 0.35; }
    else vector[MRZ_ALPHABET.indexOf(char)] = 0.95;
    return vector;
  }));
}

describe('MRZ check digits and formats', () => {
  it('computes ICAO 9303 check digits', () => {
    expect(checkDigit('L898902C3')).toBe(6);
    expect(checkDigit('740812')).toBe(2);
    expect(checkDigit('120415')).toBe(9);
    expect(checkDigit('D23145890')).toBe(7);
  });

  it('recognizes passports, identity cards and TD2 cards from valid specimens', () => {
    expect(summarizeMrz(td3)).toEqual({ format: 'TD3', kind: 'passport', valid: true });
    expect(summarizeMrz(td1)).toEqual({ format: 'TD1', kind: 'id-card', valid: true });
    expect(summarizeMrz(td2)).toEqual({ format: 'TD2', kind: 'id-card', valid: true });
  });

  it('marks a misread digit or an impossible date invalid', () => {
    expect(summarizeMrz([td3[0]!, td3[1]!.replace('7408122', '7408132')])!.valid).toBe(false);
    expect(summarizeMrz([td1[0]!, '7413122F1204159UTO<<<<<<<<<<<6', td1[2]!])!.valid).toBe(false);
    expect(summarizeMrz(['P<UTO', 'L898'])).toBeNull();
  });

  it('accepts a TD1 document number that continues into the optional field', () => {
    const number = 'D23145890AB';
    const line1 = `I<UTO${number.slice(0, 9)}<${number.slice(9)}${checkDigit(number)}`.padEnd(30, '<');
    const line2 = '7408122F1204159UTO<<<<<<<<<<<';
    const composite = checkDigit(line1.slice(5) + line2.slice(0, 7) + line2.slice(8, 15) + line2.slice(18, 29));
    expect(summarizeMrz([line1, line2 + composite, td1[2]!])!.valid).toBe(true);
  });
});

describe('MRZ decoding', () => {
  it('restricts each field to its character class, fixing O/0 and I/1 confusion', () => {
    // Dates are numeric and the name is alphabetic, so a classifier preferring O for 0 or 1 for I is overruled.
    const decoded = decodeMrz('TD3', scores(td3, { '1:14': 'O', '0:23': '1', '1:20': 'E' }))!;
    expect(decoded.lines).toEqual(td3);
    expect(decoded.summary.valid).toBe(true);
  });

  it('repairs an alphanumeric misread with the check digit', () => {
    // In the document number both 8 and B are allowed; only the check digit tells them apart.
    const decoded = decodeMrz('TD1', scores(td1, { '0:7': '8' }))!;
    expect(decoded.lines).toEqual(td1);
    expect(decoded.summary.valid).toBe(true);
  });

  it('reports an unrepairable read as invalid instead of guessing', () => {
    const lines = td1.map(line => line);
    const probabilities = scores(lines);
    // Two confident wrong digits in the birth date cannot be repaired from second choices.
    for (const p of [2, 3]) { probabilities[1]![p] = new Array(37).fill(0.001); probabilities[1]![p]![MRZ_ALPHABET.indexOf('9')] = 0.99; }
    expect(decodeMrz('TD1', probabilities)!.summary.valid).toBe(false);
  });

  it('rejects probabilities that do not match the layout', () => {
    expect(decodeMrz('TD3' as MrzFormat, scores(td1))).toBeNull();
  });
});

describe('MRZ reading from a photo', () => {
  // Photographed (rotated, blurred, compressed) renderings of the ICAO specimens, produced by scripts/train-mrz.mjs.
  const photo = (name: string) => {
    const fixture = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as { width: number; height: number; corners: Array<{ x: number; y: number }>; lines: string[]; gray: string };
    const gray = gunzipSync(Buffer.from(fixture.gray, 'base64'));
    const rgba = new Uint8ClampedArray(gray.length * 4);
    for (let i = 0; i < gray.length; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = gray[i]!; rgba[i * 4 + 3] = 255; }
    return { ...fixture, rgba };
  };
  const turned = (shot: ReturnType<typeof photo>) => {
    const rgba = new Uint8ClampedArray(shot.rgba.length);
    for (let i = 0; i < shot.rgba.length; i += 4) rgba.set(shot.rgba.subarray(i, i + 4), shot.rgba.length - 4 - i);
    const corners = shot.corners.map(point => ({ x: shot.width - 1 - point.x, y: shot.height - 1 - point.y }));
    return { ...shot, rgba, corners: [corners[2]!, corners[3]!, corners[0]!, corners[1]!] };
  };

  for (const name of ['mrz-td3', 'mrz-td1']) {
    it(`reads the ${name.slice(4).toUpperCase()} specimen exactly, also upside down`, () => {
      const shot = photo(name);
      for (const view of [shot, turned(shot)]) {
        const read = readDocumentZone(view.rgba, view.width, view.height, view.corners);
        expect(read?.lines).toEqual(shot.lines);
        expect(read?.summary.valid).toBe(true);
      }
    });
  }

  it('finds no zone on a blank page', () => {
    const blank = new Uint8ClampedArray(600 * 400 * 4).fill(230);
    expect(readDocumentZone(blank, 600, 400, [{ x: 20, y: 20 }, { x: 580, y: 20 }, { x: 580, y: 380 }, { x: 20, y: 380 }])).toBeNull();
  });
});
