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
    const BATCH = 1000;
    if (rt.onPlatform) {
      // Direct public-API pushes (bypass experiment, 2026-11-21): the SDK
      // pushData path silently loses ~99.6% of items past ~4,24x on this
      // platform (three instrumented runs). Push chunks straight to
      // api.apify.com with per-chunk HTTP status, then verify the stored
      // count and fail loudly on any mismatch.
      const token = process.env.APIFY_TOKEN;
      const datasetId = process.env.APIFY_DEFAULT_DATASET_ID;
      if (!token || !datasetId) throw new Error('Missing APIFY_TOKEN or APIFY_DEFAULT_DATASET_ID in run env');
      for (let i = 0; i < outRows.length; i += BATCH) {
        const chunk = outRows.slice(i, i + BATCH);
        const res = await fetch('https://api.apify.com/v2/datasets/' + datasetId + '/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify(chunk),
        });
        if (!res.ok) throw new Error('Direct push failed at item ' + i + ': HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
        if ((i / BATCH) % 100 === 0) console.log('DIAG pushed_up_to=' + Math.min(i + BATCH, outRows.length));
        await new Promise((r) => setTimeout(r, 100));
      }
      console.log('DIAG push_loop_complete total=' + outRows.length);
      let landed = 0;
      for (let p = 0; p < 24; p++) {
        const infoRes = await fetch('https://api.apify.com/v2/datasets/' + datasetId, { headers: { Authorization: 'Bearer ' + token } });
        const info = await infoRes.json();
        landed = info && info.data ? info.data.itemCount : 0;
        console.log('DIAG dataset_items=' + landed + ' target=' + outRows.length);
        if (landed >= outRows.length) break;
        await new Promise((r) => setTimeout(r, 5000));
      }
      if (landed < outRows.length) {
        throw new Error('Dataset write incomplete after direct pushes: ' + landed + ' of ' + outRows.length + ' items stored');
      }
      console.log('DIAG dataset_write_landing_complete items=' + landed);
    } else {
      for (let i = 0; i < outRows.length; i += BATCH) {
        await rt.pushData(outRows.slice(i, i + BATCH));
        if ((i / BATCH) % 100 === 0) console.log('DIAG pushed_up_to=' + Math.min(i + BATCH, outRows.length));
      }
      console.log('DIAG push_loop_complete total=' + outRows.length);
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
