import { estimateTokens } from '@qa/domain';

export type Chunk = {
  chunkIndex: number;
  heading: string | null;
  content: string;
  identifiers: string[];
  tokenEstimate: number;
};

// AC-LOGIN-04, BR-12, LOGIN-1, ERR-401 ...
const ID_PATTERN = /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[A-Z]?\b/g;
// "POST /api/login" or a bare "/api/login" path.
const PATH_PATTERN = /\b(?:GET|POST|PUT|PATCH|DELETE)\s+(\/[\w\-/{}.:]+)|(?<![\w])(\/api\/[\w\-/{}.:]+)/g;

/** Identifiers used for exact matching: AC/rule/ticket IDs and API paths. */
export function extractIdentifiers(text: string): string[] {
  const ids = new Set<string>(text.match(ID_PATTERN) ?? []);
  for (const m of text.matchAll(PATH_PATTERN)) ids.add((m[1] ?? m[2])!);
  return [...ids];
}

const HEADING = /^(#{1,4})\s+(.*)$/;
const MAX_TOKENS = 700;

/**
 * One chunk per heading section (an AC or rule group keeps its heading and list together).
 * Oversized sections split on paragraph boundaries, never mid-paragraph.
 */
export function chunkMarkdown(body: string): Chunk[] {
  const sections: Array<{ heading: string | null; lines: string[] }> = [{ heading: null, lines: [] }];
  for (const line of body.split(/\r?\n/)) {
    const h = HEADING.exec(line);
    if (h) sections.push({ heading: h[2]!.trim(), lines: [] });
    else sections.at(-1)!.lines.push(line);
  }

  const pieces: Array<{ heading: string | null; text: string }> = [];
  for (const s of sections) {
    const text = s.lines.join('\n').trim();
    if (!text && !s.heading) continue;
    if (estimateTokens(text) <= MAX_TOKENS) {
      pieces.push({ heading: s.heading, text });
      continue;
    }
    let buf = '';
    for (const para of text.split(/\n\s*\n/)) {
      if (buf && estimateTokens(buf + '\n\n' + para) > MAX_TOKENS) {
        pieces.push({ heading: s.heading, text: buf });
        buf = para;
      } else {
        buf = buf ? `${buf}\n\n${para}` : para;
      }
    }
    if (buf) pieces.push({ heading: s.heading, text: buf });
  }

  return pieces
    .filter((p) => p.text || p.heading)
    .map((p, i) => {
      const content = p.text || p.heading!;
      return {
        chunkIndex: i,
        heading: p.heading,
        content,
        identifiers: extractIdentifiers(`${p.heading ?? ''}\n${content}`),
        tokenEstimate: estimateTokens(`${p.heading ?? ''}\n${content}`),
      };
    });
}
