/** Strip markdown JSON fences (```json ... ```) from Claude responses.
 *  Handles three cases:
 *  1. Entire response wrapped in fences
 *  2. JSON block embedded after preamble text (inside fences)
 *  3. Raw JSON optionally followed by trailing commentary — extracts the first balanced object/array */
export function stripJsonFences(text: string): string {
  let s = text.trim();

  // Case 1: entire text is wrapped in fences
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    return extractBalancedJson(s);
  }

  // Case 2: JSON block embedded after preamble text
  const fenceMatch = s.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    return fenceMatch[1];
  }

  // Case 3: raw text — try to extract a balanced JSON object/array if there's trailing content
  return extractBalancedJson(s);
}

/** If text contains a JSON object/array followed by trailing non-whitespace,
 *  extract just the balanced JSON portion using brace/bracket counting.
 *  Returns the input unchanged if it does not start with { or [.
 *  Respects string literals (does not count braces inside strings). */
function extractBalancedJson(text: string): string {
  const trimmed = text.trim();
  const first = trimmed[0];
  if (first !== '{' && first !== '[') return text;

  const open = first;
  const close = first === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return trimmed.slice(0, i + 1);
    }
  }

  return text;
}
