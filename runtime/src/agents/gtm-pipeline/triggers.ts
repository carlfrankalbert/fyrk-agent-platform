import type { GtmMetrics, GtmLead, PivotTrigger } from './schemas.js';

/**
 * Evaluate pivot triggers based on current metrics, week number, and leads.
 * Pure function — no side effects.
 */
export function evaluatePivotTriggers(
  metrics: GtmMetrics,
  weekNumber: number,
  leads: GtmLead[],
): PivotTrigger[] {
  const triggers: PivotTrigger[] = [];

  // T1: 15+ conversations + 0 offers after week 6
  const contactedCount = leads.filter(
    (l) => l.status === 'active' || l.status === 'not_relevant',
  ).length;

  if (weekNumber >= 6 && contactedCount >= 15 && metrics.offersSent === 0) {
    triggers.push({
      id: 'T1',
      message: 'Trigger #1: 15+ samtaler uten tilbudsforespørsel. Revider budskap — ikke øk volum.',
      severity: 'critical',
    });
  }

  // T2: All signed leads have company_size < 30 (≥2 signed with size set)
  const signedLeads = leads.filter((l) => l.status === 'signed');
  const signedWithSize = signedLeads.filter((l) => l.company_size != null);

  if (
    signedWithSize.length >= 2 &&
    signedWithSize.every((l) => l.company_size! < 30)
  ) {
    triggers.push({
      id: 'T2',
      message: 'Trigger #2: Alle signerte er under ICP-terskel (<30 ansatte). Vurder å flytte beachhead-segment ned.',
      severity: 'warning',
    });
  }

  // T3: 0 paid days after week 12 (skip when paidDays is null)
  if (weekNumber >= 12 && metrics.paidDays !== null && metrics.paidDays === 0) {
    triggers.push({
      id: 'T3',
      message: 'Trigger #3 (kritisk): 0 betalte dager etter uke 12. Stopp LinkedIn. Ring topp 5 kontakter direkte.',
      severity: 'critical',
    });
  }

  // T5: Folq inbound > 50% of active calls (skip when null)
  if (
    metrics.folqInbound !== null &&
    metrics.folqInbound > 0 &&
    metrics.folqInbound > metrics.activeCalls * 0.5
  ) {
    triggers.push({
      id: 'T5',
      message: 'Trigger #5 (positivt): Folq-inbound sterk. Vurder å øke Folq-investering.',
      severity: 'warning',
    });
  }

  return triggers;
}
