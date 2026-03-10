export interface TargetAccount {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  segment: string | null;
  tier: string;
}

/**
 * Build a normalized deduplication key from person, company, and trigger type.
 * Format: "personname:companyname:triggertype" (lowercased, trimmed).
 */
export function buildDedupeKey(personName: string, companyName: string, triggerType: string): string {
  return [personName, companyName, triggerType]
    .map((s) => s.toLowerCase().trim())
    .join(':');
}

/**
 * Match a company against the target accounts list.
 * Priority: exact domain match → fuzzy name containment → null.
 */
export function matchTargetAccount(
  companyName: string,
  companyDomain: string | undefined,
  targets: TargetAccount[],
): TargetAccount | null {
  // 1. Exact domain match
  if (companyDomain) {
    const domainLower = companyDomain.toLowerCase().trim();
    const byDomain = targets.find((t) => t.domain?.toLowerCase() === domainLower);
    if (byDomain) return byDomain;
  }

  // 2. Fuzzy name containment (bidirectional)
  const nameLower = companyName.toLowerCase().trim();
  const byName = targets.find((t) => {
    const targetName = t.name.toLowerCase().trim();
    return targetName.includes(nameLower) || nameLower.includes(targetName);
  });
  if (byName) return byName;

  return null;
}
