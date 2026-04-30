// TODO: Import crypto module
import crypto from 'crypto';
// TODO: Define ENCRYPTION_KEY — pull from process.env.
//       Use a dedicated env var, fall back to SESSION_SECRET.
//       Same pattern as before, but now it lives in one place.
const ENCRYPTION_KEY = process.env.USER_API_KEY_ENCRYPTION_KEY || process.env.SESSION_SECRET || 'default-encryption-key';
// TODO: Implement and export encrypt(text) function using AES-256-CBC.
//       Return null/undefined early if text is falsy.
//       Store IV and encrypted text together separated by ':'.
export function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}
// TODO: Implement and export decrypt(text) function.
//       Return the text early if it is falsy or does not contain ':'.
export function decrypt(text) {
  if (!text || !text.includes(':')) return text;
  const [ivHex, encrypted] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}