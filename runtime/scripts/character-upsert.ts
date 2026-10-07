#!/usr/bin/env npx tsx
/**
 * Bootstrap or update a character's private state in Supabase from a local JSON file.
 *
 * Usage (from runtime/):
 *   pnpm character:upsert --file ../private/characters/<slug>.json
 *
 * Refuses files tracked by git and warns when a file is not gitignored: character minds stay out of the repo.
 * Prints ids and counts only — never canon or memory content.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CharacterFileSchema, upsertCharacter } from '../src/agents/character/bootstrap.js';
import { SupabaseCharacterStore } from '../src/agents/character/store.js';

function gitStatus(path: string): 'tracked' | 'ignored' | 'untracked' | 'unknown' {
  const git = (args: string[]): boolean => {
    try { execFileSync('git', args, { stdio: 'ignore' }); return true; } catch { return false; }
  };
  if (!git(['rev-parse', '--is-inside-work-tree'])) return 'unknown';
  if (git(['ls-files', '--error-unmatch', path])) return 'tracked';
  return git(['check-ignore', '-q', path]) ? 'ignored' : 'untracked';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter(a => a !== '--');
  const fileIdx = args.indexOf('--file');
  const filePath = fileIdx >= 0 ? args[fileIdx + 1] : undefined;
  if (!filePath) throw new Error('Usage: pnpm character:upsert --file <path/to/character.json>');
  const path = resolve(filePath);

  const status = gitStatus(path);
  if (status === 'tracked') throw new Error(`${filePath} is tracked by git. Character state must not be committed; move it to private/.`);
  if (status === 'untracked') console.warn(`Warning: ${filePath} is not gitignored. Prefer private/characters/.`);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');

  const parsed = CharacterFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  // Report paths and messages only; Zod messages here do not include the file's values.
  if (!parsed.success) throw new Error(`Invalid character file:\n${parsed.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);

  const summary = await upsertCharacter(new SupabaseCharacterStore(url, key), parsed.data, new Date().toISOString().slice(0, 10));
  console.log(`Upserted ${summary.slug} (${summary.characterId}): ${summary.inserted} inserted, ${summary.superseded} superseded, ${summary.unchanged} unchanged`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
