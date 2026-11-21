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
  const gzPath = path.join(__dirname, '..', 'data', 'resales.json.gz');
  console.log('DIAG gz_bytes=' + fs.statSync(gzPath).size);
  const snapshot = JSON.parse(zlib.gunzipSync(fs.readFileSync(gzPath)).toString('utf8'));
  const all = snapshot.rows;
  console.log('DIAG parsed_rows=' + all.length);
  const filtered = filterResales(all, input);
  console.log('DIAG filtered_rows=' + filtered.length);
  const limit = Number.isInteger(input.limit) && input.limit > 0 ? input.limit : filtered.length;
  const outRows = filtered.slice(0, limit);
  if (mode === 'rows' || mode === 'both') {
    // Push in batches: a single pushData call with the full archive
    // (~990k items) truncates/fails on platform (observed 2026-11-21:
    // runs stopped at ~4,24x items). 1,000-item batches are proven safe.
    const BATCH = 1000;
    for (let i = 0; i < outRows.length; i += BATCH) {
      await rt.pushData(outRows.slice(i, i + BATCH));
      if ((i / BATCH) % 100 === 0) console.log('DIAG pushed_up_to=' + Math.min(i + BATCH, outRows.length));
    }
    console.log('DIAG push_loop_complete total=' + outRows.length);
    if (rt.onPlatform) {
      // Platform write-landing wait: pushData calls return before the
      // dataset service has stored every item (observed 2026-11-21: a run
      // that pushed 989,625 items retained only ~4,240 when the process
      // exited seconds later). Poll the real dataset count and do not
      // exit until every pushed item has landed; fail loudly otherwise.
      const { Actor } = require('apify');
      const ds = await Actor.openDataset();
      const deadlinePolls = 360; // 360 x 5s = 30 min, inside the 3600s timeout
      let landed = 0;
      for (let p = 0; p < deadlinePolls; p++) {
        const info = await ds.getInfo();
        landed = info ? info.itemCount : 0;
        console.log('DIAG dataset_items=' + landed + ' target=' + outRows.length);
        if (landed >= outRows.length) break;
        await new Promise((r) => setTimeout(r, 5000));
      }
      if (landed < outRows.length) {
        throw new Error('Dataset write-landing incomplete: ' + landed + ' of ' + outRows.length + ' items stored');
      }
      console.log('DIAG dataset_write_landing_complete items=' + landed);
    }
  }
  let analytics = null;
  if (mode === 'analytics' || mode === 'both') {
    analytics = computeAnalytics(filtered);
    console.log('DIAG analytics_rows_analysed=' + analytics.rows_analysed);
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
