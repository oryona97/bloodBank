import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `scrypt-v1:${salt}:${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [version, salt, hex] = encoded.split(':');
  if (version !== 'scrypt-v1' || !salt || !hex || !/^[a-f0-9]{128}$/.test(hex)) return false;
  return timingSafeEqual(await derive(password, salt), Buffer.from(hex, 'hex'));
}
