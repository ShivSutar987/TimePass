# 💧 PaniPari - Room Water Turn Manager

A lightweight, fair, and modern web application built for roommates, hostel mates, and flatmates to track and manage whose turn it is to bring water into the room from coolers, RO filters, or water jars.

---

## 🌟 Key Features

1. **Clear "Current Turn" Hero Display**:
   - High-visibility banner showing exactly whose turn it is right now.
   - Shows their total cans brought and last fetched time.
   - 1-Click **"I Brought Water!"** button with celebratory confetti & chime!

2. **Visual Turn Queue (Next In Line)**:
   - Lineup showing the current person, who is up next, and the complete rotation order.

3. **Water Camper / Jar Status Indicator**:
   - Quick toggle: 🟢 **Full**, 🟡 **Half / Low**, 🔴 **Empty!**
   - When marked **Empty**, an urgent alert banner notifies the entire room with the current person's name highlighted.

4. **Skip & Swap Turns**:
   - **Skip Turn**: If someone is in class, outside, or sick, smoothly pass the duty to the next roommate without breaking order.
   - **Swap Turn**: Agree with a roommate to switch turns.

5. **Fairness Score & Room Leaderboard**:
   - Real-time tracking of cans brought, total litres, and turns completed.
   - **Fairness Delta**: Highlights who is ahead (⭐ Star Roommate), on-track (Even ✅), or behind duty (⚠️).
   - Cost / Expense tracking: If you buy 20L water cans (e.g., ₹20 or ₹30 per jar), track who paid for what.

6. **Roommate Management (Vacation / Away Mode)**:
   - Add, edit, or delete roommates with custom avatars, emojis, and colors.
   - Toggle **"🏖️ Away / Vacation"**: Automatically skips members who went home for holidays or weekends so they aren't assigned turns while gone!

7. **Flexible Rotation Algorithms**:
   - **Round Robin**: Standard cyclic order ($A \to B \to C \to D \to A$).
   - **Fair Auto-Balance**: Automatically prioritizes whoever has brought the fewest total cans!

8. **Mobile QR Code & Shared Wi-Fi Access**:
   - Click the **📱 Mobile QR** button in the header.
   - Scan the QR code with any smartphone camera on the same Wi-Fi network to open and use the web app instantly on mobile phones!

9. **Lightweight & High-Speed**:
   - **Backend**: ~2.2 MB (Uses Node.js + native `node:sqlite` + Express).
   - **Frontend**: ~0.1 MB (Pure vanilla HTML/CSS/JS, zero bloated node_modules).
   - **Strictly well under the 50 MB requirement!**

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

---

## 📁 Directory Structure & Size Verification

```text
TimePass/
├── backend/                  (~2.25 MB - Well under 50 MB)
│   ├── data/
│   │   └── water_turns.db    (SQLite persistent database)
│   ├── database.js           (Database models & queries)
│   ├── server.js             (Express REST API + static file server)
│   ├── package.json
│   └── node_modules/         (Minimal dependencies: express + cors)
├── frontend/                 (~0.10 MB - Well under 50 MB)
│   ├── css/
│   │   └── style.css         (Modern dark-mode glassmorphism styling)
│   ├── js/
│   │   ├── app.js            (Client-side application logic & API client)
│   │   ├── confetti.min.js   (Offline confetti celebration script)
│   │   └── qrcode.min.js     (Offline QR code generator)
│   └── index.html            (Responsive single-page web app)
├── start.bat                 (1-Click Windows launcher)
└── README.md
```
