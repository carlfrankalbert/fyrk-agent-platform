// Scoring facts extracted from Carl's supplied Erfaringsbase, 2026-10-01.
// Keep evidence, limitations and preferences separate; mention of a tool is not expert competence.
export const experienceProfile = {
  version: '2026-10-01',
  generalExperienceYears: 15,
  formalProductLeadership: { from: '2024-01', to: '2025-11', months: 23 },
  functionalProductLeadership: { project: 'Kundedialog', period: '2022-01 – 2023-01', startUnknown: true },
  dataLeadership: { from: '2023-02', to: '2023-12', deepTechnicalExpertise: false },
  publicSector: { from: '2018-02', to: '2018-09', months: 8, customer: 'Domstoladministrasjonen' },
  languages: { swedish: 'native', norwegian: 'professional', english: 'professional', german: 'basic' },
  fyrk: { approvedStaffingCompany: true, customerAssignments: 0 },
  excludedCustomers: ['SpareBank 1', 'SpareBank 1 Utvikling'],
  certifications: ['AI for Produktledere', 'CSPO', 'CSM', 'ISTQB Test Automation Engineering', 'ASTQB Mobile Tester',
    'PRINCE2 Foundation', 'ISTQB Test Analyst', 'ISTQB Technical Test Analyst', 'REQB Foundation', 'ISTQB Agile Tester',
    'ISTQB Test Manager', 'ISTQB Foundation'],
} as const;

interface Evidence { id: string; match: RegExp; text: string }
// Each rule names actual work or a qualification, rather than looking for its name anywhere in a CV.
export const experienceEvidence: Evidence[] = [
  { id: 'product', match: /produktled|produkteier|product manager|product management|product owner|produktstrateg|product strateg|produktretning/, text: 'SpareBank 1, 2024–2025: produktretning, roadmap og prioritering for mobilbank, betaling og transaksjoner.' },
  { id: 'test', match: /testled|test manager|teststrateg|testplan|testprosedyr|testrapport|avvikshandtering|programvaretest|testmetodikk|testtilfell|testscenar|akseptansetest|acceptance test|regresjonstest|regression test|shift left|testautomatisering/, text: 'SpareBank 1, Vipps, Varner og Domstoladministrasjonen: testledelse, akseptansetest og kvalitetsdrevet leveranse.' },
  { id: 'team', match: /teamled|team lead|tverrfaglig|cross functional|teamutvikling|team development/, text: 'Kundedialog og mobilbank: ledelse og utvikling av tverrfaglige team.' },
  { id: 'delivery', match: /prosjektled|project management|programme management|leveranseled|delivery management|releaseled|release management|avhengighet|dependenc|risiko|risks|issues|remediation/, text: 'EVRY og Kundedialog: prosjektledelse. SpareBank 1: releaseledelse og koordinering av leveranser og avhengigheter.' },
  { id: 'agile', match: /smidig|agile|scrum|kanban|coaching|coach|eksperiment|experiment/, text: 'SpareBank 1 og Varner: smidig coaching, Kanban, tidlig testing og inkrementell leveranse.' },
  { id: 'priorities', match: /prioriter|prioritis|roadmap|backlog|okr|malstyring|governance|styringsmodell|tight loose tight/, text: 'Kundedialog: tight-loose-tight, budsjett 18–20 MNOK og prioritering. Mobilbank: roadmap og mål.' },
  { id: 'stakeholders', match: /interessent|stakeholder|kommunikasjon|communication|forankring/, text: 'SpareBank 1: interessentforankring på tvers av forretning, utvikling og bankenes sikkerhetsmiljøer.' },
  { id: 'payments', match: /bank|finans|financial|fintech|betaling|payment|mobilbank|mobile banking|kredittkort|credit card|kortinnlosning|card acquiring|pci|efaktura/, text: 'BBS/Nets, Handelsbanken, EVRY, Vipps og SpareBank 1: betaling, kortinnløsning, PCI og mobilbank.' },
  { id: 'regulated', match: /regulated|regulerte|regulatory|compliance/, text: 'EVRY: PCI-prosjekt for maskering av kortdata. SpareBank 1: migrering og produktarbeid i regulert bankmiljø.' },
  { id: 'retail', match: /retail|e handel|ecommerce|e commerce|checkout/, text: 'Varner, 2019: testledelse på tvers av fire team for ny e-handelsplattform.' },
  { id: 'public', match: /offentlig|public sector|domstol|justis|justice/, text: 'Domstoladministrasjonen, 2018: ledet akseptansetest med 15 superbrukere for Lovisa.' },
  { id: 'data-leadership', match: /dataplattform|dataflyt|plattformprodukt|dataomrad|data platform|analyseplattform/, text: 'SpareBank 1, feb–des 2023: teamstruktur, arbeidsformer og leverandørvalg for data- og analyseplattform.' },
  { id: 'ai-product', match: /ai forsterket|ai produkt|ai product|anvendt ai|applied ai|agentbasert|agentutvikling|agent platform|agentplattform|produktarbeid.*ai/, text: 'FYRK: egen agentplattform og AI-verktøy for produktarbeid. Crisp: AI for Produktledere (2025); ingen FYRK-kundeoppdrag.' },
  { id: 'tools', match: /jira|confluence|zephyr|hpqc|hp alm|bitbucket|postman|appium|soapui|enterprise architect|adobe aem|bankwork/, text: 'Dokumentert verktøybruk i test-, prosjekt- og produktroller hos SpareBank 1, EVRY og Domstoladministrasjonen.' },
  { id: 'automation-tools', match: /typescript|fastify|claude api|supabase|fly io|n8n|zod|slack api/, text: 'FYRK: praktisk verktøybruk i egen agentplattform; ingen eksterne kundeoppdrag.' },
  { id: 'global-teams', match: /globale team|global teams|distribuerte team|distributed teams|internasjonale team|international teams/, text: 'EVRY og Varner: samarbeid med team i India, Polen, USA, Portugal og Brasil.' },
  { id: 'education', match: /hoyere utdanning|master|bachelor|bsc/, text: 'Jönköping International Business School: Master Entrepreneurial Management og BSc Business Informatics.' },
  { id: 'languages', match: /norsk|norwegian|english|engelsk|swedish|svensk/, text: 'Svensk morsmål, norsk og engelsk på profesjonelt nivå.' },
  { id: 'cspo', match: /cspo|certified scrum product owner/, text: 'Certified Scrum Product Owner (CSPO), 2021.' },
  { id: 'csm', match: /csm|certified scrummaster|certified scrum master/, text: 'Certified ScrumMaster (CSM), 2020.' },
  { id: 'istqb', match: /istqb/, text: 'Seks ISTQB-sertifiseringer: Foundation, Agile Tester, Test Manager, Test Analyst, Technical Test Analyst og Test Automation Engineering.' },
  { id: 'astqb', match: /astqb|certified mobile tester/, text: 'ASTQB Certified Mobile Tester, 2017.' },
  { id: 'reqb', match: /reqb/, text: 'REQB Foundation Level, 2016.' },
  { id: 'prince2', match: /prince2 foundation/, text: 'PRINCE2 Foundation, 2017.' },
  { id: 'staffing', match: /godkjent bemanningsforetak|approved staffing company/, text: 'FYRK AS er godkjent bemanningsforetak.' },
];

export const domainEvidence: Evidence[] = [
  experienceEvidence.find(e => e.id === 'payments')!, experienceEvidence.find(e => e.id === 'retail')!,
  experienceEvidence.find(e => e.id === 'public')!, experienceEvidence.find(e => e.id === 'data-leadership')!,
  experienceEvidence.find(e => e.id === 'ai-product')!,
];

export function experienceLimits(text: string): string[] {
  const limits: string[] = [];
  const specificYears = text.match(/(\d+(?:[.,]\d+)?)\s*\+?\s*(?:ars?\b|years?\b)/);
  if (/produktled|product manager|product management|product owner|produkteier/.test(text)) {
    if (specificYears && Number(specificYears[1].replace(',', '.')) * 12 > experienceProfile.formalProductLeadership.months) {
      limits.push('Dokumentert formell produktledertittel er 23 måneder. Funksjonelt ansvar i Kundedialog har ukjent start; Varner-vikariatet telles ikke i årskrav.');
    }
  }
  if (specificYears && /offentlig sektor|public sector/.test(text) && Number(specificYears[1].replace(',', '.')) * 12 > experienceProfile.publicSector.months) {
    limits.push('Dokumentert offentlig erfaring er Domstoladministrasjonen, feb–sep 2018; et flerårig sektorkrav er ikke dokumentert.');
  }
  if (specificYears && /\bai\b|kunstig intelligens|artificial intelligence/.test(text)) {
    limits.push('AI-grunnlaget er kurs fra 2025 og FYRKs eget verktøyarbeid; et bestemt antall års AI-erfaring er ikke dokumentert.');
  }
  const generalYears = text.match(/(?:minimum|minst|at least)\s+(\d+)\s*(?:ars?\b|years?\b)/);
  if (generalYears && Number(generalYears[1]) > experienceProfile.generalExperienceYears) limits.push('Mer enn 15 års spesifikk erfaring er ikke dokumentert i erfaringsbasen.');
  const technicalData = /ekspert|expert|arkitekt|architect|ingenior|engineer|utvikl|developer|hands on|dyp|deep|sql|etl|pipelines/.test(text);
  if ((/databricks|snowflake|data engineering|data engineer|dataarkitekt|data architect/.test(text) &&
    (!/teamled|team lead|ledelse|leadership/.test(text) || technicalData)) ||
    (/dataplattform|analyseplattform|data platform/.test(text) && technicalData)) {
    limits.push('Dataerfaringen gjelder teamledelse og leverandørvalg, ikke dokumentert teknisk ekspertise i Databricks/Snowflake eller data engineering.');
  }
  if (/norsk|norwegian/.test(text) && /morsmal|mother tongue|native/.test(text)) limits.push('Norsk er dokumentert på profesjonelt nivå; svensk er morsmål.');
  if (/tysk|german/.test(text) && /flytende|fluent|profesjonelt|professional/.test(text)) limits.push('Tysk er dokumentert på grunnleggende nivå.');
  if (/fyrk/.test(text) && /kundeoppdrag|client assignment|customer assignment/.test(text)) limits.push('FYRK har ingen dokumenterte eksterne kundeoppdrag.');
  return limits;
}
