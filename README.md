# 💧 PaniPari - Room Water Turn Manager

A lightweight, fair, secure, and modern web application built for roommates, hostel mates, and flatmates to track and manage whose turn it is to bring water into the room from coolers, RO filters, or water jars.

---

## 🌟 Key Features

1. **👑 Admin Login & Privilege Control**:
   - **Admin Access Only**: Adding roommates, deleting roommates, skipping turns, swapping turns, and changing room settings require the Admin PIN.
   - **Default Admin PIN**: `1234` (changeable in the app Settings or configured via `ADMIN_PIN` in `.env`).
   - **Brute-Force Protection**: Automatic IP-based rate limiting prevents unauthorized PIN guessing.

2. **✅ Water Verification / Confirmation**:
   - When roommates click *"I Brought Water!"*, the turn advances and logs water with a **⏳ Pending Confirmation** status.
   - The Admin can inspect and **confirm** whether water was really brought into the room with 1-click **"✅ Confirm"** or reject/delete false claims.

3. **👤 Interactive Turn Sequence & Roommate Details**:
   - **Sequential Queue**: Displays who is on turn now, who is next, and the full rotation order.
   - **Click to Inspect**: Click on **any roommate card** in the turn sequence to open their full profile modal!
   - Shows: Total cans brought, total litres, completed turns, fairness delta, room water share (%), last fetched time, and complete individual activity history.

4. **💧 Clear "Current Turn" Hero Display**:
   - High-visibility banner showing exactly whose turn it is right now.
   - Shows their total cans brought and last fetched time.
   - 1-Click **"I Brought Water!"** button with celebratory confetti & chime!

5. **Water Camper / Jar Status Indicator**:
   - Quick toggle: 🟢 **Full**, 🟡 **Half / Low**, 🔴 **Empty!**
   - When marked **Empty**, an urgent alert banner notifies the entire room with the current person's name highlighted.

6. **Fairness Score & Room Leaderboard**:
   - Real-time tracking of cans brought, total litres, and turns completed.
   - **Fairness Delta**: Highlights who is ahead (⭐ Star Roommate), on-track (Even ✅), or behind duty (⚠️).
   - Cost / Expense tracking: If you buy 20L water cans (e.g., ₹20 or ₹30 per jar), track who paid for what.

7. **Roommate Management (Vacation / Away Mode)**:
   - Add, edit, or delete roommates with custom avatars, emojis, and colors.
   - Toggle **"🏖️ Away / Vacation"**: Automatically skips members who went home for holidays or weekends so they aren't assigned turns while gone!

8. **Flexible Rotation Algorithms**:
   - **Round Robin**: Standard cyclic order ($A \to B \to C \to D \to A$).
   - **Fair Auto-Balance**: Automatically prioritizes whoever has brought the fewest total cans!

9. **Mobile QR Code & Shared Wi-Fi Access**:
   - Click the **📱 Mobile QR** button in the header.
   - Scan the QR code with any smartphone camera on the same Wi-Fi network to open and use the web app instantly on mobile phones!

10. **⚡ Lightweight & Fast (< 50 MB GitHub Friendly)**:
    - **Backend**: ~2.3 MB (Uses Node.js + native `node:sqlite` + Express).
    - **Frontend**: ~0.1 MB (Pure vanilla HTML/CSS/JS, zero bloated node_modules).
    - **Zero Large Files**: All source files are well under 100 KB, strictly compliant with GitHub's 50 MB per-file limit!

---

## 🚀 How to Run

### Method 1: Double-Click Startup (Windows)
Double-click `start.bat` in this folder.

### Method 2: Terminal / Command Prompt
```bash
cd backend
node server.js
```

Then open your browser at:
- **Live Deployed App**: [https://timepass-0vuz.onrender.com](https://timepass-0vuz.onrender.com)
- **Local Development**: [http://localhost:3000](http://localhost:3000)
- **Mobile Phones**: Open [https://timepass-0vuz.onrender.com](https://timepass-0vuz.onrender.com) or scan the QR code from the app!

### 🔐 Admin PIN
- Default PIN: `1234`
- To log in: Click **🔐 Admin Login** in the header.
- To change: Open **⚙️ Settings** while logged in as Admin, or set `ADMIN_PIN=your_pin` in `.env`.

---

## 📁 Directory Structure & Files

```text
TimePass/
├── backend/                  (~2.3 MB - Native SQLite & Express)
│   ├── data/
│   │   └── water_turns.db    (SQLite database with confirmation tracking)
│   ├── database.js           (Database models, queries & migrations)
│   ├── security.js           (Pure Node.js crypto, sessions & brute-force protection)
│   ├── server.js             (Express REST API, static files & auth endpoints)
│   ├── package.json
│   └── node_modules/         (Minimal dependencies: express + cors)
├── frontend/                 (~0.12 MB - Fast vanilla web app)
│   ├── css/
│   │   └── style.css         (Modern dark-mode glassmorphism styling)
│   ├── js/
│   │   ├── app.js            (Client-side app logic, admin auth & detail modals)
│   │   ├── confetti.min.js   (Offline celebration script)
│   │   └── qrcode.min.js     (Offline QR code generator)
│   └── index.html            (Responsive single-page web app)
├── .env                      (Environment configuration)
├── .env.example
├── start.bat                 (1-Click Windows launcher)
├── render.yaml               (Render deployment blueprint)
└── README.md
```
