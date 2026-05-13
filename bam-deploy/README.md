# BAM Mediamanagement — Website + CMS v2

## ⚡ Schnellstart (lokal)

```bash
npm install
npm start
```

- 🌐 Website: http://localhost:3000
- 🔧 Admin:   http://localhost:3000/admin
- Login: `admin` / `bam2024admin`

---

## 🚀 Render — Deployment-Anleitung (korrekt)

### Problem beheben falls JSON angezeigt wird:

Das passiert wenn Render die Umgebungsvariablen oder den Build-Befehl falsch konfiguriert hat.

### Schritt-für-Schritt Render-Setup:

**1. GitHub Repository anlegen**
```bash
git init
git add .
git commit -m "BAM Website v2"
git branch -M main
git remote add origin https://github.com/DEIN-USER/bam-website.git
git push -u origin main
```

**2. Render Web Service konfigurieren**

Gehe zu https://render.com → "New +" → "Web Service"

Einstellungen EXAKT so:
| Feld | Wert |
|---|---|
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Root Directory** | *(leer lassen)* |

**3. Environment Variables setzen**

In Render unter "Environment" → "Add Environment Variable":

| Variable | Wert |
|---|---|
| `SESSION_SECRET` | (langer zufälliger String, min. 32 Zeichen) |
| `NODE_ENV` | `production` |

Optional:
| `ADMIN_USER` | dein Benutzername |
| `ADMIN_PASSWORD` | dein Passwort |

**4. Deploy starten**

"Create Web Service" klicken → warten bis "Live" erscheint.

---

## 📁 Projektstruktur

```
bam-website/
├── server.js          ← Node.js Server
├── package.json       ← Dependencies & Scripts
├── .env.example       ← Vorlage für lokale Einstellungen
├── data/
│   ├── content.json   ← Alle Website-Inhalte
│   ├── users.json     ← Admin-Login (wird automatisch erstellt)
│   └── backups/       ← Automatische Sicherungen
├── public/
│   ├── index.html     ← Die komplette Website (4.8MB, alles drin)
│   └── uploads/       ← Hochgeladene Medien
└── admin/
    └── index.html     ← Admin CMS
```

---

## 🔑 Admin-Login ändern

Nach erstem Login: Admin → Sidebar → "Passwort ändern"

Oder via Umgebungsvariablen (empfohlen für Render):
- `ADMIN_USER=meinname`
- `ADMIN_PASSWORD=meinpasswort`

---

## ⚠️ Wichtig für Render: Datenpersistenz

Render löscht Uploads bei jedem neuen Deploy.

**Lösung:** Gehe in Render zu:
Settings → Disks → "Add Disk"
- Name: `uploads`
- Mount Path: `/opt/render/project/src/public/uploads`
- Size: 1 GB (kostenlos)

---

## 🔧 Lokale .env Datei

```bash
cp .env.example .env
# .env bearbeiten:
# SESSION_SECRET=dein-geheimer-schluessel-hier
# ADMIN_PASSWORD=deinpasswort
```

---

## 🐳 Docker (optional)

```bash
docker build -t bam-website .
docker run -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/public/uploads:/app/public/uploads \
  -e SESSION_SECRET=dein-secret \
  bam-website
```
