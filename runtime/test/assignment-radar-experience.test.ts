import { describe, it, expect } from 'vitest';
import { experienceProfile } from '../src/agents/assignment-radar/experience-profile.js';
import { assessRequirement, scoreAssignment } from '../src/agents/assignment-radar/score.js';
import { normalize } from '../src/agents/assignment-radar/normalize.js';
import { ProfileSchema } from '../src/agents/assignment-radar/schemas.js';
import { slackText } from '../src/agents/assignment-radar/slack.js';

const now = '2026-10-01T01:00:00.000Z', profile = ProfileSchema.parse({});
const assignment = (description: string, title = 'Senior produktleder', customer: string | null = 'DNB') => normalize('ic', {
  external_id: 'experience-test', url: 'https://ic.no/oppdrag/experience-test', title, customer,
  location: 'Oslo', extent: '100%', deadline: '2026-10-30', description,
}, now);
const score = (description: string, title?: string, customer?: string | null) => scoreAssignment(assignment(description, title, customer), profile, '2026-10-01');

describe('Carl supplied experience base in radar scoring', () => {
  it('preserves verified dates, limited tenure, all 12 certifications and company facts', () => {
    expect(experienceProfile.formalProductLeadership).toEqual({ from: '2024-01', to: '2025-11', months: 23 });
    expect(experienceProfile.functionalProductLeadership.startUnknown).toBe(true);
    expect(experienceProfile.dataLeadership).toMatchObject({ from: '2023-02', to: '2023-12', deepTechnicalExpertise: false });
    expect(experienceProfile.certifications).toHaveLength(12);
    expect(experienceProfile.fyrk).toEqual({ approvedStaffingCompany: true, customerAssignments: 0 });
  });
  it.each(['CSPO', 'CSM', 'ISTQB Advanced Level Test Manager', 'ISTQB Test Automation Engineering',
    'ASTQB Certified Mobile Tester', 'REQB Foundation', 'PRINCE2 Foundation'])('supports documented certification %s', requirement => {
    expect(assessRequirement(requirement).supported).toBe(true);
  });
  it.each(['PMP og Scrum', 'PRINCE2 Practitioner', 'ISTQB Expert', 'SAP erfaring og Jira'])('keeps an unsupported qualification %s below the relevance threshold', requirement => {
    const s = score(`Skal-krav\n${requirement}`);
    expect(s.total).toBeLessThan(70); expect(s.gaps.join(' ')).toContain(requirement);
  });
  it.each(['Minst 4 års erfaring som produktleder', 'At least 5 years of product management experience',
    'Minimum 2 år som produktleder', 'Minimum 15 years of product management in banking'])('does not turn general seniority into %s', requirement => {
    const s = score(`Skal-krav\n${requirement}`);
    expect(s.total).toBeLessThan(70); expect(s.gaps.join(' ')).toContain('23 måneder');
    expect(s.gaps.join(' ')).toContain('ukjent start');
  });
  it('allows a documented one-year product leadership minimum', () => {
    expect(assessRequirement('Minst 1 års erfaring som produktleder').supported).toBe(true);
  });
  it.each(['Minst 5 års erfaring fra offentlig sektor', 'At least 3 years of AI product work'])('does not use general seniority to prove %s', requirement => {
    expect(assessRequirement(requirement).supported).toBe(false);
    expect(score(`Skal-krav\n${requirement}`).total).toBeLessThan(70);
  });
  it.each(['Dyp teknisk ekspertise i Snowflake og dataplattform', 'Hands-on Databricks-utvikling',
    'Data engineering og smidig', 'SQL-utvikling på dataplattform', 'Teamledelse og ekspertise i Snowflake'])('does not infer technical data expertise from %s', requirement => {
    expect(assessRequirement(requirement).supported).toBe(false);
    expect(score(`Skal-krav\n${requirement}`).gaps.join(' ')).toContain('ikke dokumentert teknisk ekspertise');
  });
  it('matches data team leadership with a concrete, limited project description', () => {
    expect(assessRequirement('Teamledelse for Databricks og Snowflake').supported).toBe(true);
    const s = score('Prioritering og teamledelse på ny dataplattform');
    expect(s.breakdown.domain).toBe(15);
    expect(s.reasons.join(' ')).toContain('feb–des 2023');
    expect(s.reasons.join(' ')).toContain('teamstruktur');
  });
  it('names retail and public projects in the Slack assessment', () => {
    const a = assignment('Testledelse og akseptansetest i offentlig sektor. Erfaring fra e-handel ønskes.', 'Senior Test Manager');
    const s = scoreAssignment(a, profile, '2026-10-01');
    const text = slackText({ id: '1', assignment: a, observations: [a], score: s });
    expect(text).toContain('Varner'); expect(text).toContain('Domstoladministrasjonen'); expect(text).not.toContain('ESAS');
  });
  it('uses payments, PCI and globally distributed teams as supported experience', () => {
    expect(assessRequirement('Erfaring med kortinnløsning og PCI').evidence.join(' ')).toContain('Handelsbanken');
    expect(assessRequirement('Ledelse av distribuerte team').supported).toBe(true);
    expect(assessRequirement('Ledelse av distribuerte team').evidence.join(' ')).toContain('India, Polen, USA, Portugal og Brasil');
  });
  it('matches applied AI product work without claiming customer delivery at FYRK', () => {
    const s = score('Anvendt AI og agentbaserte arbeidsflyter for produktarbeid');
    expect(s.breakdown.domain).toBe(15); expect(s.reasons.join(' ')).toContain('ingen FYRK-kundeoppdrag');
    expect(assessRequirement('FYRK må ha gjennomført kundeoppdrag med TypeScript').supported).toBe(false);
  });
  it('distinguishes professional Norwegian/English from mother tongue or fluent German', () => {
    expect(assessRequirement('Profesjonell norsk og engelsk').supported).toBe(true);
    expect(assessRequirement('Norsk på morsmålsnivå').supported).toBe(false);
    expect(assessRequirement('Native Norwegian speaker').supported).toBe(false);
    expect(assessRequirement('Flytende tysk og engelsk').supported).toBe(false);
  });
  it.each(['SpareBank 1', 'SpareBank 1 Utvikling AS', 'SpareBank 1 SMN'])('filters the known excluded customer %s', customer => {
    const s = score('Bank, betaling og produktledelse', 'Senior produktleder', customer);
    expect(s.total).toBe(0); expect(s.relevant).toBe(false); expect(s.action).toBe('Arkiver treffet.');
    expect(s.gaps.join(' ')).toContain('ikke aktuell som oppdragsgiver');
  });
  it('does not exclude another client because SpareBank 1 is mentioned as experience', () => {
    expect(score('Erfaring fra SpareBank 1 er ønskelig. Bank og betaling.', 'Senior produktleder', 'DNB').relevant).toBe(true);
    expect(score('Relevant erfaring fra SpareBank 1.', 'Senior produktleder med erfaring fra SpareBank 1', null).relevant).toBe(true);
  });
  it('keeps availability out of the score after adding the experience base', () => {
    const a = assignment('Bank, betaling og produktledelse');
    expect(scoreAssignment({ ...a, start_date: '2027-01-01' }, profile, '2026-10-01')).toEqual(scoreAssignment(a, profile, '2026-10-01'));
  });
});
