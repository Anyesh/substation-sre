import { redis } from '@devvit/web/server';
import type { AppConfig } from '../shared/types.js';
import {
  configKey,
  volumeBaselineKey,
  dailyVolumeKey,
} from '../shared/constants.js';

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

export async function getConfig(): Promise<AppConfig | null> {
  let data: Record<string, string>;
  try {
    data = await redis.hGetAll(configKey());
  } catch {
    return null;
  }
  if (!data || Object.keys(data).length === 0) return null;

  return {
    aiProvider: (data['aiProvider'] as AppConfig['aiProvider']) ?? 'openai',
    aiApiKey: data['aiApiKey'] ?? '',
    aiBaseUrl: data['aiBaseUrl'] ?? '',
    aiModel: data['aiModel'] ?? '',
    notifChannel:
      (data['notifChannel'] as AppConfig['notifChannel']) ?? 'modmail',
    leadMod: data['leadMod'] ?? '',
    p1Def: data['p1Def'] ?? '',
    p2Def: data['p2Def'] ?? '',
    p3Def: data['p3Def'] ?? '',
    installedAt: Number(data['installedAt'] ?? '0'),
    version: data['version'] ?? '',
  };
}

export async function setConfig(config: Partial<AppConfig>): Promise<void> {
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) {
    if (v !== undefined) {
      fields[k] = String(v);
    }
  }
  if (Object.keys(fields).length > 0) {
    await redis.hSet(configKey(), fields);
  }
}

export async function getVolumeBaseline(): Promise<number> {
  const raw = await redis.get(volumeBaselineKey());
  return raw ? Number(raw) : 0;
}

export async function setVolumeBaseline(baseline: number): Promise<void> {
  await redis.set(volumeBaselineKey(), String(baseline));
}

export async function incrementDailyVolume(): Promise<number> {
  const d = new Date();
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const date = `${year}-${month}-${day}`;
  const key = dailyVolumeKey(date);

  const existed = await redis.get(key);
  const result = await redis.incrBy(key, 1);

  if (!existed) {
    await redis.expire(key, SEVEN_DAYS_SECONDS);
  }

  return result;
}

export async function getDailyVolume(date: string): Promise<number> {
  const raw = await redis.get(dailyVolumeKey(date));
  return raw ? Number(raw) : 0;
}
