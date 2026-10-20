import { getDocumentProxy, extractText } from 'unpdf';

/**
 * PDF-only for this MVP. Cloudflare Workers has no reliable way to run a
 * full .docx parser (the usual Node libraries assume a filesystem/Node
 * APIs Workers doesn't have), and `unpdf` is built specifically for
 * edge/serverless PDF text extraction, so PDF is the one format we can
 * parse robustly without adding a heavier dependency. Reject anything else
 * at upload time with a clear message rather than silently failing later.
 *
 * Link targets: many resume templates (e.g. LaTeX "Mail · LinkedIn" headers) show
 * only the WORD "Mail" and hide the actual address in a mailto: link, so it never
 * appears in the visible text. We read each page's link annotations and append
 * them, so the email is found like any other text.
 */
export async function extractResumeText(fileBuffer: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(fileBuffer));
  const { text } = await extractText(pdf, { mergePages: true });

  const links: string[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const annots = (await page.getAnnotations()) as { url?: string; unsafeUrl?: string }[];
      for (const a of annots) {
        const raw = (a.url || a.unsafeUrl || '').trim();
        if (!raw) continue;
        const link = raw.toLowerCase().startsWith('mailto:')
          ? decodeURIComponent(raw.slice('mailto:'.length).split('?')[0])
          : raw;
        if (link && !links.includes(link)) links.push(link);
      }
    }
  } catch { /* link extraction is best-effort — the visible text is still returned */ }

  return links.length ? `${text}\n\nLinks in the document:\n${links.join('\n')}` : text;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Every email address that literally appears in the resume text (including link targets). */
export function emailsInText(text: string): string[] {
  return Array.from(new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase())));
}
