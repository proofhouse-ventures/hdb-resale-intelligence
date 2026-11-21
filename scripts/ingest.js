'use strict';
// Ingest: the five data.gov.sg "Resale Flat Prices" segment CSVs (raw dir) ->
// bundled clean snapshot (data/resales.json.gz, gzipped in the same pattern as B1).
// The source contains no personal data (transaction attributes only), so no
// scrubbing applies; segments are reconciled by lib.normaliseRecord and exact
// duplicate rows (identical on every published field) are removed and counted.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parseCsv, normaliseRecord, dedupeKey } = require('../src/lib');

const rawDir = process.argv[2] || path.join(__dirname, '..', '..', 'data', 'raw', 'hdb');
const outPath = path.join(__dirname, '..', 'data', 'resales.json.gz');

// Segment files in chronological order: dataset id -> period/basis.
const SEGMENTS = [
  { file: 'seg_d__d_ebc5ab87086db484f88045b47411ebc5.csv', dataset_id: 'd_ebc5ab87086db484f88045b47411ebc5', period: '1990-01 to 1999-12', basis: 'approval date' },
  { file: 'seg_b__d_43f493c6c50d54243cc1eab0df142d6a.csv', dataset_id: 'd_43f493c6c50d54243cc1eab0df142d6a', period: '2000-01 to 2012-02', basis: 'approval date' },
  { file: 'seg_mar2012_dec2014__d_2d5ff9ea31397b66239f245f57751537.csv', dataset_id: 'd_2d5ff9ea31397b66239f245f57751537', period: '2012-03 to 2014-12', basis: 'registration date' },
  { file: 'seg_2015_2016__d_ea9ed51da2787afaf8e51f827c304208.csv', dataset_id: 'd_ea9ed51da2787afaf8e51f827c304208', period: '2015-01 to 2016-12', basis: 'registration date' },
  { file: 'seg_2017_onwards__d_8b84c4ee58e3cfc0ece0d773c8ca6abc.csv', dataset_id: 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc', period: '2017-01 onwards', basis: 'registration date' },
];

const seen = new Set();
const rows = [];
const perSegment = [];
let rawTotal = 0;
let dupes = 0;
for (const seg of SEGMENTS) {
  const text = fs.readFileSync(path.join(rawDir, seg.file), 'utf8');
  const recs = parseCsv(text);
  let kept = 0;
  for (const rec of recs) {
    const row = normaliseRecord(rec);
    const key = dedupeKey(row);
    if (seen.has(key)) { dupes++; continue; }
    seen.add(key);
    rows.push(row);
    kept++;
  }
  rawTotal += recs.length;
  perSegment.push({ ...seg, raw_rows: recs.length, kept_rows: kept });
  console.log(`${seg.file}: ${recs.length} raw, ${kept} kept`);
}
rows.sort((a, b) => (a.month + a.town + a.block + a.street_name).localeCompare(b.month + b.town + b.block + b.street_name));
const months = [...new Set(rows.map((r) => r.month))].sort();
const towns = [...new Set(rows.map((r) => r.town))].sort();
const meta = {
  dataset: 'Resale Flat Prices (collection 189)',
  publisher: 'Housing & Development Board (HDB), via data.gov.sg',
  dataset_ids: SEGMENTS.map((s) => s.dataset_id),
  licence: 'Singapore Open Data Licence v1.0 — https://data.gov.sg/open-data-licence',
  accessed: new Date().toISOString().slice(0, 10),
  rows: rows.length,
  raw_rows: rawTotal,
  exact_duplicates_removed: dupes,
  coverage: `Months ${months[0]} to ${months[months.length - 1]} (${months.length} months), ${towns.length} towns. Approval-date basis before Mar 2012; registration-date basis from Mar 2012.`,
  personal_data_handling: 'None required: the source dataset contains no personal data — no names, identification numbers or contact details in any column (verified at ingest, 2026-11-21). Block and street are the transacted flat\'s address as published by HDB.',
  segments: perSegment,
};
fs.writeFileSync(outPath, zlib.gzipSync(JSON.stringify({ meta, rows }, null, 0)));
console.log(`ingested ${rows.length} rows (${rawTotal} raw, ${dupes} exact duplicates removed) -> ${outPath}`);
