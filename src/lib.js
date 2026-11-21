'use strict';
// B6 core logic — pure functions, no Apify dependency. Shared by main.js and tests.
// Scope: data.gov.sg "Resale Flat Prices" collection (HDB), Singapore Open Data Licence v1.0.
// The dataset carries NO personal data: columns are transaction attributes only
// (month, town, flat type, block, street, storey range, floor area, flat model,
// lease years, price). No names, no IDs, no contact details exist in the source.

// Parse one CSV line (HDB files are simple: no embedded commas inside quoted
// fields in practice, but handle RFC4180 quoting anyway).
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Parse a whole CSV file's text into raw record objects keyed by header.
// Segments differ: pre-2015 files have no remaining_lease column; the
// 2015-2016 file has remaining_lease as whole years ("70"); 2017-onwards
// has it as text ("61 years 04 months"). Missing column -> undefined here,
// normalised to null in normaliseRecord.
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = parseCsvLine(lines[0]).map((h) => h.trim().replace(/^﻿/, ''));
  return lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    const rec = {};
    header.forEach((h, i) => { rec[h] = vals[i] !== undefined ? vals[i].trim() : ''; });
    return rec;
  });
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Normalise one raw CSV record into the clean store shape.
// Raw fields: month, town, flat_type, block, street_name, storey_range,
// floor_area_sqm, flat_model, lease_commence_date, remaining_lease?, resale_price.
function normaliseRecord(r) {
  return {
    month: r.month, // YYYY-MM; approval-date basis before Mar 2012, registration-date basis from Mar 2012
    town: r.town,
    flat_type: r.flat_type,
    block: String(r.block),
    street_name: r.street_name,
    storey_range: r.storey_range,
    floor_area_sqm: toNumberOrNull(r.floor_area_sqm),
    flat_model: r.flat_model, // as published (casing varies by era, e.g. IMPROVED vs Improved)
    lease_commence_date: toNumberOrNull(r.lease_commence_date), // 4-digit year
    remaining_lease: r.remaining_lease ? String(r.remaining_lease) : null, // null before Jan 2015; whole years in 2015-2016; "NN years NN months" from 2017
    resale_price: toNumberOrNull(r.resale_price), // SGD
    source_dataset: 'Resale Flat Prices (data.gov.sg)',
  };
}

function dedupeKey(r) {
  return [r.month, r.town, r.flat_type, r.block, r.street_name, r.storey_range,
    r.floor_area_sqm, r.flat_model, r.lease_commence_date, r.remaining_lease, r.resale_price].join('|');
}

function filterResales(rows, input) {
  const town = input.town ? input.town.toLowerCase() : null;
  const flatType = input.flatType ? input.flatType.toLowerCase() : null;
  const flatModel = input.flatModel ? input.flatModel.toLowerCase() : null;
  return rows.filter((r) => {
    if (town && !r.town.toLowerCase().includes(town)) return false;
    if (flatType && !r.flat_type.toLowerCase().includes(flatType)) return false;
    if (flatModel && !r.flat_model.toLowerCase().includes(flatModel)) return false;
    if (input.floorAreaMin != null && (r.floor_area_sqm === null || r.floor_area_sqm < input.floorAreaMin)) return false;
    if (input.floorAreaMax != null && (r.floor_area_sqm === null || r.floor_area_sqm > input.floorAreaMax)) return false;
    if (input.priceMin != null && (r.resale_price === null || r.resale_price < input.priceMin)) return false;
    if (input.priceMax != null && (r.resale_price === null || r.resale_price > input.priceMax)) return false;
    if (input.monthFrom && r.month < input.monthFrom) return false;
    if (input.monthTo && r.month > input.monthTo) return false;
    if (input.leaseCommenceYearFrom != null && (r.lease_commence_date === null || r.lease_commence_date < input.leaseCommenceYearFrom)) return false;
    if (input.leaseCommenceYearTo != null && (r.lease_commence_date === null || r.lease_commence_date > input.leaseCommenceYearTo)) return false;
    return true;
  });
}

const round2 = (n) => Math.round(n * 100) / 100;

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : round2((s[mid - 1] + s[mid]) / 2);
}

function pricePerSqm(r) {
  return r.resale_price !== null && r.floor_area_sqm ? r.resale_price / r.floor_area_sqm : null;
}

function summariseGroup(rows) {
  const prices = rows.map((r) => r.resale_price).filter((v) => v !== null);
  const pps = rows.map(pricePerSqm).filter((v) => v !== null);
  return {
    transactions: rows.length,
    median_resale_price: median(prices),
    median_price_per_sqm: pps.length ? round2(median(pps)) : null,
  };
}

function computeAnalytics(rows) {
  const byTownMap = new Map();
  const byTownTypeMap = new Map();
  const byTypeMap = new Map();
  const byYear = {};
  const byMonth = {};
  for (const r of rows) {
    if (!byTownMap.has(r.town)) byTownMap.set(r.town, []);
    byTownMap.get(r.town).push(r);
    const ttKey = `${r.town} | ${r.flat_type}`;
    if (!byTownTypeMap.has(ttKey)) byTownTypeMap.set(ttKey, { town: r.town, flat_type: r.flat_type, rows: [] });
    byTownTypeMap.get(ttKey).rows.push(r);
    if (!byTypeMap.has(r.flat_type)) byTypeMap.set(r.flat_type, []);
    byTypeMap.get(r.flat_type).push(r);
    const y = r.month.slice(0, 4);
    byYear[y] = (byYear[y] || 0) + 1;
    byMonth[r.month] = (byMonth[r.month] || 0) + 1;
  }
  const byTown = [...byTownMap.entries()]
    .map(([town, rs]) => ({ town, ...summariseGroup(rs) }))
    .sort((a, b) => b.transactions - a.transactions);
  const byTownFlatType = [...byTownTypeMap.values()]
    .map((g) => ({ town: g.town, flat_type: g.flat_type, ...summariseGroup(g.rows) }))
    .sort((a, b) => (a.town + a.flat_type).localeCompare(b.town + b.flat_type));
  const byFlatType = [...byTypeMap.entries()]
    .map(([flat_type, rs]) => ({ flat_type, ...summariseGroup(rs) }))
    .sort((a, b) => b.transactions - a.transactions);
  return {
    rows_analysed: rows.length,
    overall: summariseGroup(rows),
    by_town: byTown,
    by_flat_type: byFlatType,
    by_town_flat_type: byTownFlatType,
    volume_by_year: byYear,
    volume_by_month: byMonth,
    coverage: 'All HDB resale transactions in the source collection, months 1990-01 to 2026-11. Basis: approval date before Mar 2012, registration date from Mar 2012. remaining_lease is published only from Jan 2015 (whole years in 2015-2016; "NN years NN months" from Jan 2017). Exact duplicate rows as published were removed at ingest (1,929 rows); see README.',
  };
}

module.exports = { parseCsv, parseCsvLine, normaliseRecord, dedupeKey, filterResales, computeAnalytics, median, pricePerSqm };
