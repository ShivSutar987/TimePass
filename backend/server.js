const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const fs = require('fs');
const db = require('./database');
const security = require('./security');

// Automatically load .env file if it exists (checks backend/.env or root .env)
const possibleEnvPaths = [
  path.join(__dirname, '.env'),
  path.join(__dirname, '..', '.env')
];
for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(envPath);
      break;
    } catch (e) {
      console.warn('Could not load .env file:', e.message);
    }
  }
}

// Ensure Admin Credentials initialized on startup
security.ensureAdminCredentials(db);

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Utility Middlewares
app.use(security.securityHeadersMiddleware);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Serve static frontend files
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// Helper: Get local network IPs for mobile access
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if ((net.family === 'IPv4' || net.family === 4) && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

const DEPLOYED_URL = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'https://timepass-0vuz.onrender.com';

// ================= AUTHENTICATION & SECURITY ENDPOINTS =================

// Admin Login with Brute-Force Rate Limiting
app.post('/api/auth/login', (req, res) => {
  try {
    const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    
    // Check rate limit
    const rateCheck = security.checkRateLimit(clientIp);
    if (!rateCheck.allowed) {
      return res.status(429).json({ success: false, error: rateCheck.error });
    }

    const { pin } = req.body || {};
    if (!pin) {
      return res.status(400).json({ success: false, error: 'Admin PIN is required' });
    }

    const creds = security.ensureAdminCredentials(db);
    const isValid = security.verifyPin(pin, creds.hash, creds.salt);

    if (!isValid) {
      const attempt = security.recordFailedAttempt(clientIp);
      if (attempt.isLocked) {
        return res.status(429).json({ success: false, error: 'Too many failed attempts. Locked for 5 minutes.' });
      }
      return res.status(401).json({
        success: false,
        error: `Invalid Admin PIN. ${attempt.attemptsRemaining} attempt(s) remaining.`
      });
    }

    security.clearFailedAttempts(clientIp);
    const session = security.createSession(clientIp);

    res.json({
      success: true,
      data: {
        token: session.token,
        expiresAt: session.expiresAt
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin Logout
app.post('/api/auth/logout', (req, res) => {
  try {
    const token = security.extractToken(req);
    security.revokeSession(token);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Check Admin Status
app.get('/api/auth/status', (req, res) => {
  const token = security.extractToken(req);
  const isValid = security.validateSession(token);
  res.json({ success: true, data: { isAdmin: isValid } });
});

// Change Admin PIN (Admin Only)
app.post('/api/auth/change-pin', security.requireAdmin, (req, res) => {
  try {
    const { currentPin, newPin } = req.body || {};
    if (!newPin || String(newPin).trim().length < 4) {
      return res.status(400).json({ success: false, error: 'New PIN must be at least 4 characters long' });
    }

    const creds = security.ensureAdminCredentials(db);
    const isValid = security.verifyPin(currentPin, creds.hash, creds.salt);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Current Admin PIN is incorrect' });
    }

    const { hash, salt } = security.hashPin(String(newPin).trim());
    db.setSetting('admin_pin_hash', hash);
    db.setSetting('admin_pin_salt', salt);

    res.json({ success: true, message: 'Admin PIN updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================= DASHBOARD & STATUS =================

// Status & Dashboard summary (Public)
app.get('/api/status', (req, res) => {
  try {
    const summary = db.getRoomSummary();
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Network info for mobile QR code (Public)
app.get('/api/system/network-info', (req, res) => {
  try {
    const ips = getLocalIpAddresses();
    res.json({
      success: true,
      data: {
        port: PORT,
        deployedUrl: DEPLOYED_URL,
        localIps: ips,
        mobileUrls: [DEPLOYED_URL, ...ips.map(ip => `http://${ip}:${PORT}`)],
        localhostUrl: DEPLOYED_URL
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================= ROOMMATES / MEMBERS =================

// List all members (Public)
app.get('/api/members', (req, res) => {
  try {
    const members = db.getAllMembers();
    res.json({ success: true, data: members });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Member full profile & statistics details (Public - for turn sequence click)
app.get('/api/members/:id/details', (req, res) => {
  try {
    const { id } = req.params;
    const details = db.getMemberDetails(Number(id));
    if (!details) {
      return res.status(404).json({ success: false, error: 'Member not found' });
    }
    res.json({ success: true, data: details });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add member (Admin Only)
app.post('/api/members', security.requireAdmin, (req, res) => {
  try {
    const { name, nickname, color, emoji } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }
    const member = db.addMember(name, nickname, color, emoji);
    res.json({ success: true, data: member });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update member (Admin Only)
app.put('/api/members/:id', security.requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const updated = db.updateMember(Number(id), req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Member not found' });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete member (Admin Only)
app.delete('/api/members/:id', security.requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    db.deleteMember(Number(id));
    res.json({ success: true, message: 'Member deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reorder members (Admin Only)
app.post('/api/members/reorder', security.requireAdmin, (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) {
      return res.status(400).json({ success: false, error: 'Order array required' });
    }
    const members = db.reorderMembers(order);
    res.json({ success: true, data: members });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================= TURNS & WATER ACTION =================

// Complete turn: Regular roommates can report water; if admin, it's auto-confirmed, else marked pending
app.post('/api/turn/complete', security.optionalAdmin, (req, res) => {
  try {
    const { memberId, quantity, litres, source, cost, notes, paidByMemberId } = req.body;
    const current = db.getCurrentTurnMember();
    const effectiveMemberId = memberId || (current ? current.id : null);

    if (!effectiveMemberId) {
      return res.status(400).json({ success: false, error: 'No member selected and no active turn' });
    }

    const defaultLitres = Number(db.getSetting('default_can_litres') || 20);
    const isConfirmed = req.isAdmin ? 1 : 0;
    const confirmedBy = req.isAdmin ? 'Admin' : null;

    const log = db.logWater({
      memberId: effectiveMemberId,
      quantity: quantity || 1,
      litres: litres || (Number(quantity || 1) * defaultLitres),
      source: source || 'Water Cooler',
      cost: cost || 0,
      paidByMemberId: paidByMemberId || effectiveMemberId,
      notes: notes || '',
      wasTurn: 1,
      isConfirmed,
      confirmedBy
    });

    const summary = db.getRoomSummary();
    res.json({
      success: true,
      data: {
        log,
        summary,
        requiresAdminConfirmation: !req.isAdmin
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Skip Turn (Admin Only)
app.post('/api/turn/skip', security.requireAdmin, (req, res) => {
  try {
    const { reason } = req.body || {};
    const result = db.skipCurrentTurn(reason);
    if (!result) {
      return res.status(400).json({ success: false, error: 'Cannot skip turn (insufficient members)' });
    }
    const summary = db.getRoomSummary();
    res.json({ success: true, data: { ...result, summary } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Swap Turn (Admin Only)
app.post('/api/turn/swap', security.requireAdmin, (req, res) => {
  try {
    const { targetMemberId, reason } = req.body;
    if (!targetMemberId) {
      return res.status(400).json({ success: false, error: 'Target member ID required' });
    }
    const result = db.swapTurn(Number(targetMemberId), reason);
    if (!result) {
      return res.status(400).json({ success: false, error: 'Could not swap turn' });
    }
    const summary = db.getRoomSummary();
    res.json({ success: true, data: { ...result, summary } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Set Specific Turn (Admin Only)
app.post('/api/turn/set-current', security.requireAdmin, (req, res) => {
  try {
    const { memberId } = req.body;
    const member = db.setSpecificTurn(Number(memberId));
    if (!member) {
      return res.status(400).json({ success: false, error: 'Invalid member' });
    }
    const summary = db.getRoomSummary();
    res.json({ success: true, data: { currentTurn: member, summary } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Can Status (Public - any roommate can report can is empty/half/full)
app.post('/api/turn/can-status', (req, res) => {
  try {
    const { status } = req.body;
    if (!['full', 'half', 'empty'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid can status' });
    }
    db.setSetting('can_status', status);
    res.json({ success: true, data: { can_status: status } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================= LOGS & VERIFICATION =================

// Get Recent Logs (Public)
app.get('/api/logs', (req, res) => {
  try {
    const limit = Number(req.query.limit) || 100;
    const memberId = req.query.memberId ? Number(req.query.memberId) : null;
    const logs = db.getRecentLogs(limit, memberId);
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Custom Log Submission: Public can submit; if admin, verified immediately
app.post('/api/logs', security.optionalAdmin, (req, res) => {
  try {
    const { memberId, quantity, litres, source, cost, notes, paidByMemberId, wasTurn } = req.body;
    if (!memberId) {
      return res.status(400).json({ success: false, error: 'memberId is required' });
    }
    const defaultLitres = Number(db.getSetting('default_can_litres') || 20);
    const isConfirmed = req.isAdmin ? 1 : 0;
    const log = db.logWater({
      memberId: Number(memberId),
      quantity: Number(quantity) || 1,
      litres: Number(litres) || (Number(quantity || 1) * defaultLitres),
      source: source || 'Water Cooler',
      cost: Number(cost) || 0,
      paidByMemberId: paidByMemberId ? Number(paidByMemberId) : Number(memberId),
      notes: notes || '',
      wasTurn: wasTurn !== undefined ? (wasTurn ? 1 : 0) : 1,
      isConfirmed,
      confirmedBy: req.isAdmin ? 'Admin' : null
    });

    res.json({ success: true, data: log, requiresAdminConfirmation: !req.isAdmin });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Confirm that water was really brought (Admin Only)
app.post('/api/logs/:id/confirm', security.requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const updated = db.confirmWaterLog(Number(id), 'Admin');
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Log entry not found' });
    }
    const summary = db.getRoomSummary();
    res.json({ success: true, data: { log: updated, summary } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Confirm All Pending Water Logs (Admin Only)
app.post('/api/logs/confirm-all', security.requireAdmin, (req, res) => {
  try {
    db.confirmAllLogs('Admin');
    const summary = db.getRoomSummary();
    res.json({ success: true, data: { summary } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete / Reject Log Entry (Admin Only)
app.delete('/api/logs/:id', security.requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    db.deleteLog(Number(id));
    res.json({ success: true, message: 'Log entry removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================= SETTINGS & BACKUP =================

// Get Settings (Public)
app.get('/api/settings', (req, res) => {
  try {
    const settings = db.getAllSettings();
    // Do not leak password hashes in settings API
    delete settings.admin_pin_hash;
    delete settings.admin_pin_salt;
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Settings (Admin Only)
app.post('/api/settings', security.requireAdmin, (req, res) => {
  try {
    const { room_name, rotation_mode, default_can_litres } = req.body;
    if (room_name !== undefined) db.setSetting('room_name', room_name.trim());
    if (rotation_mode !== undefined) db.setSetting('rotation_mode', rotation_mode);
    if (default_can_litres !== undefined) db.setSetting('default_can_litres', String(default_can_litres));

    const settings = db.getAllSettings();
    delete settings.admin_pin_hash;
    delete settings.admin_pin_salt;

    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Export Backup (Public or Admin)
app.get('/api/backup/export', (req, res) => {
  try {
    const data = db.exportAllData();
    // Strip sensitive hashes from export if desired
    data.settings = (data.settings || []).filter(s => !s.key.startsWith('admin_pin_'));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="panipari-backup.json"');
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Import / Restore Backup (Admin Only)
app.post('/api/backup/import', security.requireAdmin, (req, res) => {
  try {
    const summary = db.importAllData(req.body);
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback to index.html for SPA
app.use((req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`💧 Room Water Turn Manager Server Started!`);
  console.log(`🌐 Live URL: ${DEPLOYED_URL}`);
  console.log(`🏠 Local:    http://localhost:${PORT}`);
  console.log(`🔐 Admin PIN: Enabled (Default PIN: 1234 or configured via ADMIN_PIN)`);
  const ips = getLocalIpAddresses();
  ips.forEach(ip => {
    console.log(`📱 Mobile:   http://${ip}:${PORT}`);
  });
  console.log(`=======================================================`);
});
