/**
 * Optimitza el GeoJSON existent: redueix precisió, elimina propietats,
 * simplifica polígons i redueix la mida del fitxer per a web.
 */
const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');

const INPUT = path.join(__dirname, '..', 'public', 'data', 'barcelona-geometric.geojson');
const OUTPUT = INPUT; // sobreescriu

console.log('📂 Llegint GeoJSON...');
const raw = fs.readFileSync(INPUT, 'utf-8');
const geojson = JSON.parse(raw);
console.log(`  Features originals: ${geojson.features.length}`);
console.log(`  Mida original: ${(Buffer.byteLength(raw) / 1048576).toFixed(2)} MB`);

// 1. Simplificar geometries
console.log('🔧 Simplificant geometries...');
const simplified = geojson.features.map(f => {
  try {
    const s = turf.simplify(f, { tolerance: 0.0001, highQuality: true });
    s.properties = {};
    return s;
  } catch (e) {
    f.properties = {};
    return f;
  }
}).filter(f => {
  try {
    const area = turf.area(f);
    return area > 10; // filtrar micro-polígons
  } catch (e) {
    return false;
  }
});

console.log(`  Features després de simplificar i filtrar: ${simplified.length}`);

// 2. Truncar coordenades
const result = turf.featureCollection(simplified);
const truncated = turf.truncate(result, { precision: 6, coordinates: 2 });

// 3. Desar
const jsonStr = JSON.stringify(truncated);
fs.writeFileSync(OUTPUT, jsonStr, 'utf-8');
console.log(`✅ Optimitzat!`);
console.log(`  Mida final: ${(Buffer.byteLength(jsonStr) / 1048576).toFixed(2)} MB`);
console.log(`  Features: ${truncated.features.length}`);
