const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const fs = require('fs');
const db = require('./database');

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

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// Helper: Get local network IPs for mobile access
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      // Node 18+ uses family as 'IPv4' or 4
      if ((net.family === 'IPv4' || net.family === 4) && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

// ================= API ENDPOINTS =================

// Status & Dashboard summary
app.get('/api/status', (req, res) => {
  try {
    const summary = db.getRoomSummary();
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Network info for mobile QR code
app.get('/api/system/network-info', (req, res) => {
  try {
    const ips = getLocalIpAddresses();
    res.json({
      success: true,
      data: {
        port: PORT,
        localIps: ips,
        mobileUrls: ips.map(ip => `http://${ip}:${PORT}`),
        localhostUrl: `http://localhost:${PORT}`
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Members
app.get('/api/members', (req, res) => {
  try {
    const members = db.getAllMembers();
    res.json({ success: true, data: members });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/members', (req, res) => {
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

app.put('/api/members/:id', (req, res) => {
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

app.delete('/api/members/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.deleteMember(Number(id));
    res.json({ success: true, message: 'Member deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/members/reorder', (req, res) => {
  try {
    const { order } = req.body; // array of member IDs
    if (!Array.isArray(order)) {
      return res.status(400).json({ success: false, error: 'Order array required' });
    }
    const members = db.reorderMembers(order);
    res.json({ success: true, data: members });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Turns
app.post('/api/turn/complete', (req, res) => {
  try {
    const { memberId, quantity, litres, source, cost, notes, paidByMemberId } = req.body;
    const current = db.getCurrentTurnMember();
    const effectiveMemberId = memberId || (current ? current.id : null);

    if (!effectiveMemberId) {
      return res.status(400).json({ success: false, error: 'No member selected and no active turn' });
    }

    const defaultLitres = Number(db.getSetting('default_can_litres') || 20);
    const log = db.logWater({
      memberId: effectiveMemberId,
      quantity: quantity || 1,
      litres: litres || (Number(quantity || 1) * defaultLitres),
      source: source || 'Water Cooler',
      cost: cost || 0,
      paidByMemberId: paidByMemberId || effectiveMemberId,
      notes: notes || '',
      wasTurn: 1
    });

    const summary = db.getRoomSummary();
    res.json({ success: true, data: { log, summary } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/turn/skip', (req, res) => {
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

app.post('/api/turn/swap', (req, res) => {
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

app.post('/api/turn/set-current', (req, res) => {
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

app.post('/api/turn/can-status', (req, res) => {
  try {
    const { status } = req.body; // 'full', 'half', 'empty'
    if (!['full', 'half', 'empty'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid can status' });
    }
    db.setSetting('can_status', status);
    res.json({ success: true, data: { can_status: status } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Logs & History
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

app.post('/api/logs', (req, res) => {
  try {
    const { memberId, quantity, litres, source, cost, notes, paidByMemberId, wasTurn } = req.body;
    if (!memberId) {
      return res.status(400).json({ success: false, error: 'memberId is required' });
    }
    const defaultLitres = Number(db.getSetting('default_can_litres') || 20);
    const log = db.logWater({
      memberId: Number(memberId),
      quantity: Number(quantity) || 1,
      litres: Number(litres) || (Number(quantity || 1) * defaultLitres),
      source: source || 'Water Cooler',
      cost: Number(cost) || 0,
      paidByMemberId: paidByMemberId ? Number(paidByMemberId) : Number(memberId),
      notes: notes || '',
      wasTurn: wasTurn !== undefined ? (wasTurn ? 1 : 0) : 1
    });

    res.json({ success: true, data: log });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/logs/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.deleteLog(Number(id));
    res.json({ success: true, message: 'Log entry removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Settings
app.get('/api/settings', (req, res) => {
  try {
    const settings = db.getAllSettings();
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const { room_name, rotation_mode, default_can_litres } = req.body;
    if (room_name !== undefined) db.setSetting('room_name', room_name.trim());
    if (rotation_mode !== undefined) db.setSetting('rotation_mode', rotation_mode);
    if (default_can_litres !== undefined) db.setSetting('default_can_litres', String(default_can_litres));

    res.json({ success: true, data: db.getAllSettings() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Backup & Restore
app.get('/api/backup/export', (req, res) => {
  try {
    const data = db.exportAllData();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="panipari-backup.json"');
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/backup/import', (req, res) => {
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
  console.log(`🏠 Local:   http://localhost:${PORT}`);
  const ips = getLocalIpAddresses();
  ips.forEach(ip => {
    console.log(`📱 Mobile:  http://${ip}:${PORT}`);
  });
  console.log(`=======================================================`);
});
