/**
 * server/index.js — Backend autònom de Mapar
 * 
 * Express + Socket.io + sql.js (SQLite WASM)
 * Sense login, sense configuració externa.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

// ============================================
// Configuration
// ============================================

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'mapar.db');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ============================================
// Express + Socket.io Setup
// ============================================

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
});

// Serve static files
app.use(express.static(PUBLIC_DIR));

// ============================================
// SQLite Database (sql.js — pure WASM, no native)
// ============================================

let db = null;

async function initDatabase() {
  const SQL = await initSqlJs();
  
  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    console.log('📂 Base de dades carregada des de', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('🆕 Nova base de dades creada');
  }
  
  // Create table if not exists
  db.run(`
    CREATE TABLE IF NOT EXISTS strokes (
      id TEXT PRIMARY KEY,
      color TEXT NOT NULL,
      width_meters REAL NOT NULL,
      coordinates TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  
  // Persist schema to disk immediately
  saveDatabase();

  // Save periodically
  setInterval(saveDatabase, 30000); // every 30s
  
  console.log('💾 Base de dades SQLite inicialitzada');
}

function saveDatabase() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (e) {
    console.error('⚠️ Error desant la base de dades:', e.message);
  }
}

// ============================================
// Database Operations
// ============================================

function getAllStrokes() {
  if (!db) return [];
  try {
    const results = db.exec('SELECT id, color, width_meters, coordinates, created_at FROM strokes ORDER BY created_at ASC');
    if (results.length === 0) return [];
    
    return results[0].values.map(row => ({
      id: row[0],
      color: row[1],
      width_meters: row[2],
      coordinates: JSON.parse(row[3]),
      created_at: row[4]
    }));
  } catch (e) {
    console.error('⚠️ Error llegint strokes:', e.message);
    return [];
  }
}

function insertStroke(stroke) {
  if (!db) return;
  try {
    db.run(
      'INSERT OR REPLACE INTO strokes (id, color, width_meters, coordinates, created_at) VALUES (?, ?, ?, ?, ?)',
      [stroke.id, stroke.color, stroke.width_meters, JSON.stringify(stroke.coordinates), stroke.created_at]
    );
    saveDatabase();
  } catch (e) {
    console.error('⚠️ Error inserint stroke:', e.message);
  }
}

function deleteStrokes(ids) {
  if (!db || !ids.length) return;
  try {
    const placeholders = ids.map(() => '?').join(',');
    db.run(`DELETE FROM strokes WHERE id IN (${placeholders})`, ids);
    saveDatabase();
  } catch (e) {
    console.error('⚠️ Error esborrant strokes:', e.message);
  }
}

// ============================================
// Socket.io Events
// ============================================

let userCount = 0;

io.on('connection', (socket) => {
  userCount++;
  console.log(`👤 Usuari connectat (${userCount} total)`);
  
  // Send current strokes to new user
  const strokes = getAllStrokes();
  socket.emit('init_strokes', strokes);
  
  // Broadcast user count
  io.emit('user_count', userCount);
  
  // Handle new stroke
  socket.on('draw_stroke', (stroke) => {
    if (!stroke || !stroke.id || !stroke.coordinates) return;
    insertStroke(stroke);
    socket.broadcast.emit('draw_stroke', stroke);
  });
  
  // Handle erase
  socket.on('erase_area', (strokeIds) => {
    if (!Array.isArray(strokeIds)) return;
    deleteStrokes(strokeIds);
    socket.broadcast.emit('erase_area', strokeIds);
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    userCount--;
    console.log(`👤 Usuari desconnectat (${userCount} total)`);
    io.emit('user_count', userCount);
  });
});

// ============================================
// Graceful Shutdown
// ============================================

function shutdown() {
  console.log('\n🛑 Aturant servidor...');
  saveDatabase();
  if (db) db.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ============================================
// Start
// ============================================

async function start() {
  await initDatabase();
  
  server.listen(PORT, () => {
    console.log(`\n🚀 Mapar servidor actiu!`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   Network: http://0.0.0.0:${PORT}`);
    console.log(`\n   Ctrl+C per aturar\n`);
  });
}

start().catch(err => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
