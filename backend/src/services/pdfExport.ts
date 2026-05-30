/**
 * PDF Export Service
 *
 * Renders a TailoredResume to a PDF using Puppeteer and stores the result
 * in SeaweedFS. Falls back to the original base resume file if PDF generation
 * fails.
 *
 * Requirements: 9.10, 9.13
 */

import puppeteer from 'puppeteer';
import type { TailoredResume } from '../agents/resumeOptimizer.js';
import { uploadFile, downloadFile } from './storage.js';
import { createChildLogger } from '../core/logger.js';

const log = createChildLogger({ module: 'pdfExport' });

// ─── HTML builder ─────────────────────────────────────────────────────────────

/**
 * Escape a string for safe inclusion in HTML text content.
 */
function esc(text: string | null | undefined): string {
  if (text == null) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render a complete, styled HTML page from a TailoredResume.
 * Uses only inline styles and no external resources so it is fully
 * self-contained and suitable for Puppeteer's print-to-PDF path.
 *
 * @internal
 */
export function buildResumeHtml(resume: TailoredResume): string {
  const { content } = resume;

  // ── Summary ──────────────────────────────────────────────────────────────
  const summarySection = content.summary
    ? `
    <section>
      <h2 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #333;padding-bottom:2px;margin:14px 0 6px;">Professional Summary</h2>
      <p style="margin:0;line-height:1.5;">${esc(content.summary)}</p>
    </section>`
    : '';

  // ── Work Experience ───────────────────────────────────────────────────────
  const experiencesHtml = content.experiences
    .map((exp) => {
      const dateRange = exp.isCurrent
        ? `${esc(exp.startDate)} – Present`
        : `${esc(exp.startDate)}${exp.endDate ? ` – ${esc(exp.endDate)}` : ''}`;

      const location = exp.location ? ` &bull; ${esc(exp.location)}` : '';
      const description = exp.description
        ? `<p style="margin:3px 0;font-style:italic;">${esc(exp.description)}</p>`
        : '';
      const bullets =
        exp.bullets.length > 0
          ? `<ul style="margin:4px 0 0 18px;padding:0;">
              ${exp.bullets.map((b) => `<li style="margin:2px 0;">${esc(b)}</li>`).join('\n')}
             </ul>`
          : '';

      return `
      <div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <strong>${esc(exp.title)}</strong>
          <span style="font-size:10px;color:#555;">${dateRange}</span>
        </div>
        <div style="font-size:11px;color:#444;">${esc(exp.company)}${location}</div>
        ${description}
        ${bullets}
      </div>`;
    })
    .join('\n');

  const experiencesSection =
    content.experiences.length > 0
      ? `
    <section>
      <h2 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #333;padding-bottom:2px;margin:14px 0 6px;">Work Experience</h2>
      ${experiencesHtml}
    </section>`
      : '';

  // ── Education ─────────────────────────────────────────────────────────────
  const educationHtml = content.education
    .map((edu) => {
      const dateRange = `${esc(edu.startDate)}${edu.endDate ? ` – ${esc(edu.endDate)}` : ''}`;
      const field = edu.field ? `, ${esc(edu.field)}` : '';
      const gpa = edu.gpa != null ? ` &bull; GPA: ${edu.gpa}` : '';
      const description = edu.description
        ? `<p style="margin:3px 0;font-style:italic;">${esc(edu.description)}</p>`
        : '';

      return `
      <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <strong>${esc(edu.degree)}${field}</strong>
          <span style="font-size:10px;color:#555;">${dateRange}</span>
        </div>
        <div style="font-size:11px;color:#444;">${esc(edu.institution)}${gpa}</div>
        ${description}
      </div>`;
    })
    .join('\n');

  const educationSection =
    content.education.length > 0
      ? `
    <section>
      <h2 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #333;padding-bottom:2px;margin:14px 0 6px;">Education</h2>
      ${educationHtml}
    </section>`
      : '';

  // ── Projects ──────────────────────────────────────────────────────────────
  const projectsHtml = content.projects
    .map((proj) => {
      const dateRange = proj.startDate
        ? proj.isCurrent
          ? `${esc(proj.startDate)} – Present`
          : `${esc(proj.startDate)}${proj.endDate ? ` – ${esc(proj.endDate)}` : ''}`
        : '';

      const links: string[] = [];
      if (proj.url) links.push(`<a href="${esc(proj.url)}" style="color:#1a0dab;">${esc(proj.url)}</a>`);
      if (proj.repoUrl) links.push(`<a href="${esc(proj.repoUrl)}" style="color:#1a0dab;">Repo</a>`);
      const linksHtml = links.length > 0 ? `<div style="font-size:10px;">${links.join(' &bull; ')}</div>` : '';

      const description = proj.description
        ? `<p style="margin:3px 0;font-style:italic;">${esc(proj.description)}</p>`
        : '';

      const highlights =
        proj.highlights.length > 0
          ? `<ul style="margin:4px 0 0 18px;padding:0;">
              ${proj.highlights.map((h) => `<li style="margin:2px 0;">${esc(h)}</li>`).join('\n')}
             </ul>`
          : '';

      return `
      <div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <strong>${esc(proj.name)}</strong>
          ${dateRange ? `<span style="font-size:10px;color:#555;">${dateRange}</span>` : ''}
        </div>
        ${linksHtml}
        ${description}
        ${highlights}
      </div>`;
    })
    .join('\n');

  const projectsSection =
    content.projects.length > 0
      ? `
    <section>
      <h2 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #333;padding-bottom:2px;margin:14px 0 6px;">Projects</h2>
      ${projectsHtml}
    </section>`
      : '';

  // ── Skills ────────────────────────────────────────────────────────────────
  // Group by category if present, otherwise list flat
  const skillsByCategory = new Map<string, string[]>();
  for (const skill of content.skills) {
    const category = skill.category ?? 'Skills';
    const existing = skillsByCategory.get(category) ?? [];
    existing.push(skill.name);
    skillsByCategory.set(category, existing);
  }

  const skillsHtml = Array.from(skillsByCategory.entries())
    .map(([category, names]) => {
      return `<div style="margin-bottom:4px;"><strong>${esc(category)}:</strong> ${names.map(esc).join(', ')}</div>`;
    })
    .join('\n');

  const skillsSection =
    content.skills.length > 0
      ? `
    <section>
      <h2 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #333;padding-bottom:2px;margin:14px 0 6px;">Skills</h2>
      ${skillsHtml}
    </section>`
      : '';

  // ── Certifications ────────────────────────────────────────────────────────
  const certificationsHtml = content.certifications
    .map((cert) => {
      const issuer = cert.issuer ? ` &bull; ${esc(cert.issuer)}` : '';
      const issueDate = cert.issueDate ? ` &bull; Issued: ${esc(cert.issueDate)}` : '';
      const expiry = cert.expiryDate ? ` &bull; Expires: ${esc(cert.expiryDate)}` : '';
      const credentialUrl = cert.credentialUrl
        ? ` &bull; <a href="${esc(cert.credentialUrl)}" style="color:#1a0dab;">View Credential</a>`
        : '';

      return `
      <div style="margin-bottom:6px;">
        <strong>${esc(cert.name)}</strong>
        <span style="font-size:11px;color:#444;">${issuer}${issueDate}${expiry}${credentialUrl}</span>
      </div>`;
    })
    .join('\n');

  const certificationsSection =
    content.certifications.length > 0
      ? `
    <section>
      <h2 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #333;padding-bottom:2px;margin:14px 0 6px;">Certifications</h2>
      ${certificationsHtml}
    </section>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Resume</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 12px;
      color: #111;
      margin: 0;
      padding: 0;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      max-width: 800px;
      margin: 0 auto;
      padding: 24px 32px;
    }
    a { text-decoration: none; }
    ul { list-style-type: disc; }
  </style>
</head>
<body>
  <div class="page">
    ${summarySection}
    ${experiencesSection}
    ${educationSection}
    ${projectsSection}
    ${skillsSection}
    ${certificationsSection}
  </div>
</body>
</html>`;
}

// ─── PDF generation ───────────────────────────────────────────────────────────

/**
 * Launch a Puppeteer browser, render the resume HTML, and print to PDF.
 * Returns the PDF as a Buffer.
 *
 * Always closes the browser in a `finally` block.
 * Throws on any failure — the caller is responsible for fallback handling.
 *
 * Requirements: 9.10
 */
export async function exportResumeToPdf(resume: TailoredResume): Promise<Buffer> {
  const html = buildResumeHtml(resume);

  log.info(
    { userId: resume.userId, baseResumeId: resume.baseResumeId, jobId: resume.jobId },
    'Launching Puppeteer for PDF export',
  );

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
      printBackground: true,
    });

    log.info(
      { userId: resume.userId, baseResumeId: resume.baseResumeId, jobId: resume.jobId, bytes: pdfBuffer.length },
      'PDF generated successfully',
    );

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

// ─── Top-level orchestrator ───────────────────────────────────────────────────

/**
 * Generate a PDF from the tailored resume and store it in SeaweedFS.
 *
 * On success: uploads the generated PDF under
 *   `resumes/{userId}/tailored_{jobId}.pdf`
 * On PDF failure: logs the error, downloads the original base resume from
 *   SeaweedFS using `baseResumeFileUrl`, re-uploads it under the same key,
 *   and returns that key — so the caller always receives a valid storage key.
 *
 * Requirements: 9.10, 9.13
 *
 * @param resume            The tailored resume to export.
 * @param baseResumeFileUrl The SeaweedFS key for the original base resume file
 *                          (i.e. `ResumeVersion.fileUrl`).
 * @returns The SeaweedFS storage key where the PDF (or fallback) was stored.
 */
export async function exportAndStore(
  resume: TailoredResume,
  baseResumeFileUrl: string,
): Promise<string> {
  const suffix = resume.jobId ?? resume.baseResumeId;
  const storageKey = `resumes/${resume.userId}/tailored_${suffix}.pdf`;

  let pdfBuffer: Buffer;

  try {
    pdfBuffer = await exportResumeToPdf(resume);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { userId: resume.userId, baseResumeId: resume.baseResumeId, jobId: resume.jobId, error: message },
      'PDF generation failed — falling back to original base resume file',
    );

    // Requirement 9.13: fall back to the original base resume file
    const originalBuffer = await downloadFile(baseResumeFileUrl);
    await uploadFile(storageKey, originalBuffer, 'application/pdf');

    log.info(
      { userId: resume.userId, storageKey, baseResumeFileUrl },
      'Fallback: original base resume stored under tailored key',
    );

    return storageKey;
  }

  await uploadFile(storageKey, pdfBuffer, 'application/pdf');

  log.info(
    { userId: resume.userId, storageKey, bytes: pdfBuffer.length },
    'PDF exported and stored in SeaweedFS',
  );

  return storageKey;
}
