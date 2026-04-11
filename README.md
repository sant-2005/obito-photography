# 📸 Obito Photography Management System

A full-featured photography business management dashboard — bookings, customers, invoices, and analytics.

---

## 🚀 Live Demo

Deployed on [Render](https://render.com) — see below for setup.

---

## 📁 Project Structure

```
obito-photography/
├── public/                  ← All frontend files (served as static)
│   ├── admin.html           ← Login page
│   ├── dashboard.html       ← Main dashboard
│   ├── add-booking.html     ← Create booking
│   ├── bookings-list.html   ← All bookings
│   ├── customers.html       ← Customer management
│   ├── invoices.html        ← Invoice management
│   ├── shared.css           ← Design system
│   ├── animations.css       ← Keyframe animations
│   ├── invoice.css          ← Invoice-specific styles
│   ├── shared.js            ← Auth, theme, toast, navigation
│   ├── db.js                ← IndexedDB + Supabase sync
│   ├── supabase.js          ← Supabase cloud config
│   ├── booking-manager.js   ← Booking add/edit/delete logic
│   └── invoice.js           ← Invoice render, print, WhatsApp
├── server.js                ← Express static server
├── package.json
├── .gitignore
└── README.md
```

---

## 🛠️ Local Development

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/obito-photography.git
cd obito-photography

# 2. Install dependencies
npm install

# 3. Start the server
npm start

# 4. Open in browser
open http://localhost:3000
```

**Demo login:**
- Username: `admin`
- Password: `admin123`

---

## ☁️ Deploy on Render

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/obito-photography.git
git push -u origin main
```

### Step 2 — Create Render Web Service
1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect your GitHub repo
3. Set these settings:

| Setting | Value |
|---|---|
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Plan** | Free |

4. Click **Deploy**. Done! ✅

Render will give you a URL like `https://obito-photography.onrender.com`.

---

## 🗄️ Supabase Setup (Optional — for cloud sync)

By default the app runs fully offline using **IndexedDB** in the browser.

To enable cloud sync:

1. Create a free project at [supabase.com](https://supabase.com)
2. Run this SQL in the Supabase SQL editor:

```sql
-- Bookings table
create table bookings (
  id text primary key,
  "customerName" text,
  phone text,
  email text,
  address text,
  "eventType" text,
  "eventDate" text,
  "eventTime" text,
  "eventDuration" text,
  venue text,
  city text,
  state text,
  "zipCode" text,
  service text,
  photographers int,
  budget int,
  advance int,
  status text,
  delivered boolean default false,
  description text,
  "createdAt" text,
  "createdBy" text,
  "updatedAt" text,
  "updatedBy" text
);

-- Customers table
create table customers (
  id text primary key,
  "firstName" text,
  "lastName" text,
  phone text,
  email text,
  city text,
  address text,
  category text,
  "totalBookings" int default 0,
  "totalRevenue" int default 0,
  "lastBookingId" text,
  "lastBookingDate" text,
  "createdAt" text,
  notes text,
  "updatedAt" text
);

-- Enable Row Level Security (open for now, lock down later)
alter table bookings enable row level security;
alter table customers enable row level security;

create policy "Allow all" on bookings for all using (true);
create policy "Allow all" on customers for all using (true);
```

3. Copy your project URL and anon key from **Settings → API**
4. Edit `public/supabase.js`:

```js
const SUPABASE_CONFIG = {
  url: 'https://YOUR_PROJECT.supabase.co',
  anonKey: 'YOUR_ANON_KEY',
};
```

5. Commit and push — Render will auto-redeploy.

---

## ✨ Features

- 📊 **Dashboard** — live stats, charts, pending deliveries
- 📅 **Bookings** — create, edit, delete, filter bookings
- 👥 **Customers** — auto-synced from bookings, VIP detection
- 📄 **Invoices** — wave-design PDF, print, WhatsApp share
- 🌙 **Dark mode** — system-aware with toggle
- 📱 **Responsive** — works on mobile
- ☁️ **Offline-first** — IndexedDB with optional Supabase sync

---

## 🔐 Default Credentials

| Field | Value |
|---|---|
| Username | `admin` |
| Password | `admin123` |

> Change this in `public/admin.html` → replace the `setTimeout` login block with a real API call when adding backend auth.
