// The Gym CRM regression suite: every documented module, cases derived with named test-design
// techniques, each traced to a requirement in the Gym CRM docs.
import { ACCESS } from './access.ts';
import { CONTRACTS } from './contracts.ts';
import type { Module, SuiteCase } from './helpers.ts';
import { LEADS } from './leads.ts';
import { OPERATIONS } from './operations.ts';
import { SCHEDULE } from './schedule.ts';

export { TECHNIQUES, type Design, type Module, type SuiteCase, type Technique } from './helpers.ts';

export const SUITE_NAME = 'Gym CRM full regression';
export const MODULES: Module[] = [ACCESS, LEADS, CONTRACTS, SCHEDULE, OPERATIONS];
export const CASES: Array<SuiteCase & { module: string }> = MODULES.flatMap((m) =>
  m.cases.map((c) => ({ ...c, module: m.name })),
);

const ids = CASES.map((c) => c.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupes.length > 0) throw new Error(`duplicate case ids: ${dupes.join(', ')}`);
