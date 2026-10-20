import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkAlias, checkRegion } from './policy.mjs';

export type Account = { alias: string; profile: string; regions: string[] };
export type Config = { token: string; admins: Set<number>; accounts: Account[]; scriptsDir: string };

export function loadConfig(): Config {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('Set valid TELEGRAM_BOT_TOKEN in .env');
  const adminText = process.env.TELEGRAM_ADMIN_IDS ?? '';
  const adminStrings = adminText.split(',').map(x => x.trim()).filter(Boolean);
  if (!adminStrings.length || adminStrings.some(x => !/^\d+$/.test(x))) throw new Error('Set numeric TELEGRAM_ADMIN_IDS.');
  const admins = new Set(adminStrings.map(Number));
  if ([...admins].some(x => !Number.isSafeInteger(x) || x <= 0)) throw new Error('Invalid admin ID');
  const path = resolve(process.env.ACCOUNTS_CONFIG ?? './config/accounts.json');
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!data || typeof data !== 'object' || !('accounts' in data) || !Array.isArray(data.accounts) || !data.accounts.length) {
    throw new Error('Account config must contain a non-empty accounts array.');
  }
  const accounts: Account[] = data.accounts.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid account entry.');
    const e = entry as Record<string, unknown>;
    const alias = checkAlias(e.alias);
    if (typeof e.profile !== 'string' || !/^[\w-]{1,64}$/.test(e.profile)) throw new Error('Invalid AWS profile.');
    if (!Array.isArray(e.regions) || e.regions.length === 0 || e.regions.some(r => typeof r !== 'string')) throw new Error('Each account needs allowed regions.');
    const regions = e.regions.map(checkRegion);
    return { alias, profile: e.profile, regions };
  });
  if (new Set(accounts.map(a => a.alias)).size !== accounts.length) throw new Error('Account aliases must be unique.');
  return { token, admins, accounts, scriptsDir: resolve(process.env.SCRIPTS_DIR ?? './scripts') };
}
