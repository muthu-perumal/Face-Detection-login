import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto';

const VERSION = 'v1';

function keyFromSecret(secret: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(secret)) return Buffer.from(secret, 'hex');
  return scryptSync(secret, 'attendance-biometric-v1', 32);
}

function keyId(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

function secrets(): string[] {
  return [process.env.BIOMETRIC_ENCRYPTION_KEY, process.env.BIOMETRIC_ENCRYPTION_KEY_PREVIOUS].filter(
    (value): value is string => Boolean(value),
  );
}

export function encryptTemplate(values: number[]): string {
  const secret = process.env.BIOMETRIC_ENCRYPTION_KEY;
  if (!secret) throw new Error('BIOMETRIC_ENCRYPTION_KEY is not set');
  const key = keyFromSecret(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(values), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, keyId(key), iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptTemplate(payload: string): number[] {
  const [version, id, iv, tag, data] = payload.split('.');
  if (version !== VERSION || !id || !iv || !tag || !data) {
    throw new Error('Unsupported biometric template');
  }
  for (const secret of secrets()) {
    const key = keyFromSecret(secret);
    if (keyId(key) !== id) continue;
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]);
    const values = JSON.parse(plain.toString('utf8')) as number[];
    if (!Array.isArray(values)) throw new Error('Invalid biometric template');
    return values;
  }
  throw new Error('Unable to decrypt biometric template. Check the current and previous encryption keys.');
}
