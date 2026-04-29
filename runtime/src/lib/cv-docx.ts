import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import type { CvTailorOutput } from '../agents/cv-tailor/schemas.js';

export async function buildCvDocx(cv: CvTailorOutput['cv']): Promise<Buffer> {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      text: cv.name,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
    }),
    new Paragraph({
      children: [new TextRun({ text: cv.title, bold: true })],
      spacing: { after: 120 },
    }),
    new Paragraph({
      text: cv.contact,
      spacing: { after: 220 },
    }),
    new Paragraph({
      text: cv.profile,
      spacing: { after: 220 },
    }),
  );

  pushSection(children, 'Kjernekompetanse', cv.coreCompetencies.map(item =>
    new Paragraph({
      text: item,
      bullet: { level: 0 },
    })
  ));

  const experienceParagraphs: Paragraph[] = [];
  for (const exp of cv.experience) {
    experienceParagraphs.push(
      new Paragraph({
        children: [new TextRun({ text: `${exp.company} | ${exp.role}`, bold: true })],
        spacing: { before: 120, after: 40 },
      }),
      new Paragraph({
        children: [new TextRun({ text: exp.period, italics: true })],
        spacing: { after: 80 },
      }),
      new Paragraph({
        text: exp.description,
        spacing: { after: 80 },
      }),
    );

    for (const highlight of exp.highlights) {
      experienceParagraphs.push(new Paragraph({
        text: highlight,
        bullet: { level: 0 },
      }));
    }
  }
  pushSection(children, 'Erfaring', experienceParagraphs);

  if (cv.previousExperienceSummary) {
    pushSection(children, 'Tidligere erfaring', [
      new Paragraph({ text: cv.previousExperienceSummary }),
    ]);
  }

  if (cv.education.length > 0) {
    pushSection(children, 'Utdanning', cv.education.map(item => new Paragraph({
      text: item,
      bullet: { level: 0 },
    })));
  }

  if (cv.certifications.length > 0) {
    pushSection(children, 'Sertifiseringer', cv.certifications.map(item => new Paragraph({
      text: item,
      bullet: { level: 0 },
    })));
  }

  if (cv.talks.length > 0) {
    pushSection(children, 'Foredrag', cv.talks.map(item => new Paragraph({
      text: item,
      bullet: { level: 0 },
    })));
  }

  if (cv.languages.length > 0) {
    pushSection(children, 'Språk', [
      new Paragraph({ text: cv.languages.join(' | ') }),
    ]);
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

function pushSection(target: Paragraph[], heading: string, body: Paragraph[]) {
  if (body.length === 0) return;
  target.push(
    new Paragraph({
      text: heading,
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 120 },
    }),
    ...body,
  );
}

export function buildCvDocxFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'cv'}.docx`;
}
