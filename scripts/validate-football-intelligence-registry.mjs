import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const path = resolve('docs/nfl-football-intelligence-factor-registry.json');
const raw = await readFile(path, 'utf8');
const registry = JSON.parse(raw);

const VALID_STATUSES = new Set([
  'ACTIVE_RESEARCH',
  'READY_FOR_SHADOW',
  'SHADOW_ONLY',
  'PRODUCTION_ELIGIBLE',
  'REJECTED',
  'POSTGAME_ONLY',
  'UNAVAILABLE',
]);

const VALID_STABILITIES = new Set(['fast', 'medium', 'slow']);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(registry && typeof registry === 'object', 'Registry must be an object.');
assert(registry.version, 'Registry version is required.');
assert(registry.status === 'research_only', 'Registry must remain research_only.');
assert(registry.productionInfluenceDefault === 0, 'Default production influence must remain 0.');
assert(Array.isArray(registry.categories), 'categories must be an array.');
assert(Array.isArray(registry.factors), 'factors must be an array.');
assert(
  registry.factors.length >= 100,
  'Expected at least 100 factors; found ' + registry.factors.length + '.',
);

const categorySet = new Set(registry.categories);
const ids = new Set();

for (const factor of registry.factors) {
  assert(factor && typeof factor === 'object', 'Every factor must be an object.');
  assert(typeof factor.id === 'string' && factor.id.length > 0, 'Factor id is required.');
  assert(!ids.has(factor.id), 'Duplicate factor id: ' + factor.id);
  ids.add(factor.id);

  assert(categorySet.has(factor.category), 'Unknown category for ' + factor.id + ': ' + factor.category);
  assert(typeof factor.name === 'string' && factor.name.length > 0, 'Missing name: ' + factor.id);
  assert(typeof factor.meaning === 'string' && factor.meaning.length > 0, 'Missing meaning: ' + factor.id);
  assert(
    typeof factor.sourcePriority === 'string' && factor.sourcePriority.length > 0,
    'Missing source priority: ' + factor.id,
  );
  assert(VALID_STABILITIES.has(factor.stability), 'Invalid stability for ' + factor.id + ': ' + factor.stability);
  assert(typeof factor.mechanism === 'string' && factor.mechanism.length > 0, 'Missing mechanism: ' + factor.id);
  assert(VALID_STATUSES.has(factor.status), 'Invalid status for ' + factor.id + ': ' + factor.status);
  assert(factor.productionInfluence === 0, 'Non-zero production influence: ' + factor.id);
  assert(factor.pregameAllowed === true, 'Pregame flag missing/false: ' + factor.id);
  assert(typeof factor.postgameOnly === 'boolean', 'postgameOnly missing: ' + factor.id);
  assert(factor.requiresTimestamp === true, 'Timestamp requirement missing: ' + factor.id);
  assert(factor.requiresProvenance === true, 'Provenance requirement missing: ' + factor.id);

  if (factor.postgameOnly) {
    assert(
      factor.status === 'POSTGAME_ONLY',
      'Postgame-only factor must use POSTGAME_ONLY status: ' + factor.id,
    );
  }
}

console.log(
  [
    'NFL football intelligence factor registry validation passed.',
    'Version: ' + registry.version,
    'Categories: ' + registry.categories.length,
    'Factors: ' + registry.factors.length,
    'Production influence: 0',
  ].join('\n'),
);
