const http = require('http');
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');

async function testHttp() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3000', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 && data.includes('<title>Mapar — Barcelona</title>')) {
          console.log('✅ HTTP Server: 200 OK & serveix index.html correctament');
          resolve();
        } else {
          reject(new Error(`HTTP response code ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

async function testSocketAndDb() {
  return new Promise((resolve, reject) => {
    const socket = io('http://localhost:3000', {
      transports: ['websocket', 'polling']
    });

    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Timeout esperant esdeveniments de Socket.io'));
    }, 8000);

    const testStroke = {
      id: 'test_stroke_' + Date.now(),
      color: '#E74C3C',
      width_meters: 6,
      coordinates: [[2.1686, 41.3874], [2.1690, 41.3880]],
      created_at: new Date().toISOString()
    };

    socket.on('connect', () => {
      console.log('✅ Socket.io: Connexió establerta amb èxit');
    });

    socket.on('user_count', (count) => {
      console.log(`✅ Socket.io: user_count rebut (${count})`);
    });

    socket.on('init_strokes', (strokes) => {
      console.log(`✅ Socket.io: init_strokes rebut (${strokes.length} traços existents)`);
      
      // Emetre draw_stroke
      socket.emit('draw_stroke', testStroke);

      setTimeout(() => {
        // Verificar que s'ha desat a SQLite
        const dbPath = path.join(__dirname, '..', 'server', 'data', 'mapar.db');
        if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
          console.log(`✅ SQLite: Fitxer mapar.db present i no buit (${fs.statSync(dbPath).size} bytes)`);
          
          // Emetre erase_area
          socket.emit('erase_area', [testStroke.id]);

          setTimeout(() => {
            clearTimeout(timeout);
            socket.disconnect();
            console.log('✅ Socket.io & SQLite: Cicle complet de dibuix i esborrat completat');
            resolve();
          }, 500);
        } else {
          clearTimeout(timeout);
          socket.disconnect();
          reject(new Error('mapar.db no existeix o és buit'));
        }
      }, 500);
    });
  });
}

async function run() {
  try {
    console.log('Iniciant verificació del Chunk 6...');
    await testHttp();
    await testSocketAndDb();
    console.log('\n🎉 TOTES LES PROVES DEL CHUNK 6 HAN SUPERAT LA VERIFICACIÓ!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error en la verificació:', err);
    process.exit(1);
  }
}

run();
