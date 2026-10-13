/**
 * PaniPari - Database Layer
 * Supports:
 * 1. Render PostgreSQL Cloud Database (via DATABASE_URL or PGHOST in .env)
 * 2. SQLite local database (automatic fallback via node:sqlite)
 *
 * Tracks Member Presence:
 * - Active / Present: is_active = 1, is_deleted = 0
 * - Away / Vacation:  is_active = 0, is_deleted = 0
 * - Archived / Former: is_deleted = 1, deleted_at = TIMESTAMP
 *
 * Turns and historical water logs are permanently preserved across soft-deletions.
 */

const path = require('path');
const fs = require('fs');

// Automatically load .env before resolving database configuration
const possibleEnvPaths = [
  path.join(__dirname, '.env'),
  path.join(__dirname, '..', '.env')
];
for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(envPath);
    } catch (e) {
      // Ignore
    }
  }
}

// In-memory cache for fast, synchronous settings retrieval
const cachedSettings = {};

let isPostgres = false;
let pgPool = null;
let sqliteDb = null;

// Determine if PostgreSQL credentials are provided
const pgConnectionString = process.env.DATABASE_URL;
const pgHost = process.env.PGHOST || process.env.DB_HOST;

if (pgConnectionString || pgHost) {
  const { Pool } = require('pg');
  const connStr = pgConnectionString || `postgresql://${process.env.PGUSER || 'timpass_water_turn_user'}:${process.env.PGPASSWORD}@${pgHost}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'timpass_water_turn'}`;
  
  const isExternal = connStr.includes('render.com') || connStr.includes('oregon-postgres');
  pgPool = new Pool({
    connectionString: connStr,
    ssl: isExternal ? { rejectUnauthorized: false } : (process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false)
  });
  isPostgres = true;
  console.log(`[DB] Using Render Cloud PostgreSQL Database: ${process.env.PGDATABASE || 'timpass_water_turn'}`);
} else {
  // SQLite Fallback
  const { DatabaseSync } = require('node:sqlite');
  function resolveSqlitePath() {
    const envVal = process.env.DATABASE_PATH || process.env.DB_PATH || process.env.SQLITE_DB_PATH;
    if (!envVal || !envVal.trim()) {
      const defaultDataDir = path.join(__dirname, 'data');
      if (!fs.existsSync(defaultDataDir)) fs.mkdirSync(defaultDataDir, { recursive: true });
      return path.join(defaultDataDir, 'water_turns.db');
    }
    const trimmed = envVal.trim();
    if (path.isAbsolute(trimmed)) {
      const parent = path.dirname(trimmed);
      if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
      return trimmed;
    }
    const backendCandidate = path.resolve(__dirname, trimmed);
    const cwdCandidate = path.resolve(process.cwd(), trimmed);
    if (fs.existsSync(backendCandidate)) return backendCandidate;
    if (fs.existsSync(cwdCandidate)) return cwdCandidate;
    const parent = path.dirname(backendCandidate);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    return backendCandidate;
  }

  const dbPath = resolveSqlitePath();
  sqliteDb = new DatabaseSync(dbPath);
  sqliteDb.exec('PRAGMA journal_mode = WAL;');
  sqliteDb.exec('PRAGMA foreign_keys = ON;');
  isPostgres = false;
  console.log(`[DB] Using Local SQLite Database: ${dbPath}`);
}

// Low-level query helper
async function query(sql, params = []) {
  if (isPostgres) {
    const res = await pgPool.query(sql, params);
    return res.rows;
  } else {
    // SQLite: Convert $1, $2, ... to ? for SQLite compatibility if needed
    const sqliteSql = sql.replace(/\$\d+/g, '?');
    const trimmed = sqliteSql.trim();
    if (trimmed.startsWith('SELECT') || trimmed.includes('RETURNING') || trimmed.startsWith('PRAGMA')) {
      return sqliteDb.prepare(sqliteSql).all(...params);
    } else {
      const stmt = sqliteDb.prepare(sqliteSql);
      const res = stmt.run(...params);
      return [{ ...res, id: res.lastInsertRowid }];
    }
  }
}

// Single-row query helper
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows && rows.length > 0 ? rows[0] : null;
}

// Table Initialization & Auto-Migration
let initPromise = null;
async function initDatabase() {
  if (isPostgres) {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS members (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        nickname TEXT DEFAULT '',
        color TEXT NOT NULL DEFAULT '#3b82f6',
        emoji TEXT NOT NULL DEFAULT '💧',
        is_active INTEGER NOT NULL DEFAULT 1,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        deleted_at TIMESTAMPTZ DEFAULT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS water_logs (
        id SERIAL PRIMARY KEY,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        quantity REAL NOT NULL DEFAULT 1.0,
        litres REAL NOT NULL DEFAULT 20.0,
        source TEXT DEFAULT 'Water Cooler',
        cost REAL NOT NULL DEFAULT 0.0,
        paid_by_member_id INTEGER,
        notes TEXT DEFAULT '',
        was_turn INTEGER NOT NULL DEFAULT 1,
        is_confirmed INTEGER NOT NULL DEFAULT 1,
        confirmed_by TEXT DEFAULT NULL,
        confirmed_at TIMESTAMPTZ DEFAULT NULL,
        logged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS turn_events (
        id SERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        member_id INTEGER,
        target_member_id INTEGER,
        notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } else {
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        nickname TEXT DEFAULT '',
        color TEXT NOT NULL DEFAULT '#3b82f6',
        emoji TEXT NOT NULL DEFAULT '💧',
        is_active INTEGER NOT NULL DEFAULT 1,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT DEFAULT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS water_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
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
        logged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS turn_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        member_id INTEGER,
        target_member_id INTEGER,
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  // Load existing settings into cache
  const setRows = await query('SELECT key, value FROM settings');
  setRows.forEach(r => {
    cachedSettings[r.key] = r.value;
  });

  // Seed default settings if missing
  const setSetting = async (k, v) => {
    cachedSettings[k] = String(v);
    if (isPostgres) {
      await pgPool.query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;',
        [k, String(v)]
      );
    } else {
      sqliteDb.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);').run(k, String(v));
    }
  };

  if (!cachedSettings['room_name']) await setSetting('room_name', 'Room 304 Hydration Club');
  if (!cachedSettings['can_status']) await setSetting('can_status', 'full');
  if (!cachedSettings['rotation_mode']) await setSetting('rotation_mode', 'round_robin');
  if (!cachedSettings['default_can_litres']) await setSetting('default_can_litres', '20');

  // Check if members table is empty
  const countRow = await queryOne('SELECT COUNT(*) as count FROM members');
  const count = Number(countRow ? countRow.count : 0);

  if (count === 0) {
    // If SQLite database exists with data, seamlessly migrate it into Postgres
    let migrated = false;
    const sqlitePath = path.join(__dirname, 'data', 'water_turns.db');
    if (isPostgres && fs.existsSync(sqlitePath)) {
      try {
        const { DatabaseSync } = require('node:sqlite');
        const oldSqlite = new DatabaseSync(sqlitePath);
        const oldMembers = oldSqlite.prepare('SELECT * FROM members ORDER BY id ASC').all();
        if (oldMembers && oldMembers.length > 0) {
          console.log(`[DB Migration] Migrating ${oldMembers.length} members from SQLite to PostgreSQL...`);
          for (const m of oldMembers) {
            await query(
              'INSERT INTO members (name, nickname, color, emoji, is_active, is_deleted, order_index) VALUES ($1, $2, $3, $4, $5, $6, $7)',
              [m.name, m.nickname || '', m.color || '#3b82f6', m.emoji || '💧', m.is_active, m.is_deleted || 0, m.order_index]
            );
          }
          const oldSettings = oldSqlite.prepare('SELECT * FROM settings').all();
          for (const s of oldSettings) {
            await setSetting(s.key, s.value);
          }
          const oldLogs = oldSqlite.prepare('SELECT * FROM water_logs').all();
          for (const l of oldLogs) {
            await query(
              'INSERT INTO water_logs (member_id, quantity, litres, source, cost, notes, was_turn, is_confirmed, confirmed_by, confirmed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
              [l.member_id, l.quantity, l.litres, l.source || '', l.cost || 0, l.notes || '', l.was_turn || 1, l.is_confirmed || 1, l.confirmed_by || null, l.confirmed_at || null]
            );
          }
          migrated = true;
          console.log('[DB Migration] Seamlessly migrated all data to PostgreSQL!');
        }
      } catch (migErr) {
        console.warn('[DB Migration] Note:', migErr.message);
      }
    }

    if (!migrated) {
      const defaults = [
        { name: 'Rahul', nickname: 'Bhai', color: '#3b82f6', emoji: '😎', order: 0 },
        { name: 'Aman', nickname: 'Sharmaji', color: '#10b981', emoji: '💪', order: 1 },
        { name: 'Rohan', nickname: 'Chintu', color: '#8b5cf6', emoji: '⚡', order: 2 },
        { name: 'Vikram', nickname: 'Boss', color: '#f59e0b', emoji: '👑', order: 3 }
      ];

      for (const m of defaults) {
        if (isPostgres) {
          await query(
            'INSERT INTO members (name, nickname, color, emoji, is_active, is_deleted, order_index) VALUES ($1, $2, $3, $4, 1, 0, $5)',
            [m.name, m.nickname, m.color, m.emoji, m.order]
          );
        } else {
          sqliteDb.prepare(
            'INSERT INTO members (name, nickname, color, emoji, is_active, is_deleted, order_index) VALUES (?, ?, ?, ?, 1, 0, ?)'
          ).run(m.name, m.nickname, m.color, m.emoji, m.order);
        }
      }
    }
  }

  // Ensure current_turn_member_id points to an active member
  const firstActive = await queryOne('SELECT id FROM members WHERE is_active = 1 AND is_deleted = 0 ORDER BY order_index ASC LIMIT 1');
  if (firstActive && !cachedSettings['current_turn_member_id']) {
    await setSetting('current_turn_member_id', String(firstActive.id));
  }
}

function ensureReady() {
  if (!initPromise) {
    initPromise = initDatabase().catch(err => {
      console.error('[DB Init Error]:', err);
      throw err;
    });
  }
  return initPromise;
}

// Start DB init immediately in background
ensureReady();

// ================= DATABASE INTERFACE =================
const Database = {
  async init() {
    return ensureReady();
  },

  // Settings
  getSetting(key) {
    return cachedSettings[key] !== undefined ? cachedSettings[key] : null;
  },

  async getSettingAsync(key) {
    await ensureReady();
    return this.getSetting(key);
  },

  async setSetting(key, value) {
    await ensureReady();
    cachedSettings[key] = String(value);
    if (isPostgres) {
      await pgPool.query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;',
        [key, String(value)]
      );
    } else {
      sqliteDb.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);').run(key, String(value));
    }
  },

  getAllSettings() {
    return { ...cachedSettings };
  },

  // Members Queries
  async getAllMembers(includeDeleted = false) {
    await ensureReady();
    if (includeDeleted) {
      return query('SELECT * FROM members ORDER BY is_deleted ASC, order_index ASC, id ASC');
    }
    return query('SELECT * FROM members WHERE is_deleted = 0 ORDER BY order_index ASC, id ASC');
  },

  async getActiveMembers() {
    await ensureReady();
    return query('SELECT * FROM members WHERE is_active = 1 AND is_deleted = 0 ORDER BY order_index ASC, id ASC');
  },

  async getDeletedMembers() {
    await ensureReady();
    return query('SELECT * FROM members WHERE is_deleted = 1 ORDER BY deleted_at DESC, id DESC');
  },

  async getMemberById(id) {
    await ensureReady();
    return queryOne('SELECT * FROM members WHERE id = $1', [id]);
  },

  async addMember(name, nickname, color, emoji) {
    await ensureReady();
    const maxRow = await queryOne('SELECT COALESCE(MAX(order_index), -1) as max_ord FROM members WHERE is_deleted = 0');
    const nextOrder = Number(maxRow ? maxRow.max_ord : -1) + 1;

    let newMember;
    if (isPostgres) {
      const rows = await query(
        'INSERT INTO members (name, nickname, color, emoji, is_active, is_deleted, order_index) VALUES ($1, $2, $3, $4, 1, 0, $5) RETURNING *',
        [name.trim(), (nickname || '').trim(), color || '#3b82f6', emoji || '💧', nextOrder]
      );
      newMember = rows[0];
    } else {
      const res = sqliteDb.prepare(
        'INSERT INTO members (name, nickname, color, emoji, is_active, is_deleted, order_index) VALUES (?, ?, ?, ?, 1, 0, ?)'
      ).run(name.trim(), (nickname || '').trim(), color || '#3b82f6', emoji || '💧', nextOrder);
      newMember = await this.getMemberById(res.lastInsertRowid);
    }

    const currentTurnId = this.getSetting('current_turn_member_id');
    if (!currentTurnId || !(await this.getMemberById(Number(currentTurnId)))) {
      await this.setSetting('current_turn_member_id', String(newMember.id));
    }
    return newMember;
  },

  async updateMember(id, fields) {
    await ensureReady();
    const member = await this.getMemberById(id);
    if (!member) return null;

    const name = fields.name !== undefined ? fields.name.trim() : member.name;
    const nickname = fields.nickname !== undefined ? fields.nickname.trim() : member.nickname;
    const color = fields.color !== undefined ? fields.color : member.color;
    const emoji = fields.emoji !== undefined ? fields.emoji : member.emoji;
    const is_active = fields.is_active !== undefined ? (fields.is_active ? 1 : 0) : member.is_active;

    await query(
      'UPDATE members SET name = $1, nickname = $2, color = $3, emoji = $4, is_active = $5 WHERE id = $6',
      [name, nickname, color, emoji, is_active, id]
    );

    if (is_active === 0 && Number(this.getSetting('current_turn_member_id')) === Number(id)) {
      await this.advanceTurn();
    }

    return this.getMemberById(id);
  },

  async deleteMember(id) {
    await ensureReady();
    const member = await this.getMemberById(id);
    if (!member) return false;

    const currentTurnId = Number(this.getSetting('current_turn_member_id'));
    if (currentTurnId === Number(id)) {
      await this.advanceTurn();
    }

    // Soft Delete: Preserves all past water logs & turns safely in DB
    await query(
      'UPDATE members SET is_deleted = 1, is_active = 0, deleted_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );

    await query(
      'INSERT INTO turn_events (event_type, member_id, notes) VALUES ($1, $2, $3)',
      ['deleted', id, `Member ${member.name} archived (turns preserved)`]
    );

    return true;
  },

  async restoreMember(id) {
    await ensureReady();
    const member = await this.getMemberById(id);
    if (!member) return null;

    const maxRow = await queryOne('SELECT COALESCE(MAX(order_index), -1) as max_ord FROM members WHERE is_deleted = 0');
    const nextOrder = Number(maxRow ? maxRow.max_ord : -1) + 1;

    await query(
      'UPDATE members SET is_deleted = 0, is_active = 1, deleted_at = NULL, order_index = $1 WHERE id = $2',
      [nextOrder, id]
    );

    await query(
      'INSERT INTO turn_events (event_type, member_id, notes) VALUES ($1, $2, $3)',
      ['restored', id, `Member ${member.name} restored to active rotation`]
    );

    const currentTurn = await this.getCurrentTurnMember();
    if (!currentTurn) {
      await this.setSetting('current_turn_member_id', String(id));
    }

    return this.getMemberById(id);
  },

  async reorderMembers(orderedIds) {
    await ensureReady();
    for (let idx = 0; idx < orderedIds.length; idx++) {
      await query('UPDATE members SET order_index = $1 WHERE id = $2', [idx, orderedIds[idx]]);
    }
    return this.getAllMembers(false);
  },

  // Turn Logic
  async getCurrentTurnMember() {
    await ensureReady();
    let currentId = Number(this.getSetting('current_turn_member_id'));
    let member = currentId ? await this.getMemberById(currentId) : null;

    if (!member || member.is_active !== 1 || member.is_deleted === 1) {
      const active = await this.getActiveMembers();
      if (active.length > 0) {
        currentId = active[0].id;
        await this.setSetting('current_turn_member_id', String(currentId));
        member = active[0];
      } else {
        return null;
      }
    }
    return member;
  },

  async getNextTurnMember() {
    await ensureReady();
    const current = await this.getCurrentTurnMember();
    if (!current) return null;

    const mode = this.getSetting('rotation_mode') || 'round_robin';
    const active = await this.getActiveMembers();
    if (active.length <= 1) return current;

    if (mode === 'round_robin') {
      const currentIndex = active.findIndex(m => m.id === current.id);
      const nextIndex = (currentIndex + 1) % active.length;
      return active[nextIndex];
    } else {
      // Least Count Mode
      const stats = await this.getMemberStats();
      const otherActive = active.filter(m => m.id !== current.id);
      otherActive.sort((a, b) => {
        const aCount = stats[a.id] ? stats[a.id].total_cans : 0;
        const bCount = stats[b.id] ? stats[b.id].total_cans : 0;
        return aCount - bCount;
      });
      return otherActive[0] || current;
    }
  },

  async getTurnQueue() {
    await ensureReady();
    const current = await this.getCurrentTurnMember();
    const active = await this.getActiveMembers();
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
      const stats = await this.getMemberStats();
      const rest = active.filter(m => m.id !== current.id).sort((a, b) => {
        const aCount = stats[a.id] ? stats[a.id].total_cans : 0;
        const bCount = stats[b.id] ? stats[b.id].total_cans : 0;
        return aCount - bCount;
      });
      return [current, ...rest];
    }
  },

  async advanceTurn() {
    await ensureReady();
    const nextMember = await this.getNextTurnMember();
    if (nextMember) {
      await this.setSetting('current_turn_member_id', String(nextMember.id));
      return nextMember;
    }
    return null;
  },

  async skipCurrentTurn(reason = '') {
    await ensureReady();
    const current = await this.getCurrentTurnMember();
    const next = await this.getNextTurnMember();
    if (!current || !next) return null;

    await query(
      'INSERT INTO turn_events (event_type, member_id, target_member_id, notes) VALUES ($1, $2, $3, $4)',
      ['skipped', current.id, next.id, reason || 'Turn skipped']
    );

    await this.setSetting('current_turn_member_id', String(next.id));
    return { skipped: current, next };
  },

  async swapTurn(targetMemberId, reason = '') {
    await ensureReady();
    const current = await this.getCurrentTurnMember();
    const target = await this.getMemberById(targetMemberId);
    if (!current || !target || !target.is_active || target.is_deleted) return null;

    await query(
      'INSERT INTO turn_events (event_type, member_id, target_member_id, notes) VALUES ($1, $2, $3, $4)',
      ['swapped', current.id, target.id, reason || 'Turn swapped']
    );

    await this.setSetting('current_turn_member_id', String(target.id));
    return { previous: current, current: target };
  },

  async setSpecificTurn(memberId) {
    await ensureReady();
    const member = await this.getMemberById(memberId);
    if (!member || !member.is_active || member.is_deleted) return null;
    await this.setSetting('current_turn_member_id', String(member.id));
    return member;
  },

  // Water Logs
  async logWater({ memberId, quantity = 1, litres = 20, source = 'Water Cooler', cost = 0, paidByMemberId = null, notes = '', wasTurn = 1, isConfirmed = 1, confirmedBy = null }) {
    await ensureReady();
    const member = await this.getMemberById(memberId);
    if (!member) throw new Error('Member not found');

    const confirmedFlag = (isConfirmed === 1 || isConfirmed === true) ? 1 : 0;
    const confirmedTime = confirmedFlag === 1 ? new Date().toISOString() : null;
    const confirmedAuthor = confirmedFlag === 1 ? (confirmedBy || 'Admin') : null;

    let logId;
    if (isPostgres) {
      const rows = await query(
        `INSERT INTO water_logs (member_id, quantity, litres, source, cost, paid_by_member_id, notes, was_turn, is_confirmed, confirmed_by, confirmed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [memberId, Number(quantity), Number(litres), source, Number(cost), paidByMemberId ? Number(paidByMemberId) : memberId, notes, wasTurn ? 1 : 0, confirmedFlag, confirmedAuthor, confirmedTime]
      );
      logId = rows[0].id;
    } else {
      const res = sqliteDb.prepare(`
        INSERT INTO water_logs (member_id, quantity, litres, source, cost, paid_by_member_id, notes, was_turn, is_confirmed, confirmed_by, confirmed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(memberId, Number(quantity), Number(litres), source, Number(cost), paidByMemberId ? Number(paidByMemberId) : memberId, notes, wasTurn ? 1 : 0, confirmedFlag, confirmedAuthor, confirmedTime);
      logId = res.lastInsertRowid;
    }

    await query(
      'INSERT INTO turn_events (event_type, member_id, notes) VALUES ($1, $2, $3)',
      ['completed', memberId, `Brought ${quantity} can(s) (${litres}L) from ${source}${confirmedFlag === 0 ? ' [Pending Admin confirmation]' : ''}`]
    );

    const current = await this.getCurrentTurnMember();
    if (wasTurn || (current && current.id === Number(memberId))) {
      await this.advanceTurn();
    }

    await this.setSetting('can_status', 'full');
    await this.setSetting('last_water_time', new Date().toISOString());

    return this.getLogById(logId);
  },

  async confirmWaterLog(id, confirmedBy = 'Admin') {
    await ensureReady();
    const now = new Date().toISOString();
    await query(
      'UPDATE water_logs SET is_confirmed = 1, confirmed_by = $1, confirmed_at = $2 WHERE id = $3',
      [confirmedBy, now, id]
    );
    return this.getLogById(id);
  },

  async confirmAllLogs(confirmedBy = 'Admin') {
    await ensureReady();
    const now = new Date().toISOString();
    await query(
      'UPDATE water_logs SET is_confirmed = 1, confirmed_by = $1, confirmed_at = $2 WHERE is_confirmed = 0',
      [confirmedBy, now]
    );
    return true;
  },

  async getUnconfirmedLogs() {
    await ensureReady();
    return query(`
      SELECT l.*, m.name as member_name, m.color as member_color, m.emoji as member_emoji
      FROM water_logs l
      LEFT JOIN members m ON l.member_id = m.id
      WHERE l.is_confirmed = 0
      ORDER BY l.logged_at DESC, l.id DESC
    `);
  },

  async getMemberDetails(memberId) {
    await ensureReady();
    const member = await this.getMemberById(Number(memberId));
    if (!member) return null;

    const stats = await this.getMemberStats(true);
    const memberStat = stats[memberId] || {
      member_id: member.id,
      name: member.name,
      nickname: member.nickname,
      color: member.color,
      emoji: member.emoji,
      is_active: member.is_active,
      is_deleted: member.is_deleted || 0,
      deleted_at: member.deleted_at || null,
      total_cans: 0,
      total_litres: 0,
      total_spent: 0,
      turn_count: 0,
      last_brought_at: null,
      total_money_paid: 0
    };

    const totalLogsRow = await queryOne('SELECT COALESCE(SUM(quantity), 0) as cans, COALESCE(SUM(litres), 0) as litres FROM water_logs');
    const totalCans = Number(totalLogsRow ? totalLogsRow.cans : 0);
    const activeMembers = await this.getActiveMembers();
    const avgCans = activeMembers.length > 0 ? (totalCans / activeMembers.length) : 0;
    const delta = (!member.is_deleted && member.is_active) ? Number((memberStat.total_cans - avgCans).toFixed(1)) : 0;
    const contributionPercent = totalCans > 0 ? Number(((memberStat.total_cans / totalCans) * 100).toFixed(1)) : 0;

    const currentTurn = await this.getCurrentTurnMember();
    const queue = await this.getTurnQueue();
    const queueIndex = queue.findIndex(m => m.id === Number(memberId));

    let queueStatus = 'In Queue';
    if (member.is_deleted) {
      queueStatus = 'Former Roommate (Archived)';
    } else if (!member.is_active) {
      queueStatus = 'On Vacation / Away';
    } else if (currentTurn && currentTurn.id === Number(memberId)) {
      queueStatus = 'Current Turn (Now)';
    } else if (queueIndex === 1) {
      queueStatus = 'Up Next';
    } else if (queueIndex > 1) {
      queueStatus = `#${queueIndex + 1} in Line`;
    }

    const recentLogs = await query(`
      SELECT l.*, p.name as paid_by_name
      FROM water_logs l
      LEFT JOIN members p ON l.paid_by_member_id = p.id
      WHERE l.member_id = $1
      ORDER BY l.logged_at DESC, l.id DESC
      LIMIT 10
    `, [memberId]);

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

  async getLogById(id) {
    await ensureReady();
    return queryOne(`
      SELECT l.*, m.name as member_name, m.color as member_color, m.emoji as member_emoji,
             m.is_deleted as member_is_deleted, p.name as paid_by_name
      FROM water_logs l
      LEFT JOIN members m ON l.member_id = m.id
      LEFT JOIN members p ON l.paid_by_member_id = p.id
      WHERE l.id = $1
    `, [id]);
  },

  async getRecentLogs(limit = 50, memberId = null) {
    await ensureReady();
    let sql = `
      SELECT l.*, m.name as member_name, m.color as member_color, m.emoji as member_emoji,
             m.is_deleted as member_is_deleted, p.name as paid_by_name
      FROM water_logs l
      LEFT JOIN members m ON l.member_id = m.id
      LEFT JOIN members p ON l.paid_by_member_id = p.id
    `;
    const params = [];
    if (memberId) {
      sql += ' WHERE l.member_id = $1 ';
      params.push(memberId);
      sql += ` ORDER BY l.logged_at DESC, l.id DESC LIMIT $2 `;
      params.push(limit);
    } else {
      sql += ` ORDER BY l.logged_at DESC, l.id DESC LIMIT $1 `;
      params.push(limit);
    }
    return query(sql, params);
  },

  async deleteLog(id) {
    await ensureReady();
    await query('DELETE FROM water_logs WHERE id = $1', [id]);
    return true;
  },

  // Stats & Summaries
  async getMemberStats(includeDeleted = false) {
    await ensureReady();
    const members = await this.getAllMembers(includeDeleted);
    const stats = {};

    members.forEach(m => {
      stats[m.id] = {
        member_id: m.id,
        name: m.name,
        nickname: m.nickname,
        color: m.color,
        emoji: m.emoji,
        is_active: m.is_active,
        is_deleted: m.is_deleted || 0,
        deleted_at: m.deleted_at || null,
        total_cans: 0,
        total_litres: 0,
        total_spent: 0,
        turn_count: 0,
        last_brought_at: null,
        total_money_paid: 0
      };
    });

    const rows = await query(`
      SELECT member_id,
             SUM(quantity) as total_cans,
             SUM(litres) as total_litres,
             SUM(cost) as total_spent,
             COUNT(*) as turn_count,
             MAX(logged_at) as last_brought_at
      FROM water_logs
      GROUP BY member_id
    `);

    rows.forEach(r => {
      if (stats[r.member_id]) {
        stats[r.member_id].total_cans = Number(r.total_cans || 0);
        stats[r.member_id].total_litres = Number(r.total_litres || 0);
        stats[r.member_id].total_spent = Number(r.total_spent || 0);
        stats[r.member_id].turn_count = Number(r.turn_count || 0);
        stats[r.member_id].last_brought_at = r.last_brought_at;
      }
    });

    const paidRows = await query(`
      SELECT paid_by_member_id, SUM(cost) as total_paid
      FROM water_logs
      WHERE paid_by_member_id IS NOT NULL AND cost > 0
      GROUP BY paid_by_member_id
    `);

    paidRows.forEach(p => {
      if (stats[p.paid_by_member_id]) {
        stats[p.paid_by_member_id].total_money_paid = Number(p.total_paid || 0);
      }
    });

    return stats;
  },

  async getRoomSummary() {
    await ensureReady();
    const totalRow = await queryOne('SELECT COUNT(*) as count, COALESCE(SUM(quantity), 0) as cans, COALESCE(SUM(litres), 0) as litres, COALESCE(SUM(cost), 0) as cost FROM water_logs');
    const unconfirmedRow = await queryOne('SELECT COUNT(*) as count FROM water_logs WHERE is_confirmed = 0');
    const deletedCountRow = await queryOne('SELECT COUNT(*) as count FROM members WHERE is_deleted = 1');

    const currentTurn = await this.getCurrentTurnMember();
    const nextTurn = await this.getNextTurnMember();
    const queue = await this.getTurnQueue();
    const settings = this.getAllSettings();
    const statsObj = await this.getMemberStats(false);
    const stats = Object.values(statsObj);

    const totalCans = Number(totalRow ? totalRow.cans : 0);
    const activeStats = stats.filter(s => s.is_active);
    const avgCans = activeStats.length > 0 ? (totalCans / activeStats.length) : 0;

    stats.forEach(s => {
      s.delta_from_avg = s.is_active ? Number((s.total_cans - avgCans).toFixed(1)) : 0;
    });

    return {
      settings,
      currentTurn,
      nextTurn,
      queue,
      stats,
      unconfirmedCount: Number(unconfirmedRow ? unconfirmedRow.count : 0),
      deletedMembersCount: Number(deletedCountRow ? deletedCountRow.count : 0),
      totals: {
        totalTurns: Number(totalRow ? totalRow.count : 0),
        totalCans: totalCans,
        totalLitres: Number(totalRow ? totalRow.litres : 0),
        totalCost: Number(totalRow ? totalRow.cost : 0),
        averageCansPerPerson: Number(avgCans.toFixed(1))
      }
    };
  },

  // Export / Backup
  async exportAllData() {
    await ensureReady();
    const members = await query('SELECT * FROM members ORDER BY id ASC');
    const settings = await query('SELECT * FROM settings ORDER BY key ASC');
    const logs = await query('SELECT * FROM water_logs ORDER BY id ASC');
    const events = await query('SELECT * FROM turn_events ORDER BY id ASC');
    return {
      version: 2,
      database_engine: isPostgres ? 'postgresql' : 'sqlite',
      exported_at: new Date().toISOString(),
      members,
      settings,
      logs,
      events
    };
  },

  async importAllData(data) {
    await ensureReady();
    if (!data || !data.members || !Array.isArray(data.members)) {
      throw new Error('Invalid backup data format');
    }

    await query('DELETE FROM water_logs');
    await query('DELETE FROM turn_events');
    await query('DELETE FROM members');
    await query('DELETE FROM settings');

    for (const m of data.members) {
      await query(
        'INSERT INTO members (id, name, nickname, color, emoji, is_active, is_deleted, deleted_at, order_index, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [m.id, m.name, m.nickname || '', m.color || '#3b82f6', m.emoji || '💧', m.is_active !== undefined ? m.is_active : 1, m.is_deleted || 0, m.deleted_at || null, m.order_index || 0, m.created_at || new Date().toISOString()]
      );
    }

    if (data.settings && Array.isArray(data.settings)) {
      for (const s of data.settings) {
        await this.setSetting(s.key, s.value);
      }
    }

    if (data.logs && Array.isArray(data.logs)) {
      for (const l of data.logs) {
        await query(
          'INSERT INTO water_logs (id, member_id, quantity, litres, source, cost, paid_by_member_id, notes, was_turn, is_confirmed, confirmed_by, confirmed_at, logged_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
          [l.id, l.member_id, l.quantity, l.litres, l.source || '', l.cost || 0, l.paid_by_member_id, l.notes || '', l.was_turn !== undefined ? l.was_turn : 1, l.is_confirmed !== undefined ? l.is_confirmed : 1, l.confirmed_by || null, l.confirmed_at || null, l.logged_at]
        );
      }
    }

    if (data.events && Array.isArray(data.events)) {
      for (const e of data.events) {
        await query(
          'INSERT INTO turn_events (id, event_type, member_id, target_member_id, notes, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [e.id, e.event_type, e.member_id, e.target_member_id, e.notes || '', e.created_at]
        );
      }
    }

    return this.getRoomSummary();
  },

  async saveDemoSnapshot() {
    this._demoBaselineSnapshot = await this.exportAllData();
    return this._demoBaselineSnapshot;
  },

  async restoreDemoSnapshot() {
    const adminHash = this.getSetting('admin_pin_hash');
    const adminSalt = this.getSetting('admin_pin_salt');

    if (this._demoBaselineSnapshot) {
      await this.importAllData(this._demoBaselineSnapshot);
      this._demoBaselineSnapshot = null;
    } else {
      await this.resetToDefault();
    }

    if (adminHash && adminSalt) {
      await this.setSetting('admin_pin_hash', adminHash);
      await this.setSetting('admin_pin_salt', adminSalt);
    }

    return this.getRoomSummary();
  },

  async resetToDefault() {
    const adminHash = this.getSetting('admin_pin_hash');
    const adminSalt = this.getSetting('admin_pin_salt');

    await query('DELETE FROM water_logs');
    await query('DELETE FROM turn_events');
    await query('DELETE FROM members');

    const defaults = [
      { name: 'Rahul', nickname: 'Bhai', color: '#3b82f6', emoji: '😎', order: 0 },
      { name: 'Aman', nickname: 'Sharmaji', color: '#10b981', emoji: '💪', order: 1 },
      { name: 'Rohan', nickname: 'Chintu', color: '#8b5cf6', emoji: '⚡', order: 2 },
      { name: 'Vikram', nickname: 'Boss', color: '#f59e0b', emoji: '👑', order: 3 }
    ];

    for (const m of defaults) {
      await query(
        'INSERT INTO members (name, nickname, color, emoji, is_active, is_deleted, order_index) VALUES ($1, $2, $3, $4, 1, 0, $5)',
        [m.name, m.nickname, m.color, m.emoji, m.order]
      );
    }

    const first = await queryOne('SELECT id FROM members ORDER BY order_index ASC LIMIT 1');
    if (first) {
      await this.setSetting('current_turn_member_id', String(first.id));
    }

    await this.setSetting('room_name', 'Room 304 Hydration Club');
    await this.setSetting('can_status', 'full');
    await this.setSetting('rotation_mode', 'round_robin');
    await this.setSetting('default_can_litres', '20');

    if (adminHash && adminSalt) {
      await this.setSetting('admin_pin_hash', adminHash);
      await this.setSetting('admin_pin_salt', adminSalt);
    }

    if (first) {
      await query(
        `INSERT INTO water_logs (member_id, quantity, litres, source, cost, paid_by_member_id, notes, was_turn, is_confirmed, confirmed_by, confirmed_at)
         VALUES ($1, 1, 20, 'Hostel Cooler', 0, $2, 'Chilled jar from 2nd floor', 1, 1, 'Admin', CURRENT_TIMESTAMP)`,
        [first.id, first.id]
      );
    }

    return this.getRoomSummary();
  }
};

module.exports = Database;
