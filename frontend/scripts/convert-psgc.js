/**
 * convert-psgc.js — one-time converter for the bundled PSGC address data.
 *
 * Source: @jobuntux/psgc (devDependency) — raw JSON of the official PSA
 * "Philippine Standard Geographic Code (PSGC) 2Q 2025 Publication"
 * (Philippine Statistics Authority, released June 30, 2025).
 * Cite that publication + date in the manuscript.
 *
 * Output (committed, served statically so the picker works fully offline):
 *   public/psgc/provinces.json            — all province-level entries, eager-loaded
 *   public/psgc/cities/{provCode}.json    — cities/municipalities per province
 *   public/psgc/barangays/{cityCode}.json — barangays per city (lazy-fetched;
 *                                           never bundle all 42k in one file)
 *
 * PSGC quirks handled:
 *   - NCR's 16 cities are province-level in raw PSGC → merged under a
 *     "Metro Manila" pseudo-province so NCR is selectable like anywhere else.
 *   - HUCs (e.g. City of Davao) are province-level in PSGC → kept as their own
 *     entries in the province dropdown, matching the official hierarchy.
 *   - City of Isabela (region-direct ICC) and the BARMM Special Geographic
 *     Area municipalities (provCode 999) have no province row → pseudo-provinces.
 *   - Names in the publication carry stray trailing spaces → trimmed.
 *
 * Run from frontend/:  node scripts/convert-psgc.js
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here    = dirname(fileURLToPath(import.meta.url));
const DATA    = join(here, '../node_modules/@jobuntux/psgc/data/2025-2Q');
const OUT     = join(here, '../public/psgc');

const read = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const byName = (a, b) => a.name.localeCompare(b.name, 'en');

const provinces = read('provinces.json');
const muncities = read('muncities.json');
const barangays = read('barangays.json');

// ── Build the province list ──────────────────────────────────────────────────
const NCR_CODE = '1300000000'; // pseudo-province for NCR's province-level cities
const SGA_CODE = '1999900000'; // BARMM Special Geographic Area (provCode 999)
const ISABELA_CODE = '0990100000'; // City of Isabela — ICC directly under Region IX

const provinceOut = [
  { code: NCR_CODE,     name: 'Metro Manila' },
  { code: SGA_CODE,     name: 'Special Geographic Area (BARMM)' },
  { code: ISABELA_CODE, name: 'City of Isabela (Basilan)' },
];
// key "regCode|provCode" → output province code
const provinceKey = new Map();

for (const p of provinces) {
  if (p.regCode === '13') {
    // NCR city-as-province → folded into Metro Manila
    provinceKey.set(`${p.regCode}|${p.provCode}`, NCR_CODE);
  } else {
    provinceKey.set(`${p.regCode}|${p.provCode}`, p.psgcCode);
    provinceOut.push({ code: p.psgcCode, name: p.provName.trim() });
  }
}
provinceKey.set('19|999', SGA_CODE);
provinceKey.set('09|901', ISABELA_CODE);

// ── Group cities/municipalities per province ─────────────────────────────────
const citiesByProvince = new Map(); // provCode → [{code, name}]
const orphans = [];
for (const m of muncities) {
  // Pateros (NCR's lone municipality) has no province-level row — any NCR
  // muncity belongs to the Metro Manila pseudo-province.
  const prov = m.regCode === '13' ? NCR_CODE : provinceKey.get(`${m.regCode}|${m.provCode}`);
  if (!prov) { orphans.push(m); continue; }
  if (!citiesByProvince.has(prov)) citiesByProvince.set(prov, []);
  citiesByProvince.get(prov).push({ code: m.psgcCode, name: m.munCityName.trim() });
}
if (orphans.length) {
  console.error('Unmapped cities/municipalities:', orphans);
  process.exit(1);
}

// ── Group barangays per city ─────────────────────────────────────────────────
const cityKey = new Map(muncities.map((m) => [`${m.regCode}|${m.munCityCode}`, m.psgcCode]));
const barangaysByCity = new Map(); // city psgcCode → [{code, name}]
for (const b of barangays) {
  const city = cityKey.get(`${b.regCode}|${b.munCityCode}`);
  if (!city) { console.error('Unmapped barangay:', b); process.exit(1); }
  if (!barangaysByCity.has(city)) barangaysByCity.set(city, []);
  barangaysByCity.get(city).push({ code: b.psgcCode, name: b.brgyName.trim() });
}

// ── Write output ─────────────────────────────────────────────────────────────
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'cities'),    { recursive: true });
mkdirSync(join(OUT, 'barangays'), { recursive: true });

provinceOut.sort(byName);
writeFileSync(join(OUT, 'provinces.json'), JSON.stringify(provinceOut));

let cityTotal = 0;
for (const [prov, cities] of citiesByProvince) {
  cities.sort(byName);
  cityTotal += cities.length;
  writeFileSync(join(OUT, 'cities', `${prov}.json`), JSON.stringify(cities));
}

let brgyTotal = 0;
for (const [city, list] of barangaysByCity) {
  list.sort(byName);
  brgyTotal += list.length;
  writeFileSync(join(OUT, 'barangays', `${city}.json`), JSON.stringify(list));
}

console.log(`PSGC 2Q-2025 → public/psgc/`);
console.log(`  provinces: ${provinceOut.length}`);
console.log(`  cities/municipalities: ${cityTotal} across ${citiesByProvince.size} province files`);
console.log(`  barangays: ${brgyTotal} across ${barangaysByCity.size} city files`);
