const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'water_turns.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode and foreign keys for reliability
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Initialize tables
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      nickname TEXT DEFAULT '',
      color TEXT NOT NULL DEFAULT '#3b82f6',
      emoji TEXT NOT NULL DEFAULT '💧',
      is_active INTEGER NOT NULL DEFAULT 1,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS water_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      quantity REAL NOT NULL DEFAULT 1.0,
      litres REAL NOT NULL DEFAULT 20.0,
      source TEXT DEFAULT 'Water Cooler',
      cost REAL NOT NULL DEFAULT 0.0,
      paid_by_member_id INTEGER,
      notes TEXT DEFAULT '',
      was_turn INTEGER NOT NULL DEFAULT 1,
      is_confirmed INTEGER NOT NULL DEFAULT 1,
      confirmed_by TEXT DEFAULT NULL,
      confirmed_at TEXT DEFAULT NULL,
      logged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS turn_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL, -- 'completed', 'skipped', 'swapped'
      member_id INTEGER,
      target_member_id INTEGER,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Schema migration check for water_logs
  try {
    const tableInfo = db.prepare("PRAGMA table_info(water_logs)").all();
    const colNames = tableInfo.map(c => c.name);
    if (!colNames.includes('is_confirmed')) {
      db.exec("ALTER TABLE water_logs ADD COLUMN is_confirmed INTEGER NOT NULL DEFAULT 1;");
    }
    if (!colNames.includes('confirmed_by')) {
      db.exec("ALTER TABLE water_logs ADD COLUMN confirmed_by TEXT DEFAULT NULL;");
    }
    if (!colNames.includes('confirmed_at')) {
      db.exec("ALTER TABLE water_logs ADD COLUMN confirmed_at TEXT DEFAULT NULL;");
    }
  } catch (migErr) {
    console.warn('Migration note for water_logs:', migErr.message);
  }

  // Default settings
  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

  if (!getSetting.get('room_name')) {
    setSetting.run('room_name', 'Room 304 Hydration Club');
  }
  if (!getSetting.get('can_status')) {
    setSetting.run('can_status', 'full'); // full, half, empty
  }
  if (!getSetting.get('rotation_mode')) {
    setSetting.run('rotation_mode', 'round_robin'); // 'round_robin' or 'least_count'
  }
  if (!getSetting.get('default_can_litres')) {
    setSetting.run('default_can_litres', '20');
  }
  if (!getSetting.get('current_turn_member_id')) {
    setSetting.run('current_turn_member_id', '1');
  }

  // Seed default roommates if none exist
  const memberCount = db.prepare('SELECT COUNT(*) as count FROM members').get().count;
  if (memberCount === 0) {
    const insertMember = db.prepare(
      'INSERT INTO members (name, nickname, color, emoji, is_active, order_index) VALUES (?, ?, ?, ?, 1, ?)'
    );
    const defaults = [
      { name: 'Rahul', nickname: 'Bhai', color: '#3b82f6', emoji: '😎', order: 0 },
      { name: 'Aman', nickname: 'Sharmaji', color: '#10b981', emoji: '💪', order: 1 },
      { name: 'Rohan', nickname: 'Chintu', color: '#8b5cf6', emoji: '⚡', order: 2 },
      { name: 'Vikram', nickname: 'Boss', color: '#f59e0b', emoji: '👑', order: 3 }
    ];

    defaults.forEach((m) => {
      insertMember.run(m.name, m.nickname, m.color, m.emoji, m.order);
    });

    const firstMember = db.prepare('SELECT id FROM members ORDER BY order_index ASC LIMIT 1').get();
    if (firstMember) {
      setSetting.run('current_turn_member_id', String(firstMember.id));
    }
  }
}

initDatabase();

// Database queries & helpers
const Database = {
  // Settings
  getSetting(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  },

  setSetting(key, value) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
  },

  getAllSettings() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    return settings;
  },

  // Members
  getAllMembers() {
    return db.prepare('SELECT * FROM members ORDER BY order_index ASC, id ASC').all();
  },

  getActiveMembers() {
    return db.prepare('SELECT * FROM members WHERE is_active = 1 ORDER BY order_index ASC, id ASC').all();
  },

  getMemberById(id) {
    return db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  },

  addMember(name, nickname, color, emoji) {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(order_index), -1) as max_ord FROM members').get().max_ord;
    const result = db.prepare(
      'INSERT INTO members (name, nickname, color, emoji, is_active, order_index) VALUES (?, ?, ?, ?, 1, ?)'
    ).run(name.trim(), (nickname || '').trim(), color || '#3b82f6', emoji || '💧', maxOrder + 1);

    const newId = result.lastInsertRowid;
    // If current_turn is not set or invalid, set to this member
    const currentTurnId = this.getSetting('current_turn_member_id');
    if (!currentTurnId || !this.getMemberById(Number(currentTurnId))) {
      this.setSetting('current_turn_member_id', String(newId));
    }
    return this.getMemberById(newId);
  },

  updateMember(id, fields) {
    const member = this.getMemberById(id);
    if (!member) return null;

    const name = fields.name !== undefined ? fields.name.trim() : member.name;
    const nickname = fields.nickname !== undefined ? fields.nickname.trim() : member.nickname;
    const color = fields.color !== undefined ? fields.color : member.color;
    const emoji = fields.emoji !== undefined ? fields.emoji : member.emoji;
    const is_active = fields.is_active !== undefined ? (fields.is_active ? 1 : 0) : member.is_active;

    db.prepare(`
      UPDATE members
      SET name = ?, nickname = ?, color = ?, emoji = ?, is_active = ?
      WHERE id = ?
    `).run(name, nickname, color, emoji, is_active, id);

    // If member was marked inactive and was currently on turn, auto advance
    if (is_active === 0 && Number(this.getSetting('current_turn_member_id')) === Number(id)) {
      this.advanceTurn();
    }

    return this.getMemberById(id);
  },

  deleteMember(id) {
    const currentTurnId = Number(this.getSetting('current_turn_member_id'));
    if (currentTurnId === Number(id)) {
      this.advanceTurn();
    }
    db.prepare('DELETE FROM members WHERE id = ?').run(id);
    return true;
  },

  reorderMembers(orderedIds) {
    const updateStmt = db.prepare('UPDATE members SET order_index = ? WHERE id = ?');
    orderedIds.forEach((id, idx) => {
      updateStmt.run(idx, id);
    });
    return this.getAllMembers();
  },

  // Turn Logic
  getCurrentTurnMember() {
    let currentId = Number(this.getSetting('current_turn_member_id'));
    let member = this.getMemberById(currentId);

    // If current member is invalid or inactive, find first active
    if (!member || member.is_active !== 1) {
      const active = this.getActiveMembers();
      if (active.length > 0) {
        currentId = active[0].id;
        this.setSetting('current_turn_member_id', String(currentId));
        member = active[0];
      } else {
        return null;
      }
    }
    return member;
  },

  getNextTurnMember() {
    const current = this.getCurrentTurnMember();
    if (!current) return null;

    const mode = this.getSetting('rotation_mode') || 'round_robin';
    const active = this.getActiveMembers();
    if (active.length <= 1) return current;

    if (mode === 'round_robin') {
      const currentIndex = active.findIndex(m => m.id === current.id);
      const nextIndex = (currentIndex + 1) % active.length;
      return active[nextIndex];
    } else {
      // Least count mode
      const stats = this.getMemberStats();
      const otherActive = active.filter(m => m.id !== current.id);
      otherActive.sort((a, b) => {
        const aCount = (stats[a.id] ? stats[a.id].total_cans : 0);
        const bCount = (stats[b.id] ? stats[b.id].total_cans : 0);
        return aCount - bCount;
      });
      return otherActive[0] || current;
    }
  },

  getTurnQueue() {
    const current = this.getCurrentTurnMember();
    const active = this.getActiveMembers();
    if (active.length === 0) return [];
    if (!current) return active;

    const mode = this.getSetting('rotation_mode') || 'round_robin';
    if (mode === 'round_robin') {
      const currentIndex = active.findIndex(m => m.id === current.id);
      if (currentIndex === -1) return active;
      const queue = [];
      for (let i = 0; i < active.length; i++) {
        queue.push(active[(currentIndex + i) % active.length]);
      }
      return queue;
    } else {
      // In least count, current is first, rest sorted by count
      const stats = this.getMemberStats();
      const rest = active.filter(m => m.id !== current.id).sort((a, b) => {
        const aCount = (stats[a.id] ? stats[a.id].total_cans : 0);
        const bCount = (stats[b.id] ? stats[b.id].total_cans : 0);
        return aCount - bCount;
      });
      return [current, ...rest];
    }
  },

  advanceTurn() {
    const nextMember = this.getNextTurnMember();
    if (nextMember) {
      this.setSetting('current_turn_member_id', String(nextMember.id));
      return nextMember;
    }
    return null;
  },

  skipCurrentTurn(reason = '') {
    const current = this.getCurrentTurnMember();
    const next = this.getNextTurnMember();
    if (!current || !next) return null;

    db.prepare(`
      INSERT INTO turn_events (event_type, member_id, target_member_id, notes)
      VALUES ('skipped', ?, ?, ?)
    `).run(current.id, next.id, reason || 'Turn skipped');

    this.setSetting('current_turn_member_id', String(next.id));
    return { skipped: current, next };
  },

  swapTurn(targetMemberId, reason = '') {
    const current = this.getCurrentTurnMember();
    const target = this.getMemberById(targetMemberId);
    if (!current || !target || !target.is_active) return null;

    db.prepare(`
      INSERT INTO turn_events (event_type, member_id, target_member_id, notes)
      VALUES ('swapped', ?, ?, ?)
    `).run(current.id, target.id, reason || 'Turn swapped');

    this.setSetting('current_turn_member_id', String(target.id));
    return { previous: current, current: target };
  },

  setSpecificTurn(memberId) {
    const member = this.getMemberById(memberId);
    if (!member || !member.is_active) return null;
    this.setSetting('current_turn_member_id', String(member.id));
    return member;
  },

  // Water Logs
  logWater({ memberId, quantity = 1, litres = 20, source = 'Water Cooler', cost = 0, paidByMemberId = null, notes = '', wasTurn = 1, isConfirmed = 1, confirmedBy = null }) {
    const member = this.getMemberById(memberId);
    if (!member) throw new Error('Member not found');

    const confirmedFlag = (isConfirmed === 1 || isConfirmed === true) ? 1 : 0;
    const confirmedTime = confirmedFlag === 1 ? new Date().toISOString() : null;
    const confirmedAuthor = confirmedFlag === 1 ? (confirmedBy || 'Admin') : null;

    const result = db.prepare(`
      INSERT INTO water_logs (member_id, quantity, litres, source, cost, paid_by_member_id, notes, was_turn, is_confirmed, confirmed_by, confirmed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      memberId,
      Number(quantity),
      Number(litres),
      source,
      Number(cost),
      paidByMemberId ? Number(paidByMemberId) : memberId,
      notes,
      wasTurn ? 1 : 0,
      confirmedFlag,
      confirmedAuthor,
      confirmedTime
    );

    const logId = result.lastInsertRowid;

    // Record turn event
    db.prepare(`
      INSERT INTO turn_events (event_type, member_id, notes)
      VALUES ('completed', ?, ?)
    `).run(memberId, `Brought ${quantity} can(s) (${litres}L) from ${source}${confirmedFlag === 0 ? ' [Pending Admin confirmation]' : ''}`);

    // If this fulfilled turn (or was by the current turn member), advance turn
    const current = this.getCurrentTurnMember();
    if (wasTurn || (current && current.id === Number(memberId))) {
      this.advanceTurn();
    }

    // Set can status back to full!
    this.setSetting('can_status', 'full');
    this.setSetting('last_water_time', new Date().toISOString());

    return this.getLogById(logId);
  },

  confirmWaterLog(id, confirmedBy = 'Admin') {
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE water_logs
      SET is_confirmed = 1, confirmed_by = ?, confirmed_at = ?
      WHERE id = ?
    `).run(confirmedBy, now, id);

    if (result.changes === 0) return null;
    return this.getLogById(id);
  },

  confirmAllLogs(confirmedBy = 'Admin') {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE water_logs
      SET is_confirmed = 1, confirmed_by = ?, confirmed_at = ?
      WHERE is_confirmed = 0
    `).run(confirmedBy, now);
    return true;
  },

  getUnconfirmedLogs() {
    return db.prepare(`
      SELECT l.*, m.name as member_name, m.color as member_color, m.emoji as member_emoji
      FROM water_logs l
      LEFT JOIN members m ON l.member_id = m.id
      WHERE l.is_confirmed = 0
      ORDER BY l.logged_at DESC, l.id DESC
    `).all();
  },

  getMemberDetails(memberId) {
    const member = this.getMemberById(Number(memberId));
    if (!member) return null;

    const stats = this.getMemberStats();
    const memberStat = stats[memberId] || {
      member_id: member.id,
      name: member.name,
      nickname: member.nickname,
      color: member.color,
      emoji: member.emoji,
      is_active: member.is_active,
      total_cans: 0,
      total_litres: 0,
      total_spent: 0,
      turn_count: 0,
      last_brought_at: null,
      total_money_paid: 0
    };

    // Calculate room-wide totals & fairness
    const totalLogs = db.prepare('SELECT COALESCE(SUM(quantity), 0) as cans, COALESCE(SUM(litres), 0) as litres FROM water_logs').get();
    const activeMembers = this.getActiveMembers();
    const avgCans = activeMembers.length > 0 ? (totalLogs.cans / activeMembers.length) : 0;
    const delta = member.is_active ? Number((memberStat.total_cans - avgCans).toFixed(1)) : 0;
    const contributionPercent = totalLogs.cans > 0 ? Number(((memberStat.total_cans / totalLogs.cans) * 100).toFixed(1)) : 0;

    // Queue status and position
    const currentTurn = this.getCurrentTurnMember();
    const queue = this.getTurnQueue();
    const queueIndex = queue.findIndex(m => m.id === Number(memberId));
    let queueStatus = 'In Queue';
    if (!member.is_active) {
      queueStatus = 'On Vacation / Away';
    } else if (currentTurn && currentTurn.id === Number(memberId)) {
      queueStatus = 'Current Turn (Now)';
    } else if (queueIndex === 1) {
      queueStatus = 'Up Next';
    } else if (queueIndex > 1) {
      queueStatus = `#${queueIndex + 1} in Line`;
    }

    // Recent logs specifically for this member
    const recentLogs = db.prepare(`
      SELECT l.*, p.name as paid_by_name
      FROM water_logs l
      LEFT JOIN members p ON l.paid_by_member_id = p.id
      WHERE l.member_id = ?
      ORDER BY l.logged_at DESC, l.id DESC
      LIMIT 10
    `).all(memberId);

    return {
      member,
      stats: {
        ...memberStat,
        delta_from_avg: delta,
        contribution_percent: contributionPercent
      },
      queuePosition: queueIndex >= 0 ? queueIndex + 1 : null,
      queueStatus,
      isCurrentTurn: currentTurn ? currentTurn.id === Number(memberId) : false,
      recentLogs
    };
  },

  getLogById(id) {
    return db.prepare(`
      SELECT l.*, m.name as member_name, m.color as member_color, m.emoji as member_emoji,
             p.name as paid_by_name
      FROM water_logs l
      LEFT JOIN members m ON l.member_id = m.id
      LEFT JOIN members p ON l.paid_by_member_id = p.id
      WHERE l.id = ?
    `).get(id);
  },

  getRecentLogs(limit = 50, memberId = null) {
    let query = `
      SELECT l.*, m.name as member_name, m.color as member_color, m.emoji as member_emoji,
             p.name as paid_by_name
      FROM water_logs l
      LEFT JOIN members m ON l.member_id = m.id
      LEFT JOIN members p ON l.paid_by_member_id = p.id
    `;
    const params = [];

    if (memberId) {
      query += ` WHERE l.member_id = ? `;
      params.push(memberId);
    }

    query += ` ORDER BY l.logged_at DESC, l.id DESC LIMIT ? `;
    params.push(limit);

    return db.prepare(query).all(...params);
  },

  deleteLog(id) {
    db.prepare('DELETE FROM water_logs WHERE id = ?').run(id);
    return true;
  },

  // Stats and Summaries
  getMemberStats() {
    const members = this.getAllMembers();
    const stats = {};

    members.forEach(m => {
      stats[m.id] = {
        member_id: m.id,
        name: m.name,
        nickname: m.nickname,
        color: m.color,
        emoji: m.emoji,
        is_active: m.is_active,
        total_cans: 0,
        total_litres: 0,
        total_spent: 0,
        turn_count: 0,
        last_brought_at: null
      };
    });

    const rows = db.prepare(`
      SELECT member_id,
             SUM(quantity) as total_cans,
             SUM(litres) as total_litres,
             SUM(cost) as total_spent,
             COUNT(*) as turn_count,
             MAX(logged_at) as last_brought_at
      FROM water_logs
      GROUP BY member_id
    `).all();

    rows.forEach(r => {
      if (stats[r.member_id]) {
        stats[r.member_id].total_cans = Number(r.total_cans || 0);
        stats[r.member_id].total_litres = Number(r.total_litres || 0);
        stats[r.member_id].total_spent = Number(r.total_spent || 0);
        stats[r.member_id].turn_count = Number(r.turn_count || 0);
        stats[r.member_id].last_brought_at = r.last_brought_at;
      }
    });

    // Also calculate money paid by person (if paid_by_member_id was used)
    const paidRows = db.prepare(`
      SELECT paid_by_member_id, SUM(cost) as total_paid
      FROM water_logs
      WHERE paid_by_member_id IS NOT NULL AND cost > 0
      GROUP BY paid_by_member_id
    `).all();

    paidRows.forEach(p => {
      if (stats[p.paid_by_member_id]) {
        stats[p.paid_by_member_id].total_money_paid = Number(p.total_paid || 0);
      }
    });

    return stats;
  },

  getRoomSummary() {
    const totalLogs = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(quantity), 0) as cans, COALESCE(SUM(litres), 0) as litres, COALESCE(SUM(cost), 0) as cost FROM water_logs').get();
    const unconfirmedRow = db.prepare('SELECT COUNT(*) as count FROM water_logs WHERE is_confirmed = 0').get();
    const currentTurn = this.getCurrentTurnMember();
    const nextTurn = this.getNextTurnMember();
    const queue = this.getTurnQueue();
    const settings = this.getAllSettings();
    const statsObj = this.getMemberStats();
    const stats = Object.values(statsObj);

    // Calculate fairness metrics
    const activeStats = stats.filter(s => s.is_active);
    const avgCans = activeStats.length > 0 ? (totalLogs.cans / activeStats.length) : 0;

    stats.forEach(s => {
      s.delta_from_avg = s.is_active ? Number((s.total_cans - avgCans).toFixed(1)) : 0;
    });

    return {
      settings,
      currentTurn,
      nextTurn,
      queue,
      stats,
      unconfirmedCount: unconfirmedRow ? unconfirmedRow.count : 0,
      totals: {
        totalTurns: totalLogs.count,
        totalCans: totalLogs.cans,
        totalLitres: totalLogs.litres,
        totalCost: totalLogs.cost,
        averageCansPerPerson: Number(avgCans.toFixed(1))
      }
    };
  },

  exportAllData() {
    const members = db.prepare('SELECT * FROM members').all();
    const settings = db.prepare('SELECT * FROM settings').all();
    const logs = db.prepare('SELECT * FROM water_logs').all();
    const events = db.prepare('SELECT * FROM turn_events').all();
    return {
      version: 1,
      exported_at: new Date().toISOString(),
      members,
      settings,
      logs,
      events
    };
  },

  importAllData(data) {
    if (!data || !data.members || !Array.isArray(data.members)) {
      throw new Error('Invalid backup data format');
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      db.exec('DELETE FROM water_logs;');
      db.exec('DELETE FROM turn_events;');
      db.exec('DELETE FROM members;');
      db.exec('DELETE FROM settings;');

      const insertMember = db.prepare(`
        INSERT INTO members (id, name, nickname, color, emoji, is_active, order_index, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      data.members.forEach(m => {
        insertMember.run(m.id, m.name, m.nickname || '', m.color || '#3b82f6', m.emoji || '💧', m.is_active !== undefined ? m.is_active : 1, m.order_index || 0, m.created_at || new Date().toISOString());
      });

      if (data.settings && Array.isArray(data.settings)) {
        const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        data.settings.forEach(s => {
          insertSetting.run(s.key, s.value);
        });
      }

      if (data.logs && Array.isArray(data.logs)) {
        const insertLog = db.prepare(`
          INSERT INTO water_logs (id, member_id, quantity, litres, source, cost, paid_by_member_id, notes, was_turn, is_confirmed, confirmed_by, confirmed_at, logged_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        data.logs.forEach(l => {
          insertLog.run(
            l.id,
            l.member_id,
            l.quantity,
            l.litres,
            l.source || '',
            l.cost || 0,
            l.paid_by_member_id,
            l.notes || '',
            l.was_turn !== undefined ? l.was_turn : 1,
            l.is_confirmed !== undefined ? l.is_confirmed : 1,
            l.confirmed_by || null,
            l.confirmed_at || null,
            l.logged_at
          );
        });
      }

      if (data.events && Array.isArray(data.events)) {
        const insertEvent = db.prepare(`
          INSERT INTO turn_events (id, event_type, member_id, target_member_id, notes, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        data.events.forEach(e => {
          insertEvent.run(e.id, e.event_type, e.member_id, e.target_member_id, e.notes || '', e.created_at);
        });
      }

      db.exec('COMMIT;');
      return this.getRoomSummary();
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  },

  saveDemoSnapshot() {
    this._demoBaselineSnapshot = this.exportAllData();
    return this._demoBaselineSnapshot;
  },

  restoreDemoSnapshot() {
    const adminHash = this.getSetting('admin_pin_hash');
    const adminSalt = this.getSetting('admin_pin_salt');

    if (this._demoBaselineSnapshot) {
      this.importAllData(this._demoBaselineSnapshot);
      this._demoBaselineSnapshot = null;
    } else {
      this.resetToDefault();
    }

    // Always guarantee real admin credentials are intact
    if (adminHash && adminSalt) {
      this.setSetting('admin_pin_hash', adminHash);
      this.setSetting('admin_pin_salt', adminSalt);
    }

    return this.getRoomSummary();
  },

  resetToDefault() {
    const adminHash = this.getSetting('admin_pin_hash');
    const adminSalt = this.getSetting('admin_pin_salt');

    db.exec('BEGIN TRANSACTION;');
    try {
      db.exec('DELETE FROM water_logs;');
      db.exec('DELETE FROM turn_events;');
      db.exec('DELETE FROM members;');

      const insertMember = db.prepare(
        'INSERT INTO members (name, nickname, color, emoji, is_active, order_index) VALUES (?, ?, ?, ?, 1, ?)'
      );
      const defaults = [
        { name: 'Rahul', nickname: 'Bhai', color: '#3b82f6', emoji: '😎', order: 0 },
        { name: 'Aman', nickname: 'Sharmaji', color: '#10b981', emoji: '💪', order: 1 },
        { name: 'Rohan', nickname: 'Chintu', color: '#8b5cf6', emoji: '⚡', order: 2 },
        { name: 'Vikram', nickname: 'Boss', color: '#f59e0b', emoji: '👑', order: 3 }
      ];

      defaults.forEach((m) => {
        insertMember.run(m.name, m.nickname, m.color, m.emoji, m.order);
      });

      const firstMember = db.prepare('SELECT id FROM members ORDER BY order_index ASC LIMIT 1').get();
      if (firstMember) {
        this.setSetting('current_turn_member_id', String(firstMember.id));
      }

      this.setSetting('room_name', 'Room 304 Hydration Club');
      this.setSetting('can_status', 'full');
      this.setSetting('rotation_mode', 'round_robin');
      this.setSetting('default_can_litres', '20');

      if (adminHash && adminSalt) {
        this.setSetting('admin_pin_hash', adminHash);
        this.setSetting('admin_pin_salt', adminSalt);
      }

      // Sample verified log
      if (firstMember) {
        db.prepare(`
          INSERT INTO water_logs (member_id, quantity, litres, source, cost, paid_by_member_id, notes, was_turn, is_confirmed, confirmed_by, confirmed_at)
          VALUES (?, 1, 20, 'Hostel Cooler', 0, ?, 'Chilled jar from 2nd floor', 1, 1, 'Admin', CURRENT_TIMESTAMP)
        `).run(firstMember.id, firstMember.id);
      }

      db.exec('COMMIT;');
      return this.getRoomSummary();
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }
  }
};

module.exports = Database;
