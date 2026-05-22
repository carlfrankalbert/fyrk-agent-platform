import { describe, it, expect } from 'vitest';
import { stripJsonFences } from '../src/lib/json.js';

describe('stripJsonFences', () => {
  describe('fenced responses', () => {
    it('unwraps a response fully wrapped in json fences', () => {
      const text = '```json\n{"a":1}\n```';
      expect(JSON.parse(stripJsonFences(text))).toEqual({ a: 1 });
    });

    it('unwraps fences without a language tag', () => {
      const text = '```\n{"a":1}\n```';
      expect(JSON.parse(stripJsonFences(text))).toEqual({ a: 1 });
    });

    it('extracts a fenced block that follows preamble text', () => {
      const text = 'Here is the JSON you asked for:\n```json\n{"a":1}\n```';
      expect(JSON.parse(stripJsonFences(text))).toEqual({ a: 1 });
    });
  });

  describe('raw responses', () => {
    it('returns raw JSON unchanged', () => {
      const text = '{"a":1}';
      expect(JSON.parse(stripJsonFences(text))).toEqual({ a: 1 });
    });

    it('strips trailing commentary after a JSON object', () => {
      const text = '{"a":1}\n\nHope this helps!';
      expect(stripJsonFences(text)).toBe('{"a":1}');
    });

    it('strips trailing commentary after a JSON array', () => {
      const text = '[1,2,3]\n\nLet me know if you need more.';
      expect(stripJsonFences(text)).toBe('[1,2,3]');
    });

    it('extracts a balanced object from a nested structure', () => {
      const text = '{"a":{"b":[1,2]},"c":3} -- done';
      expect(JSON.parse(stripJsonFences(text))).toEqual({ a: { b: [1, 2] }, c: 3 });
    });
  });

  describe('string-literal handling', () => {
    it('does not count braces inside string values', () => {
      const text = '{"msg":"a } b { c"} trailing text';
      expect(stripJsonFences(text)).toBe('{"msg":"a } b { c"}');
    });

    it('respects escaped quotes inside strings', () => {
      const text = '{"msg":"she said \\"hi\\""} trailing';
      expect(JSON.parse(stripJsonFences(text))).toEqual({ msg: 'she said "hi"' });
    });
  });

  describe('non-JSON input', () => {
    it('returns plain text unchanged', () => {
      expect(stripJsonFences('just some text')).toBe('just some text');
    });

    it('trims surrounding whitespace', () => {
      expect(stripJsonFences('  {"a":1}  ')).toBe('{"a":1}');
    });
  });
});
