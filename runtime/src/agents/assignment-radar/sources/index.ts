import { icAdapter } from './ic.js';
import { omegaAdapter } from './omega365.js';
import { konsAdapter } from './kons.js';
import { forteAdapter } from './fortehub.js';
import { emagineAdapter } from './emagine.js';
import { rightPeopleGroupAdapter } from './rightpeoplegroup.js';
import { spertonAdapter } from './sperton.js';
import { sevenNAdapter } from './sevenn.js';
import type { SourceAdapter } from './common.js';
export function adapters(): SourceAdapter[] { return [icAdapter, omegaAdapter, konsAdapter, forteAdapter, emagineAdapter, rightPeopleGroupAdapter, spertonAdapter, sevenNAdapter]; }
