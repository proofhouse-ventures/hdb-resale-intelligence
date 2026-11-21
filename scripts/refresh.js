'use strict';
// Refresh: re-download the five segment CSVs from data.gov.sg (public v1
// poll-download API, no sign-in / no API key), re-ingest, report delta.
// The 2017-onwards segment updates daily on data.gov.sg; the historical
// segments are effectively static. Run manually or from a scheduled job.
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FILES = {
  d_ebc5ab87086db484f88045b47411ebc5: 'seg_d__d_ebc5ab87086db484f88045b47411ebc5.csv',
  d_43f493c6c50d54243cc1eab0df142d6a: 'seg_b__d_43f493c6c50d54243cc1eab0df142d6a.csv',
  d_2d5ff9ea31397b66239f245f57751537: 'seg_mar2012_dec2014__d_2d5ff9ea31397b66239f245f57751537.csv',
  d_ea9ed51da2787afaf8e51f827c304208: 'seg_2015_2016__d_ea9ed51da2787afaf8e51f827c304208.csv',
  d_8b84c4ee58e3cfc0ece0d773c8ca6abc: 'seg_2017_onwards__d_8b84c4ee58e3cfc0ece0d773c8ca6abc.csv',
};
function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) return download(res.headers.location, dest).then(resolve, reject);
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', () => ws.close(resolve));
      ws.on('error', reject);
    }).on('error', reject);
  });
}
(async () => {
  const rawDir = path.join(__dirname, '..', '..', 'data', 'raw', 'hdb');
  fs.mkdirSync(rawDir, { recursive: true });
  for (const [id, file] of Object.entries(FILES)) {
    const d = await getJson(`https://api-open.data.gov.sg/v1/public/api/datasets/${id}/poll-download`);
    if (!d.data || !d.data.url) throw new Error(`poll-download failed for ${id}: ${JSON.stringify(d).slice(0, 200)}`);
    await download(d.data.url, path.join(rawDir, file));
    console.log(`downloaded ${file}`);
  }
  execFileSync('node', [path.join(__dirname, 'ingest.js'), rawDir], { stdio: 'inherit' });
})().catch((e) => { console.error(e); process.exit(1); });
