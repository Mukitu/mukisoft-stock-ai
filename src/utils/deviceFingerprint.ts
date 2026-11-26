/**
 * Deterministic Browser & Hardware Device Fingerprint Generator.
 * Combines navigator.userAgent, screen dimensions, navigator.language,
 * timezone, hardwareConcurrency, and an HTML5 Canvas 2D signature into a SHA-256 hex digest.
 * Never relies on cookies or localStorage so clearing storage or opening Incognito
 * reproduces the exact same deviceHash on the same browser/device.
 */

let cachedDeviceHash: string | null = null;
let inflightPromise: Promise<string> | null = null;

function buildCanvasSignature(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no-2d-ctx';

    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#0f172a';
    ctx.font = '600 14px Inter, Arial, sans-serif';
    ctx.fillText('MukiSoft-DSE-CSE-Quant-v2', 8, 8);

    ctx.fillStyle = 'rgba(29, 78, 216, 0.72)';
    ctx.beginPath();
    ctx.arc(42, 40, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#059669';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(72, 46);
    ctx.lineTo(118, 32);
    ctx.lineTo(168, 42);
    ctx.lineTo(222, 24);
    ctx.stroke();

    return canvas.toDataURL('image/png');
  } catch {
    return 'canvas-unavailable';
  }
}

function collectRawFingerprintSignals(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const screenDims =
    typeof window !== 'undefined' && window.screen
      ? `${window.screen.width}x${window.screen.height}`
      : '0x0';
  const lang = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  let timeZone = 'UTC';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    timeZone = 'UTC';
  }
  const cores =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? String(navigator.hardwareConcurrency)
      : '0';
  const canvasSig = typeof document !== 'undefined' ? buildCanvasSignature() : 'ssr';

  return [ua, screenDims, lang, timeZone, cores, canvasSig].join('||');
}

/**
 * Pure-JS fallback SHA-256 (used only if Web Crypto subtle.digest is unavailable).
 */
function sha256Fallback(ascii: string): string {
  const rightRotate = (value: number, amount: number) =>
    (value >>> amount) | (value << (32 - amount));

  const maxWord = Math.pow(2, 32);
  let result = '';
  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;

  const hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;

  const isComposite: Record<number, number> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  let msg = ascii + '\x80';
  while ((msg.length % 64) - 56) msg += '\x00';
  for (let i = 0; i < msg.length; i++) {
    const j = msg.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;

  for (let j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);

    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];

      const a = hash[0];
      const e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);

      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

      hash.unshift((temp1 + temp2) | 0);
      hash[4] = (hash[4] + temp1) | 0;
      hash.pop();
    }

    for (let i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

async function digestSha256Hex(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    const data = new TextEncoder().encode(input);
    const buffer = await crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return sha256Fallback(unescape(encodeURIComponent(input)));
}

export async function getDeviceFingerprintHash(): Promise<string> {
  if (cachedDeviceHash) {
    return cachedDeviceHash;
  }
  if (!inflightPromise) {
    inflightPromise = digestSha256Hex(collectRawFingerprintSignals())
      .then((hash) => {
        cachedDeviceHash = hash;
        return hash;
      })
      .finally(() => {
        inflightPromise = null;
      });
  }
  return inflightPromise;
}
