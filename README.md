# ⚔️ Strava Conquest

> Transformez vos activités sportives en conquête de territoires sur une carte du monde réel.

---

## 🏗️ Architecture

```
strava-conquest/
├── frontend/
│   ├── index.html        # App principale (SPA)
│   ├── callback.html     # Page de retour OAuth Strava
│   ├── style.css         # UI dark gaming
│   ├── map.js            # Leaflet + rendu des tiles
│   └── dashboard.js      # Logic dashboard + sync
├── backend/
│   ├── supabase_client.js  # Client Supabase + helpers DB
│   ├── strava_oauth.js     # Auth Strava OAuth 2.0
│   └── tile_engine.js      # Décodage polylines + grille 500m
└── database/
    └── schema.sql          # Schéma Postgres complet
```

---

## ⚙️ Configuration

### 1. Supabase

1. Créer un projet sur [supabase.com](https://supabase.com)
2. Exécuter le fichier `database/schema.sql` dans l'éditeur SQL
3. Récupérer : **Project URL** et **anon public key**

### 2. Strava API

1. Créer une application sur [strava.com/settings/api](https://www.strava.com/settings/api)
2. Renseigner l'**Authorization Callback Domain** : votre domaine (ou `localhost`)
3. Récupérer : **Client ID** et **Client Secret**

### 3. Variables d'environnement

Remplacer dans `frontend/index.html` et `frontend/callback.html` :

```javascript
window.ENV = {
  SUPABASE_URL: 'https://VOTRE_PROJET.supabase.co',
  SUPABASE_ANON_KEY: 'VOTRE_CLE_ANON',
  STRAVA_CLIENT_ID: 'VOTRE_CLIENT_ID',
  STRAVA_CLIENT_SECRET: 'VOTRE_CLIENT_SECRET'
};
```

> ⚠️ En production, ne jamais exposer `STRAVA_CLIENT_SECRET` côté client !
> Déplacer l'échange de token vers une Edge Function Supabase.

---

## 🚀 Lancement

### En local (serveur HTTP simple)

```bash
# Avec Python
python3 -m http.server 8080 --directory frontend/

# Avec Node.js
npx serve frontend/ -p 8080

# Avec PHP
cd frontend && php -S localhost:8080
```

Puis ouvrir http://localhost:8080

### Configuration du Redirect URI Strava

Dans les paramètres de votre app Strava, mettre :
- `http://localhost:8080/callback.html` (dev)
- `https://votre-domaine.com/callback.html` (prod)

### Déploiement

Compatible avec :
- **Vercel** : `vercel --cwd frontend`
- **Netlify** : drag & drop du dossier `frontend/`
- **GitHub Pages** : publier le dossier `frontend/`
- **Supabase Storage** : hébergement statique intégré

---

## 🎮 Gameplay

### Système de tiles
- Découpage en grille de **500m × 500m**
- Chaque activité GPS capture les tiles traversées
- Un tile appartient au dernier utilisateur à l'avoir traversé

### Calcul des points
| Action | Points |
|--------|--------|
| Nouveau tile capturé | +10 pts |
| Tile revisité | +2 pts |
| Bonus vitesse élevée | +N pts |
| Bonus distance (par 10km) | +50 pts |
| Bonus dénivelé (par 10m) | +1 pt |
| Activité > 2h | +100 pts |

### Badges
| Badge | Condition |
|-------|-----------|
| 🗺️ Explorateur Bronze | 100 tiles |
| 🗺️ Explorateur Argent | 500 tiles |
| 🏅 Explorateur Or | 2000 tiles |
| ⛰️ Grimpeur | 10 000m D+ |
| 🏔️ Alpiniste | 50 000m D+ |
| 🔥 Sans repos (7j) | 7 jours consécutifs |
| 💪 Mois sans repos | 30 jours consécutifs |

---

## 🔧 Personnalisation

### Taille des tiles
Dans `backend/tile_engine.js` :
```javascript
const TILE_SIZE_METERS = 500; // Modifier ici
```

### Couleurs de la carte
Dans `frontend/map.js` :
```javascript
const USER_COLORS = ['#FF4444', '#4488FF', ...];
```

### Style de la carte
Options disponibles dans l'interface : dark / light / satellite

---

## 🔐 Sécurité (Production)

1. Créer une **Edge Function Supabase** pour l'échange de token Strava
2. Activer **Row Level Security** (déjà configuré dans schema.sql)
3. Utiliser des **variables d'environnement** côté serveur
4. Activer le **rate limiting** pour les appels API Strava

---

## 📊 Raccourcis clavier

| Touche | Action |
|--------|--------|
| `1` | Onglet Carte |
| `2` | Onglet Stats |
| `3` | Onglet Classement |
| `4` | Onglet Défis |
| `r` | Sync Strava |

---

## 🛠️ Stack

- **Frontend** : HTML5 + CSS3 + JavaScript vanilla
- **Carte** : Leaflet.js + CartoDB dark tiles
- **Backend** : Supabase (Postgres + Auth + Realtime)
- **API** : Strava API v3 (OAuth 2.0)
- **Déploiement** : Static hosting (Vercel/Netlify/GitHub Pages)
