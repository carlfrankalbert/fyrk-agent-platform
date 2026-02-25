/** Strip markdown JSON fences (```json ... ```) from Claude responses.
 *  Handles both fully-wrapped responses and responses with preamble text before the JSON block. */
export function stripJsonFences(text: string): string {
  let s = text.trim();
  // Case 1: entire text is wrapped in fences
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    return s;
  }
  // Case 2: JSON block embedded after preamble text
  const fenceMatch = s.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    return fenceMatch[1];
  }
  return s;
}
