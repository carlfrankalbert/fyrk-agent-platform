import type { SlackBlock } from '../../lib/slack.js';
import type { GtmMetrics, PivotTrigger } from './schemas.js';

function fmt(val: number | null, unit = ''): string {
  return val === null ? '_ikke logget_' : `${val}${unit}`;
}

export function buildDashboardBlocks(
  metrics: GtmMetrics,
  pivotTriggers: PivotTrigger[],
  weekNumber: number,
): SlackBlock[] {
  const hasAlerts = pivotTriggers.some((t) => t.severity === 'critical');

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `GTM Dashboard — Uke ${weekNumber}` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Aktive samtaler*\n${fmt(metrics.activeCalls)} / 3 mål` },
        { type: 'mrkdwn', text: `*Tilbud sendt*\n${fmt(metrics.offersSent)}` },
        { type: 'mrkdwn', text: `*Betalte dager (NSM)*\n${fmt(metrics.paidDays)} / 10 mål` },
        { type: 'mrkdwn', text: `*Folq inbound*\n${fmt(metrics.folqInbound)}` },
        { type: 'mrkdwn', text: `*ICP-kommentarer LinkedIn*\n${fmt(metrics.icpComments)}` },
      ],
    },
  ];

  if (pivotTriggers.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `${hasAlerts ? '🚨' : '⚠️'} *Pivot-triggere aktive:*\n` +
          pivotTriggers.map((t) => `• ${t.message}`).join('\n'),
      },
    });
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '✅ Ingen pivot-triggere aktive denne uken.' },
    });
  }

  if (metrics.paidDays === null || metrics.folqInbound === null || metrics.icpComments === null) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '💡 Logg manuelle metrikker med: `gtm-log folq:X icp:X paid:X`',
        },
      ],
    });
  }

  return blocks;
}
