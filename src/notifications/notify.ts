import { reddit, context } from '@devvit/web/server';
import { getConfig } from '../redis/config.js';
import type { AppConfig, Incident } from '../shared/types.js';

export type NotifyArgs = {
  subject: string;
  body: string;
};

export async function notifyMods(args: NotifyArgs): Promise<void> {
  const config = await getConfig();
  if (!config) {
    console.warn('Notify: no config, skipping.');
    return;
  }

  if (config.notifChannel === 'modmail') {
    await sendModmail(config, args);
  } else {
    await sendDirectMessage(config, args);
  }
}

async function sendModmail(
  config: AppConfig,
  { subject, body }: NotifyArgs
): Promise<void> {
  const subredditName = context.subredditName;
  if (!subredditName) {
    console.warn('Notify: no subredditName in context, cannot send modmail.');
    return;
  }

  try {
    await reddit.modMail.createConversation({
      subredditName,
      subject,
      body,
      isAuthorHidden: false,
      ...(config.leadMod ? { to: config.leadMod } : {}),
    });
  } catch (err) {
    console.error('Notify: modmail send failed', err);
  }
}

async function sendDirectMessage(
  config: AppConfig,
  { subject, body }: NotifyArgs
): Promise<void> {
  if (!config.leadMod) {
    console.warn('Notify: no leadMod configured, skipping PM.');
    return;
  }

  try {
    await reddit.sendPrivateMessage({
      to: config.leadMod,
      subject,
      text: body,
    });
  } catch (err) {
    console.error('Notify: PM send failed', err);
  }
}

export function formatIncidentDeclared(incident: Incident): NotifyArgs {
  const body = [
    `**${incident.severity} incident declared: ${incident.title}**`,
    '',
    `Declared by u/${incident.declaredBy} at ${new Date(incident.declaredAt).toUTCString()}.`,
    '',
    incident.description ? incident.description : '_No description provided._',
    '',
    'Open the SubStation dashboard to coordinate response.',
  ].join('\n');

  return {
    subject: `[SubStation] ${incident.severity} incident: ${incident.title}`,
    body,
  };
}

export function formatVolumeSpike(args: {
  volume: number;
  baseline: number;
  multiplier: number;
  hour: number;
  inCoverageGap: boolean;
}): NotifyArgs {
  const body = [
    `**Queue volume spike detected.**`,
    '',
    `Today's report volume is **${args.volume}**, which exceeds **${args.multiplier}x** the baseline of ${args.baseline}.`,
    `Current hour (UTC): ${String(args.hour).padStart(2, '0')}:00${args.inCoverageGap ? ' — this is a known coverage gap.' : ''}`,
    '',
    'Consider declaring an incident or pulling in additional coverage.',
  ].join('\n');

  return {
    subject: '[SubStation] Queue volume spike detected',
    body,
  };
}

export function formatCoverageGapAlert(gapHours: number[]): NotifyArgs {
  const formatted =
    gapHours.length > 0
      ? gapHours.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ')
      : 'no coverage gaps detected';

  const body = [
    `**Coverage map updated.**`,
    '',
    `Hours without scheduled coverage (UTC): ${formatted}`,
    '',
    'Update mod schedules in SubStation Settings to close gaps.',
  ].join('\n');

  return {
    subject: '[SubStation] Coverage gaps detected',
    body,
  };
}
