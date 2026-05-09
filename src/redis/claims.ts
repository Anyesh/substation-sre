import { redis } from '@devvit/web/server';
import type { Claim } from '../shared/types.js';
import {
  claimKey,
  claimsActiveKey,
  CLAIM_TTL_SECONDS,
} from '../shared/constants.js';

export async function createClaim(
  contentId: string,
  mod: string,
  incidentId?: string
): Promise<void> {
  const now = Date.now();
  const key = claimKey(contentId);

  await redis.hSet(key, {
    contentId,
    mod,
    claimedAt: String(now),
    incidentId: incidentId ?? '',
    note: '',
  });

  await redis.zAdd(claimsActiveKey(), { member: contentId, score: now });
  await redis.expire(key, CLAIM_TTL_SECONDS);
}

export async function getClaim(contentId: string): Promise<Claim | null> {
  const data = await redis.hGetAll(claimKey(contentId));
  if (!data || Object.keys(data).length === 0) return null;

  return {
    contentId: data['contentId'] ?? contentId,
    mod: data['mod'] ?? '',
    claimedAt: Number(data['claimedAt'] ?? 0),
    incidentId: data['incidentId'] || null,
    note: data['note'] ?? '',
  };
}

export async function releaseClaim(contentId: string): Promise<void> {
  await redis.del(claimKey(contentId));
  await redis.zRem(claimsActiveKey(), [contentId]);
}

export async function getActiveClaims(): Promise<Claim[]> {
  const entries = await redis.zRange(claimsActiveKey(), 0, -1);
  const claims: Claim[] = [];

  for (const entry of entries) {
    const claim = await getClaim(entry.member);
    if (claim) claims.push(claim);
  }

  return claims;
}

export async function sweepExpiredClaims(): Promise<number> {
  const entries = await redis.zRange(claimsActiveKey(), 0, -1);
  let removed = 0;

  for (const entry of entries) {
    const data = await redis.hGetAll(claimKey(entry.member));
    if (!data || Object.keys(data).length === 0) {
      await redis.zRem(claimsActiveKey(), [entry.member]);
      removed++;
    }
  }

  return removed;
}

export async function isClaimedByOther(
  contentId: string,
  mod: string
): Promise<boolean> {
  const claim = await getClaim(contentId);
  if (!claim) return false;
  return claim.mod !== mod;
}
