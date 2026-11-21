'use strict';
// B6 — HDB Resale Intelligence Actor (dataset-only v1).
// Runs on Apify (uses the `apify` SDK if present) or standalone for local
// testing (no account needed): `node src/main.js` reads input from
// ./input.json or APIFY_INPUT env, writes ./output.json.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { filterResales, computeAnalytics } = require('./lib');

async function getRuntime() {
  try {
    const { Actor } = require('apify');
    await Actor.init();
    return {
      getInput: () => Actor.getInput(),
      pushData: (items) => Actor.pushData(items),
      setValue: (k, v) => Actor.setValue(k, v),
      exit: () => Actor.exit(),
      onPlatform: true,
    };
  } catch (e) {
    return {
      getInput: async () => {
        if (process.env.APIFY_INPUT) return JSON.parse(process.env.APIFY_INPUT);
        const p = path.join(process.cwd(), 'input.json');
        return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
      },
      pushData: async (items) => { module.exports._localDataset = (module.exports._localDataset || []).concat(items); },
      setValue: async (k, v) => { module.exports._localKV = module.exports._localKV || {}; module.exports._localKV[k] = v; },
      exit: async () => {},
      onPlatform: false,
    };
  }
}

async function main() {
  const rt = await getRuntime();
  const input = (await rt.getInput()) || {};
  const mode = input.mode || 'both'; // rows | analytics | both
  const snapshot = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, '..', 'data', 'resales.json.gz'))).toString('utf8'));
  const all = snapshot.rows;
  const filtered = filterResales(all, input);
  const limit = Number.isInteger(input.limit) && input.limit > 0 ? input.limit : filtered.length;
  const outRows = filtered.slice(0, limit);
  if (mode === 'rows' || mode === 'both') {
    // Push in batches: a single pushData call with the full archive
    // (~990k items) truncates/fails on platform (observed 2026-11-21:
    // runs stopped at ~4,24x items). 1,000-item batches are proven safe.
    const BATCH = 1000;
    for (let i = 0; i < outRows.length; i += BATCH) {
      await rt.pushData(outRows.slice(i, i + BATCH));
    }
  }
  let analytics = null;
  if (mode === 'analytics' || mode === 'both') {
    analytics = computeAnalytics(filtered);
    analytics.meta = snapshot.meta;
    await rt.setValue('ANALYTICS', analytics);
  }
  if (!rt.onPlatform) {
    fs.writeFileSync(path.join(process.cwd(), 'output.json'), JSON.stringify({ dataset: module.exports._localDataset || [], kv: module.exports._localKV || {} }, null, 2));
    console.log(`standalone run: ${outRows.length} rows pushed, analytics=${analytics ? 'yes' : 'no'}, filtered=${filtered.length}/${all.length}`);
  }
  await rt.exit();
  return { outRows, analytics, filteredCount: filtered.length };
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { main };
