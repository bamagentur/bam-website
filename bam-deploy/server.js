'use strict';

// Load .env (local dev only — on Render use Environment Variables)
try { require('dotenv').config(); } catch (_) {}

const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcrypt');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Absolute paths (works on any OS, any working directory) ───────────────
const ROOT        = __dirname;
const DATA_DIR    = path.join(ROOT, 'data');
const CONTENT_F   = path.join(DATA_DIR, 'content.json');
const USERS_F     = path.join(DATA_DIR, 'users.json');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const UPLOADS_DIR = path.join(ROOT, 'public', 'uploads');
const PUBLIC_DIR  = path.join(ROOT, 'public');
const ADMIN_DIR   = path.join(ROOT, 'admin');

// ── Ensure directories exist ──────────────────────────────────────────────
[DATA_DIR, BACKUPS_DIR, UPLOADS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── Middleware ────────────────────────────────────────────────────────────
app.disable('x-powered-by');
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const SESSION_SECRET = process.env.SESSION_SECRET
  || 'bam-default-secret-please-change-in-env-' + Date.now();

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'bam.sid',
  cookie: {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS === 'true'
  }
}));

// ── Block direct data/ access ─────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.startsWith('/data/')) return res.status(403).send('Forbidden');
  next();
});

// ── Static files ──────────────────────────────────────────────────────────
app.use(express.static(PUBLIC_DIR));
app.use('/admin', express.static(ADMIN_DIR));

// ── Upload ────────────────────────────────────────────────────────────────
const ALLOWED = ['.jpg','.jpeg','.png','.webp','.svg','.gif','.mp4','.webm','.mov'];

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS_DIR),
  filename: (_, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '_' + safe);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    ALLOWED.includes(ext) ? cb(null, true) : cb(new Error('Dateityp nicht erlaubt'));
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────
const readJSON  = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8');
const safe      = n => path.basename(n || '');
const requireAuth = (req, res, next) =>
  req.session?.userId ? next() : res.status(401).json({ error: 'Nicht angemeldet' });

function backupContent() {
  if (!fs.existsSync(CONTENT_F)) return;
  const ts  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dst = path.join(BACKUPS_DIR, `content-${ts}.json`);
  try {
    fs.copyFileSync(CONTENT_F, dst);
    // Keep max 30 backups
    fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith('content-') && f.endsWith('.json'))
      .sort().reverse().slice(30)
      .forEach(f => { try { fs.unlinkSync(path.join(BACKUPS_DIR, f)); } catch {} });
  } catch {}
}

// ── Init admin user ───────────────────────────────────────────────────────
async function initUsers() {
  let users = readJSON(USERS_F) || [];
  if (users.some(u => u.username === (process.env.ADMIN_USER || 'admin'))) return;
  const pass = process.env.ADMIN_PASSWORD || 'bam2024admin';
  const hash = await bcrypt.hash(pass, 10);
  users.push({ id: '1', username: process.env.ADMIN_USER || 'admin', passwordHash: hash, role: 'admin', createdAt: new Date().toISOString() });
  writeJSON(USERS_F, users);
  console.log(`  Admin: ${process.env.ADMIN_USER || 'admin'} / ${process.env.ADMIN_PASSWORD ? '(from env)' : pass}`);
  if (!process.env.ADMIN_PASSWORD) console.log('  ⚠️  Bitte Passwort im Admin-Backend ändern!');
}

// ═══════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Fehlende Felder' });
    const users = readJSON(USERS_F) || [];
    const user  = users.find(u => u.username === username);
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    req.session.userId   = user.id;
    req.session.username = user.username;
    req.session.role     = user.role;
    res.json({ ok: true, username: user.username });
  } catch { res.status(500).json({ error: 'Server-Fehler' }); }
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', requireAuth, (req, res) => res.json({ username: req.session.username, role: req.session.role }));

app.post('/api/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Mindestens 8 Zeichen' });
    const users = readJSON(USERS_F) || [];
    const idx   = users.findIndex(u => u.id === req.session.userId);
    if (idx === -1) return res.status(404).json({ error: 'User nicht gefunden' });
    if (!(await bcrypt.compare(currentPassword, users[idx].passwordHash)))
      return res.status(401).json({ error: 'Aktuelles Passwort falsch' });
    users[idx].passwordHash = await bcrypt.hash(newPassword, 10);
    writeJSON(USERS_F, users);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server-Fehler' }); }
});

// ═══════════════════════════════════════════════════════════
// CONTENT
// ═══════════════════════════════════════════════════════════
app.get('/api/content', (_, res) => {
  const c = readJSON(CONTENT_F);
  c ? res.json(c) : res.status(404).json({ error: 'content.json fehlt' });
});

app.post('/api/content', requireAuth, (req, res) => {
  try {
    if (!req.body?.global || !req.body?.pages) return res.status(400).json({ error: 'Ungültige Struktur' });
    backupContent();
    writeJSON(CONTENT_F, req.body);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/content/section', requireAuth, (req, res) => {
  try {
    const { page, sectionId, data } = req.body;
    const c = readJSON(CONTENT_F);
    const sections = c?.pages?.[page]?.sections;
    if (!sections) return res.status(404).json({ error: 'Seite nicht gefunden' });
    const idx = sections.findIndex(s => s.id === sectionId);
    if (idx === -1) return res.status(404).json({ error: 'Sektion nicht gefunden' });
    sections[idx] = { ...sections[idx], ...data };
    backupContent(); writeJSON(CONTENT_F, c);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/content/global', requireAuth, (req, res) => {
  try {
    const c = readJSON(CONTENT_F);
    if (!c) return res.status(500).json({ error: 'Nicht lesbar' });
    c.global = { ...c.global, ...req.body };
    backupContent(); writeJSON(CONTENT_F, c);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/content/reorder', requireAuth, (req, res) => {
  try {
    const { page, order } = req.body;
    const c = readJSON(CONTENT_F);
    const sections = c?.pages?.[page]?.sections;
    if (!sections) return res.status(404).json({ error: 'Seite nicht gefunden' });
    const map = Object.fromEntries(sections.map(s => [s.id, s]));
    c.pages[page].sections = order.map(id => map[id]).filter(Boolean);
    backupContent(); writeJSON(CONTENT_F, c);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// MEDIA
// ═══════════════════════════════════════════════════════════
app.get('/api/media', requireAuth, (_, res) => {
  try {
    const imgs  = ['.jpg','.jpeg','.png','.webp','.svg','.gif'];
    const files = fs.readdirSync(UPLOADS_DIR)
      .filter(f => ALLOWED.includes(path.extname(f).toLowerCase()))
      .map(f => {
        const fp = path.join(UPLOADS_DIR, f);
        const st = fs.statSync(fp);
        const ex = path.extname(f).toLowerCase();
        return { filename: f, url: `/uploads/${f}`, sizeKB: Math.round(st.size/1024), type: imgs.includes(ex)?'image':'video', ext: ex.slice(1), modified: st.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    res.json(files);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  const ex = path.extname(req.file.filename).toLowerCase();
  res.json({ ok: true, filename: req.file.filename, url: `/uploads/${req.file.filename}`, type: ['.jpg','.jpeg','.png','.webp','.svg','.gif'].includes(ex)?'image':'video', sizeKB: Math.round(req.file.size/1024) });
});

app.delete('/api/media/:filename', requireAuth, (req, res) => {
  try {
    const fp = path.join(UPLOADS_DIR, safe(req.params.filename));
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Nicht gefunden' });
    fs.unlinkSync(fp);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/media/:filename', requireAuth, (req, res) => {
  try {
    const newName = (req.body.newName || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!newName) return res.status(400).json({ error: 'Ungültiger Name' });
    const op = path.join(UPLOADS_DIR, safe(req.params.filename));
    const np = path.join(UPLOADS_DIR, newName);
    if (!fs.existsSync(op)) return res.status(404).json({ error: 'Nicht gefunden' });
    if (fs.existsSync(np)) return res.status(409).json({ error: 'Name vergeben' });
    fs.renameSync(op, np);
    res.json({ ok: true, url: `/uploads/${newName}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// BACKUPS
// ═══════════════════════════════════════════════════════════
app.get('/api/backups', requireAuth, (_, res) => {
  try {
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith('content-') && f.endsWith('.json'))
      .sort().reverse()
      .map(f => { const st = fs.statSync(path.join(BACKUPS_DIR, f)); return { filename: f, sizeKB: Math.round(st.size/1024), created: st.mtime.toISOString() }; });
    res.json(files);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/restore', requireAuth, (req, res) => {
  try {
    const src = path.join(BACKUPS_DIR, safe(req.body.filename || ''));
    if (!fs.existsSync(src)) return res.status(404).json({ error: 'Backup nicht gefunden' });
    backupContent();
    fs.copyFileSync(src, CONTENT_F);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// PAGE ROUTES
// ═══════════════════════════════════════════════════════════
app.get('/admin', (_, res) => res.sendFile(path.join(ADMIN_DIR, 'index.html')));
app.get('/admin/*', (_, res) => res.sendFile(path.join(ADMIN_DIR, 'index.html')));

// SPA fallback — always serve index.html
app.get('*', (_, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// Error handler
app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Datei zu groß (max 50MB)' });
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────
initUsers().then(() => {
  app.listen(PORT, () => {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🚀 BAM Mediamanagement — Online');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🌐 Website:  http://localhost:' + PORT);
    console.log('  🔧 Admin:    http://localhost:' + PORT + '/admin');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  });
}).catch(e => { console.error('Startup error:', e); process.exit(1); });
