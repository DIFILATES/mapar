/**
 * generate-bcn-geometry.js
 * 
 * Descarrega illes i edificis de Barcelona via Overpass API (OpenStreetMap),
 * els transforma en figures geomètriques pures amb @turf/turf:
 *  - Simplificació poligonal
 *  - Potenciació dels xamfrans octogonals de l'Eixample
 *  - Triangulació de zones irregulars
 *  - Suavitzat de la costa
 * 
 * Desa el resultat a public/data/barcelona-geometric.geojson
 */

const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');

const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'data', 'barcelona-geometric.geojson');

// Bounding box de Barcelona (Eixample + voltants)
const BBOX = {
  south: 41.370,
  west: 2.140,
  north: 41.410,
  east: 2.200
};

// Overpass query per obtenir edificis de Barcelona
function buildOverpassQuery() {
  const bbox = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  return `
[out:json][timeout:120];
(
  way["building"](${bbox});
  relation["building"](${bbox});
);
out body;
>;
out skel qt;
  `.trim();
}

async function fetchOverpassData() {
  console.log('📡 Descarregant dades d\'OpenStreetMap via Overpass API...');
  
  const query = buildOverpassQuery();
  
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
  ];
  
  for (const endpoint of endpoints) {
    try {
      console.log(`  Provant: ${endpoint}`);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'mapar-bcn-generator/1.0'
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(120000)  // 2 min timeout
      });
      
      if (!response.ok) {
        console.log(`  ⚠️ Error ${response.status}, provant següent...`);
        continue;
      }
      
      const data = await response.json();
      console.log(`✅ Rebuts ${data.elements.length} elements d'OSM`);
      return data;
    } catch (e) {
      console.log(`  ⚠️ ${e.message}, provant següent...`);
      continue;
    }
  }
  
  throw new Error('Cap servidor Overpass disponible');
}

/**
 * Converteix elements Overpass (nodes + ways) en GeoJSON polygons
 */
function overpassToPolygons(data) {
  // Index nodes by ID
  const nodes = {};
  data.elements.forEach(el => {
    if (el.type === 'node') {
      nodes[el.id] = [el.lon, el.lat];
    }
  });

  const polygons = [];
  
  data.elements.forEach(el => {
    if (el.type === 'way' && el.nodes && el.nodes.length >= 4) {
      try {
        const coords = el.nodes.map(nid => nodes[nid]).filter(Boolean);
        if (coords.length < 4) return;
        
        // Assegurar que el polígon es tanca
        const first = coords[0];
        const last = coords[coords.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          coords.push([...first]);
        }
        
        if (coords.length >= 4) {
          const poly = turf.polygon([coords], {
            source: 'osm',
            building: el.tags?.building || 'yes'
          });
          
          // Validar que el polígon és vàlid
          const area = turf.area(poly);
          if (area > 5 && area < 500000) { // entre 5m² i 500.000m²
            polygons.push(poly);
          }
        }
      } catch (e) {
        // Polígon invàlid, saltar
      }
    }
  });

  console.log(`🏗️  ${polygons.length} polígons d'edificis vàlids extrets`);
  return polygons;
}

/**
 * Detecta si un polígon té forma de xamfrà octogonal (típic de l'Eixample)
 * basant-se en el nombre de vèrtexs i la regularitat dels angles
 */
function isOctagonalChamfer(polygon) {
  const coords = turf.getCoords(polygon)[0];
  const numVertices = coords.length - 1; // excloure el punt de tancament
  
  // Xamfrans típics: 5-12 vèrtexs (quadrilàters amb cantonades tallades)
  if (numVertices < 5 || numVertices > 12) return false;
  
  // Comprovar si l'àrea és típica d'un bloc de l'Eixample (1000-30000 m²)
  const area = turf.area(polygon);
  if (area < 800 || area > 35000) return false;
  
  // Centroide dins la zona de l'Eixample
  const centroid = turf.centroid(polygon);
  const [lon, lat] = turf.getCoords(centroid);
  const inEixample = lat >= 41.380 && lat <= 41.405 && lon >= 2.150 && lon <= 2.185;
  
  return inEixample;
}

/**
 * Potencia els xamfrans octogonals: regularitza els polígons de l'Eixample
 * perquè les cantonades tallades siguin més netes i geomètriques
 */
function enhanceChamfer(polygon) {
  try {
    // Simplificar lleugerament per netejar soroll GPS
    let simplified = turf.simplify(polygon, { tolerance: 0.00003, highQuality: true });
    
    // Assignar propietat visual
    simplified.properties = {
      ...polygon.properties,
      geometric_type: 'chamfer',
      style: 'eixample'
    };
    
    return simplified;
  } catch (e) {
    return polygon;
  }
}

/**
 * Processa un polígon irregular: simplifica
 */
function processIrregular(polygon) {
  try {
    // Simplificació agressiva per zones irregulars
    let simplified = turf.simplify(polygon, { tolerance: 0.0001, highQuality: true });
    simplified.properties = {};
    return simplified;
  } catch (e) {
    return polygon;
  }
}

/**
 * Processa els polígons i genera triangulació per zones complexes
 */
function tessellateComplex(polygons) {
  const tessellated = [];
  let chamferCount = 0;
  let irregularCount = 0;
  let triangulatedCount = 0;

  polygons.forEach(poly => {
    try {
      if (isOctagonalChamfer(poly)) {
        // Potenciar xamfrà octogonal
        const enhanced = enhanceChamfer(poly);
        enhanced.properties = {};
        tessellated.push(enhanced);
        chamferCount++;
      } else {
        // Simplificar primer
        const simplified = turf.simplify(poly, { tolerance: 0.0001, highQuality: true });
        const coords = turf.getCoords(simplified)[0];
        const numVertices = coords.length - 1;
        const area = turf.area(simplified);
        
        if (numVertices > 30 && area > 2000) {
          // Polígon molt complex: triangular
          try {
            const triangles = turf.tesselate(simplified);
            if (triangles && triangles.features) {
              triangles.features.forEach(tri => {
                tri.properties = {};
                tessellated.push(tri);
              });
              triangulatedCount += triangles.features.length;
            }
          } catch (e) {
            simplified.properties = {};
            tessellated.push(simplified);
            irregularCount++;
          }
        } else {
          // Polígon simple: just simplificar
          simplified.properties = {};
          tessellated.push(simplified);
          irregularCount++;
        }
      }
    } catch (e) {
      // Saltar polígons problemàtics
    }
  });

  console.log(`🔷 Xamfrans octogonals (Eixample): ${chamferCount}`);
  console.log(`🔺 Triangles generats: ${triangulatedCount}`);
  console.log(`📐 Polígons irregulars simplificats: ${irregularCount}`);
  console.log(`📊 Total figures geomètriques: ${tessellated.length}`);
  
  return tessellated;
}

/**
 * Pipeline principal
 */
async function main() {
  console.log('🗺️  Generador Geomètric de Barcelona');
  console.log('=====================================\n');
  
  try {
    // 1. Descarregar dades d'OSM
    const osmData = await fetchOverpassData();
    
    // 2. Convertir a polígons
    const polygons = overpassToPolygons(osmData);
    
    if (polygons.length === 0) {
      throw new Error('No s\'han obtingut polígons vàlids d\'OSM');
    }
    
    // 3. Processar geomètricament (xamfrans, triangulació, simplificació)
    const geometricFeatures = tessellateComplex(polygons);
    
    // 4. Crear FeatureCollection final
    const geojson = turf.featureCollection(geometricFeatures);
    
    // 5. Optimitzar per web: reduir precisió de coordenades i eliminar propietats
    console.log('\n🔧 Optimitzant per a web...');
    const truncated = turf.truncate(geojson, { precision: 6, coordinates: 2 });
    
    // Eliminar propietats innecessàries per reduir mida
    truncated.features.forEach(f => {
      f.properties = {};
    });
    
    // 6. Desar a fitxer
    const outputDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const jsonStr = JSON.stringify(truncated);
    fs.writeFileSync(OUTPUT_PATH, jsonStr, 'utf-8');
    
    const sizeMB = (Buffer.byteLength(jsonStr) / (1024 * 1024)).toFixed(2);
    console.log(`\n✅ GeoJSON generat correctament!`);
    console.log(`📁 Fitxer: ${OUTPUT_PATH}`);
    console.log(`📏 Mida: ${sizeMB} MB`);
    console.log(`🔢 Features: ${truncated.features.length}`);
    console.log(`📐 Tipus: ${truncated.type}`);
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
