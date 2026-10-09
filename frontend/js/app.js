// PaniPari - Room Water Turn Manager Client Application

const API_BASE = ''; // Same origin

// App State
let appState = {
  summary: null,
  logs: [],
  networkInfo: null,
  selectedQuantity: 1
};

// Admin Authentication State
let adminToken = localStorage.getItem('panipari_admin_token') || null;
let isAdmin = false;

// Helper: Get Authorization Headers for Fetch
function getAuthHeaders(extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (adminToken) {
    headers['Authorization'] = `Bearer ${adminToken}`;
  }
  return headers;
}

// Verify Admin Status with Backend
async function verifyAdminAuth() {
  if (!adminToken) {
    isAdmin = false;
    updateAdminUI();
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/auth/status`, {
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (json.success && json.data.isAdmin) {
      isAdmin = true;
    } else {
      isAdmin = false;
      adminToken = null;
      localStorage.removeItem('panipari_admin_token');
    }
  } catch (err) {
    console.warn('Could not verify admin token:', err);
    isAdmin = false;
  }
  updateAdminUI();
}

// Update Admin Elements in UI
function updateAdminUI() {
  const badge = document.getElementById('badgeAdminActive');
  const btnAuth = document.getElementById('btnAdminAuth');
  const btnAuthLabel = document.getElementById('adminAuthBtnLabel');

  if (badge) {
    badge.style.display = isAdmin ? 'inline-flex' : 'none';
  }

  if (btnAuth && btnAuthLabel) {
    if (isAdmin) {
      btnAuth.className = 'btn btn-primary btn-sm';
      btnAuthLabel.textContent = 'Admin (Logout)';
      btnAuth.title = 'Click to log out of Admin mode';
    } else {
      btnAuth.className = 'btn btn-secondary btn-sm';
      btnAuthLabel.textContent = 'Admin Login';
      btnAuth.title = 'Click to log in as Room Admin';
    }
  }
}

// Guard: Protect Actions that Require Admin
function requireAdminAction(callback, actionDescription = 'this action') {
  if (isAdmin) {
    callback();
  } else {
    showToast(`🔒 Admin PIN required to ${actionDescription}`, 'warning');
    const errBox = document.getElementById('adminLoginError');
    if (errBox) {
      errBox.textContent = `Admin access is required to ${actionDescription}. Please enter Admin PIN.`;
      errBox.style.display = 'block';
    }
    openModal('modalAdminLogin');
  }
}

// Web Audio synthesizer for celebration chime
function playWaterChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    
    // Play four notes (harmonic water ripple)
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);
      
      gain.gain.setValueAtTime(0.15, ctx.currentTime + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.08 + 0.35);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(ctx.currentTime + idx * 0.08);
      osc.stop(ctx.currentTime + idx * 0.08 + 0.35);
    });
  } catch (e) {
    console.log('Audio chime not available:', e);
  }
}

// Trigger Confetti
function launchConfetti() {
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 }
    });
  }
}

// Toast notification helper
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️'}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Helper: Format relative or clean date
function formatDateTime(isoString) {
  if (!isoString) return 'Never';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;

  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hr ago`;
  if (diffDays === 1) return `Yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
         date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ================= API CALLS =================

async function loadData() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    const json = await res.json();
    if (json.success) {
      appState.summary = json.data;
      renderApp();
    }
  } catch (err) {
    console.error('Error fetching room status:', err);
  }
}

async function loadLogs(memberId = null) {
  try {
    const url = memberId ? `${API_BASE}/api/logs?memberId=${memberId}` : `${API_BASE}/api/logs`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.success) {
      appState.logs = json.data;
      renderLogs();
    }
  } catch (err) {
    console.error('Error fetching logs:', err);
  }
}

async function loadNetworkInfo() {
  try {
    const res = await fetch(`${API_BASE}/api/system/network-info`);
    const json = await res.json();
    if (json.success) {
      appState.networkInfo = json.data;
    }
  } catch (err) {
    console.error('Error loading network info:', err);
  }
}

// ================= RENDER FUNCTIONS =================

function renderApp() {
  const { summary } = appState;
  if (!summary) return;

  const { settings, currentTurn, queue, stats, totals, unconfirmedCount } = summary;

  // 1. Header & Room Name
  const roomTitleElem = document.getElementById('roomNameHeader');
  if (roomTitleElem) {
    roomTitleElem.textContent = settings.room_name || 'Room Water Turn';
  }

  // 2. Pending Water Logs Banner
  renderPendingConfirmationBanner(unconfirmedCount || 0);

  // 3. Can Status Strip & Alert Banner
  renderCanStatus(settings.can_status, currentTurn);

  // 4. Hero Card (Current Turn)
  renderHero(currentTurn);

  // 5. Turn Queue (Next in line - with click for detailed profile)
  renderQueue(queue, settings.rotation_mode);

  // 6. Leaderboard / Fairness Stats
  renderFairnessLeaderboard(stats, totals);

  // 7. Update Modal Dropdowns
  updateModalDropdowns(stats);

  // 8. Update Admin indicator
  updateAdminUI();
}

function renderPendingConfirmationBanner(unconfirmedCount) {
  const banner = document.getElementById('unconfirmedAlertBanner');
  const countTitle = document.getElementById('unconfirmedBannerTitle');
  const countText = document.getElementById('unconfirmedBannerText');
  const btnBannerConfirmAll = document.getElementById('btnBannerConfirmAll');

  if (!banner) return;

  if (unconfirmedCount > 0) {
    banner.style.display = 'flex';
    if (countTitle) {
      countTitle.textContent = `${unconfirmedCount} Water Log(s) Pending Admin Confirmation`;
    }
    if (countText) {
      countText.textContent = isAdmin 
        ? `Roommate reported water fetched. As Admin, please confirm if it was really brought into the room!`
        : `Water was reported as brought. Waiting for Admin to check and confirm duty completion.`;
    }
    if (btnBannerConfirmAll) {
      if (isAdmin) {
        btnBannerConfirmAll.textContent = '✅ Confirm All (Admin)';
        btnBannerConfirmAll.onclick = handleConfirmAllLogs;
      } else {
        btnBannerConfirmAll.textContent = '🔐 Admin Login to Confirm';
        btnBannerConfirmAll.onclick = () => openModal('modalAdminLogin');
      }
    }
  } else {
    banner.style.display = 'none';
  }
}

function renderCanStatus(status = 'full', currentTurn) {
  const badge = document.getElementById('canStatusBadge');
  const dot = document.getElementById('canStatusDot');
  const text = document.getElementById('canStatusText');
  const alertBanner = document.getElementById('waterAlertBanner');
  const alertPersonName = document.getElementById('alertPersonName');

  // Toggle active class on status buttons
  document.querySelectorAll('.can-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === status);
  });

  if (badge) {
    badge.className = `status-badge ${status}`;
    if (status === 'full') {
      dot.textContent = '🟢';
      text.textContent = 'Can is Full';
      alertBanner.style.display = 'none';
    } else if (status === 'half') {
      dot.textContent = '🟡';
      text.textContent = 'Can is Low / Half';
      alertBanner.style.display = 'none';
    } else if (status === 'empty') {
      dot.textContent = '🔴';
      text.textContent = 'Can is Empty!';
      alertBanner.style.display = 'flex';
      if (alertPersonName) {
        alertPersonName.textContent = currentTurn ? currentTurn.name : 'Someone';
      }
    }
  }
}

function renderHero(current) {
  const heroAvatar = document.getElementById('heroAvatar');
  const heroName = document.getElementById('heroName');
  const heroNickname = document.getElementById('heroNickname');
  const heroTotalCans = document.getElementById('heroTotalCans');
  const heroLastTime = document.getElementById('heroLastTime');
  const skipCurrentName = document.getElementById('skipCurrentName');

  if (!current) {
    heroName.textContent = 'No Active Member';
    heroNickname.textContent = '';
    heroAvatar.textContent = '❓';
    heroAvatar.style.backgroundColor = '#64748b';
    heroTotalCans.textContent = '0';
    heroLastTime.textContent = 'Never';
    return;
  }

  heroAvatar.textContent = current.emoji || '💧';
  heroAvatar.style.backgroundColor = current.color || '#3b82f6';
  heroAvatar.style.boxShadow = `0 8px 24px ${current.color}44`;

  heroName.textContent = current.name;
  heroNickname.textContent = current.nickname ? `(${current.nickname})` : '';

  if (skipCurrentName) {
    skipCurrentName.textContent = current.name;
  }

  // Find stats for this member
  const memberStat = (appState.summary?.stats || []).find(s => s.member_id === current.id);
  if (memberStat) {
    heroTotalCans.textContent = memberStat.total_cans;
    heroLastTime.textContent = formatDateTime(memberStat.last_brought_at);
  }
}

function renderQueue(queue, rotationMode) {
  const container = document.getElementById('queueList');
  const modeText = document.getElementById('rotationModeText');
  if (!container) return;

  if (modeText) {
    modeText.textContent = rotationMode === 'least_count' ? '⚖️ Fair Auto-Balance' : '🔄 Round Robin Sequence';
  }

  container.innerHTML = '';

  if (!queue || queue.length === 0) {
    container.innerHTML = `<div class="empty-state">No members in queue</div>`;
    return;
  }

  queue.forEach((member, index) => {
    const isCurrent = index === 0;
    const card = document.createElement('div');
    card.className = `queue-card ${isCurrent ? 'is-current' : ''}`;
    card.title = `Click to view full details for ${member.name}`;

    card.innerHTML = `
      <div class="queue-order-badge">${index + 1}</div>
      <div class="queue-avatar" style="background-color: ${member.color || '#3b82f6'};">
        ${member.emoji || '💧'}
      </div>
      <div class="queue-details">
        <div class="queue-name">${escapeHtml(member.name)} ${member.nickname ? `(${escapeHtml(member.nickname)})` : ''}</div>
        <div class="queue-tag">${isCurrent ? '💧 Current Turn' : (index === 1 ? '👉 Up Next' : 'In Line')}</div>
      </div>
    `;

    // Click on ANY name in turn sequence to view overall details
    card.addEventListener('click', () => {
      openMemberDetailModal(member.id);
    });

    container.appendChild(card);
  });
}

function renderFairnessLeaderboard(stats, totals) {
  const listContainer = document.getElementById('memberStatsList');
  const statTotalCans = document.getElementById('statTotalCans');
  const statTotalLitres = document.getElementById('statTotalLitres');
  const statAvgCans = document.getElementById('statAvgCans');

  if (statTotalCans) statTotalCans.textContent = totals.totalCans;
  if (statTotalLitres) statTotalLitres.textContent = `${totals.totalLitres}L`;
  if (statAvgCans) statAvgCans.textContent = totals.averageCansPerPerson;

  if (!listContainer) return;
  listContainer.innerHTML = '';

  if (!stats || stats.length === 0) {
    listContainer.innerHTML = `<div class="empty-state">No roommates added yet</div>`;
    return;
  }

  // Find max cans for proportional progress bar
  const maxCans = Math.max(...stats.map(s => s.total_cans), 1);

  // Sort by total cans descending
  const sortedStats = [...stats].sort((a, b) => b.total_cans - a.total_cans);

  sortedStats.forEach((s) => {
    const percentage = Math.min(100, Math.round((s.total_cans / maxCans) * 100));

    let deltaHtml = '';
    if (s.delta_from_avg > 0) {
      deltaHtml = `<span class="stat-delta positive">+${s.delta_from_avg} ahead ⭐</span>`;
    } else if (s.delta_from_avg < 0) {
      deltaHtml = `<span class="stat-delta negative">${s.delta_from_avg} behind ⚠️</span>`;
    } else {
      deltaHtml = `<span class="stat-delta neutral">Even ✅</span>`;
    }

    const item = document.createElement('div');
    item.className = 'stat-item';
    item.style.cursor = 'pointer';
    item.title = `Click to view profile & stats for ${s.name}`;

    item.innerHTML = `
      <div class="stat-item-top">
        <div class="stat-person">
          <div class="stat-avatar" style="background-color: ${s.color || '#3b82f6'};">
            ${s.emoji || '💧'}
          </div>
          <div>
            <div class="stat-name">
              ${escapeHtml(s.name)}
              ${s.nickname ? `<span class="stat-nickname">(${escapeHtml(s.nickname)})</span>` : ''}
              ${!s.is_active ? '<span class="status-badge half" style="font-size:0.65rem; padding: 1px 6px;">🏖️ Away</span>' : ''}
            </div>
          </div>
        </div>
        <div class="stat-values">
          <span class="stat-cans-count">${s.total_cans} cans <span style="font-size:0.75rem; color:#94a3b8;">(${s.total_litres}L)</span></span>
          ${deltaHtml}
        </div>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${percentage}%; background-color: ${s.color || '#3b82f6'};"></div>
      </div>
    `;

    // Clicking leaderboard item also opens member details
    item.addEventListener('click', () => {
      openMemberDetailModal(s.member_id);
    });

    listContainer.appendChild(item);
  });
}

function renderLogs() {
  const container = document.getElementById('logsListContainer');
  if (!container) return;

  container.innerHTML = '';
  const logs = appState.logs || [];

  if (logs.length === 0) {
    container.innerHTML = `<div class="empty-state">No water activity recorded yet</div>`;
    return;
  }

  logs.forEach(log => {
    const item = document.createElement('div');
    item.className = 'log-item';

    // Status pill
    const isConfirmed = log.is_confirmed === 1 || log.is_confirmed === true;
    const confirmBadgeHtml = isConfirmed
      ? `<span class="badge-verified">✅ Verified</span>`
      : `<span class="badge-pending">⏳ Pending Confirmation</span>`;

    // Admin action buttons (Confirm or Delete)
    let adminActionsHtml = '';
    if (isAdmin) {
      adminActionsHtml = `
        <div class="log-actions">
          ${!isConfirmed ? `<button class="btn-confirm-sm" data-confirm-log="${log.id}" title="Confirm that water was brought">✅ Confirm</button>` : ''}
          <button class="btn-delete-sm" data-delete-log="${log.id}" title="Remove entry">🗑️</button>
        </div>
      `;
    }

    item.innerHTML = `
      <div class="log-left">
        <div class="log-avatar" style="background-color: ${log.member_color || '#3b82f6'};">
          ${log.member_emoji || '💧'}
        </div>
        <div>
          <div class="log-title" style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span>${escapeHtml(log.member_name)} brought ${log.quantity} can(s)</span>
            ${confirmBadgeHtml}
          </div>
          <div class="log-details">
            <span class="log-tag">${log.litres}L</span>
            <span class="log-tag">${escapeHtml(log.source || 'Cooler')}</span>
            ${log.cost > 0 ? `<span class="log-tag" style="color:#34d399;">₹${log.cost}</span>` : ''}
          </div>
          ${log.notes ? `<div class="log-notes">"${escapeHtml(log.notes)}"</div>` : ''}
          ${log.confirmed_at && isConfirmed ? `<div style="font-size:0.7rem; color:#64748b; margin-top:2px;">Confirmed by ${escapeHtml(log.confirmed_by || 'Admin')}</div>` : ''}
        </div>
      </div>
      <div class="log-right">
        <div class="log-time">${formatDateTime(log.logged_at)}</div>
        ${adminActionsHtml}
      </div>
    `;
    container.appendChild(item);
  });

  // Attach Admin confirm handlers
  container.querySelectorAll('[data-confirm-log]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const logId = btn.dataset.confirmLog;
      await confirmWaterLog(logId);
    });
  });

  // Attach Admin delete handlers
  container.querySelectorAll('[data-delete-log]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const logId = btn.dataset.deleteLog;
      if (confirm('Delete/Reject this water entry?')) {
        await deleteLog(logId);
      }
    });
  });
}

// Open Member Detail Modal (Requested: Shows overall details when clicking any name in turn sequence)
async function openMemberDetailModal(memberId) {
  const modalBody = document.getElementById('memberDetailBody');
  const modalFooter = document.getElementById('memberDetailFooter');
  if (!modalBody) return;

  modalBody.innerHTML = `<div style="padding: 24px; text-align: center; color: #94a3b8;">Loading roommate details...</div>`;
  openModal('modalMemberDetail');

  try {
    const res = await fetch(`${API_BASE}/api/members/${memberId}/details`);
    const json = await res.json();
    if (!json.success || !json.data) {
      modalBody.innerHTML = `<div class="alert-box error">Member details not found</div>`;
      return;
    }

    const { member, stats, queueStatus, queuePosition, isCurrentTurn, recentLogs } = json.data;

    let deltaBadge = '';
    if (stats.delta_from_avg > 0) {
      deltaBadge = `<span style="color:#34d399;">+${stats.delta_from_avg} ahead ⭐</span>`;
    } else if (stats.delta_from_avg < 0) {
      deltaBadge = `<span style="color:#f87171;">${stats.delta_from_avg} behind ⚠️</span>`;
    } else {
      deltaBadge = `<span style="color:#38bdf8;">Even ✅</span>`;
    }

    // Recent logs list
    let logsHtml = '';
    if (recentLogs && recentLogs.length > 0) {
      logsHtml = recentLogs.map(l => {
        const isConf = l.is_confirmed === 1 || l.is_confirmed === true;
        return `
          <div class="member-log-row">
            <div>
              <strong>${l.quantity} can (${l.litres}L)</strong>
              <span style="color:#94a3b8; font-size:0.75rem;"> - ${escapeHtml(l.source || 'Cooler')}</span>
              ${l.cost > 0 ? `<span style="color:#34d399; font-size:0.75rem;"> (₹${l.cost})</span>` : ''}
              ${l.notes ? `<div style="color:#cbd5e1; font-size:0.75rem; font-style:italic;">"${escapeHtml(l.notes)}"</div>` : ''}
            </div>
            <div style="text-align: right;">
              <span style="font-size:0.75rem; color:#94a3b8;">${formatDateTime(l.logged_at)}</span>
              <div>${isConf ? '<span class="badge-verified" style="font-size:0.65rem;">✅ Verified</span>' : '<span class="badge-pending" style="font-size:0.65rem;">⏳ Pending</span>'}</div>
            </div>
          </div>
        `;
      }).join('');
    } else {
      logsHtml = `<div style="padding: 12px; text-align: center; color: #64748b; font-size: 0.8rem;">No water fetched yet by ${escapeHtml(member.name)}.</div>`;
    }

    // Admin Quick Controls inside the modal
    let adminControlsHtml = '';
    if (isAdmin) {
      adminControlsHtml = `
        <div class="member-admin-controls">
          <button class="btn btn-primary btn-sm" id="btnModalSetCurrentTurn" style="flex: 1;">
            🎯 Assign Current Turn
          </button>
          <button class="btn btn-secondary btn-sm" id="btnModalToggleVacation" style="flex: 1;">
            ${member.is_active ? '🏖️ Put on Vacation' : '🟢 Set Active'}
          </button>
          <button class="btn btn-danger btn-sm" id="btnModalDeleteMember">
            🗑️ Delete
          </button>
        </div>
      `;
    }

    modalBody.innerHTML = `
      <!-- Profile Header -->
      <div class="member-profile-header">
        <div class="profile-avatar-large" style="background-color: ${member.color || '#3b82f6'};">
          ${member.emoji || '💧'}
        </div>
        <div class="profile-meta">
          <h2>
            ${escapeHtml(member.name)}
            ${member.nickname ? `<span style="font-size: 1rem; color: #94a3b8; font-weight: 400;">(${escapeHtml(member.nickname)})</span>` : ''}
          </h2>
          <div class="profile-badges-row">
            <span class="profile-badge ${isCurrentTurn ? 'current' : queuePosition === 2 ? 'next' : ''}">
              ${escapeHtml(queueStatus)}
            </span>
            <span class="profile-badge ${!member.is_active ? 'vacation' : ''}">
              ${member.is_active ? '🟢 Active Duty' : '🏖️ Away / Vacation'}
            </span>
            ${queuePosition ? `<span class="profile-badge">Queue Position: #${queuePosition}</span>` : ''}
          </div>
        </div>
      </div>

      <!-- Overall Stats Grid -->
      <div class="stats-grid-modal">
        <div class="stat-box-modal">
          <div class="stat-box-val" style="color: #38bdf8;">${stats.total_cans}</div>
          <div class="stat-box-lbl">Total Cans</div>
        </div>
        <div class="stat-box-modal">
          <div class="stat-box-val" style="color: #06b6d4;">${stats.total_litres}L</div>
          <div class="stat-box-lbl">Total Litres</div>
        </div>
        <div class="stat-box-modal">
          <div class="stat-box-val" style="color: #a855f7;">${stats.turn_count}</div>
          <div class="stat-box-lbl">Turns Completed</div>
        </div>
        <div class="stat-box-modal">
          <div class="stat-box-val">${deltaBadge}</div>
          <div class="stat-box-lbl">Fairness Status</div>
        </div>
        <div class="stat-box-modal">
          <div class="stat-box-val" style="color: #10b981;">₹${stats.total_spent || 0}</div>
          <div class="stat-box-lbl">Money Paid</div>
        </div>
        <div class="stat-box-modal">
          <div class="stat-box-val" style="color: #f59e0b;">${stats.contribution_percent}%</div>
          <div class="stat-box-lbl">Room Water Share</div>
        </div>
      </div>

      <!-- Last Fetched Meta -->
      <div style="background: rgba(15, 23, 42, 0.4); padding: 10px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); margin-bottom: 14px; font-size: 0.85rem; color: #cbd5e1; display: flex; justify-content: space-between;">
        <span>🕒 Last Brought:</span>
        <strong style="color: #fff;">${formatDateTime(stats.last_brought_at)}</strong>
      </div>

      <!-- Recent Logs -->
      <div class="member-detail-section-title">
        <span>📜 Recent Water History</span>
        <span style="font-size: 0.72rem; color: #94a3b8;">${recentLogs.length} recent record(s)</span>
      </div>
      <div class="member-recent-logs">
        ${logsHtml}
      </div>

      ${adminControlsHtml}
    `;

    // Wire up Admin Quick actions inside modal if Admin
    if (isAdmin) {
      document.getElementById('btnModalSetCurrentTurn')?.addEventListener('click', async () => {
        await setCurrentTurn(member.id);
        closeModal('modalMemberDetail');
      });

      document.getElementById('btnModalToggleVacation')?.addEventListener('click', async () => {
        await updateMember(member.id, { is_active: !member.is_active });
        openMemberDetailModal(member.id);
      });

      document.getElementById('btnModalDeleteMember')?.addEventListener('click', async () => {
        if (confirm(`Are you sure you want to remove ${member.name} from the room?`)) {
          await deleteMember(member.id);
          closeModal('modalMemberDetail');
        }
      });
    }

  } catch (err) {
    console.error('Error fetching member details:', err);
    modalBody.innerHTML = `<div class="alert-box error">Failed to load member profile</div>`;
  }
}

function renderManageMembers() {
  const list = document.getElementById('manageMemberList');
  if (!list) return;

  const members = appState.summary?.stats || [];
  list.innerHTML = '';

  members.forEach(m => {
    const row = document.createElement('div');
    row.className = 'member-row-manage';
    row.innerHTML = `
      <div class="member-row-info">
        <div style="width: 30px; height: 30px; border-radius: 50%; background: ${m.color}; display: flex; align-items: center; justify-content: center; font-size: 16px;">
          ${m.emoji}
        </div>
        <div>
          <strong style="font-size: 0.9rem; color: #fff;">${escapeHtml(m.name)}</strong>
          ${m.nickname ? `<span style="font-size: 0.78rem; color: #94a3b8;">(${escapeHtml(m.nickname)})</span>` : ''}
        </div>
      </div>
      <div class="member-row-actions">
        <button class="toggle-away-btn ${!m.is_active ? 'away' : ''}" data-member-id="${m.member_id}" data-active="${m.is_active}">
          ${m.is_active ? '✅ Active' : '🏖️ Away'}
        </button>
        <button class="btn btn-danger btn-sm" data-delete-member="${m.member_id}">🗑️</button>
      </div>
    `;
    list.appendChild(row);
  });

  // Attach toggle active/away listeners (requires Admin)
  list.querySelectorAll('.toggle-away-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.memberId;
      const currentActive = btn.dataset.active === '1' || btn.dataset.active === 'true';
      await updateMember(id, { is_active: !currentActive });
      renderManageMembers();
    });
  });

  // Attach delete listener (requires Admin)
  list.querySelectorAll('[data-delete-member]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.deleteMember;
      if (confirm('Are you sure you want to remove this roommate?')) {
        await deleteMember(id);
        renderManageMembers();
      }
    });
  });
}

function updateModalDropdowns(stats) {
  const activeMembers = (stats || []).filter(s => s.is_active);

  const logMemberSelect = document.getElementById('logMemberSelect');
  const logPaidBySelect = document.getElementById('logPaidBySelect');
  const swapTargetSelect = document.getElementById('swapTargetSelect');
  const filterMemberSelect = document.getElementById('filterMemberSelect');

  const currentTurn = appState.summary?.currentTurn;

  if (logMemberSelect) {
    const currentVal = logMemberSelect.value;
    logMemberSelect.innerHTML = activeMembers.map(m => 
      `<option value="${m.member_id}" ${currentTurn && currentTurn.id === m.member_id ? 'selected' : ''}>${m.emoji} ${escapeHtml(m.name)}</option>`
    ).join('');
    if (currentVal && activeMembers.some(m => String(m.member_id) === String(currentVal))) {
      logMemberSelect.value = currentVal;
    }
  }

  if (logPaidBySelect) {
    logPaidBySelect.innerHTML = activeMembers.map(m => 
      `<option value="${m.member_id}">${m.emoji} ${escapeHtml(m.name)}</option>`
    ).join('');
  }

  if (swapTargetSelect && currentTurn) {
    const otherActive = activeMembers.filter(m => m.member_id !== currentTurn.id);
    swapTargetSelect.innerHTML = otherActive.map(m => 
      `<option value="${m.member_id}">${m.emoji} ${escapeHtml(m.name)}</option>`
    ).join('');
  }

  if (filterMemberSelect) {
    const prev = filterMemberSelect.value;
    const allMembers = stats || [];
    filterMemberSelect.innerHTML = `<option value="">All Roommates</option>` + allMembers.map(m => 
      `<option value="${m.member_id}">${m.emoji} ${escapeHtml(m.name)}</option>`
    ).join('');
    filterMemberSelect.value = prev || '';
  }
}

// ================= USER & ADMIN ACTION HANDLERS =================

// 1. Hero 1-Click Complete Turn (Roommates can report; if admin, confirmed immediately)
async function handleHeroCompleteTurn() {
  const current = appState.summary?.currentTurn;
  if (!current) {
    showToast('No active roommate available', 'warning');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/turn/complete`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        memberId: current.id,
        quantity: 1
      })
    });
    const json = await res.json();
    if (json.success) {
      launchConfetti();
      playWaterChime();
      if (json.data.requiresAdminConfirmation) {
        showToast(`💧 Water logged for ${current.name}! Turn advanced (waiting for Admin confirmation).`, 'success');
      } else {
        showToast(`💧 Verified! ${current.name} brought water. Turn advanced!`, 'success');
      }
      await loadData();
      await loadLogs();
    } else {
      showToast(json.error || 'Failed to complete turn', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

// 2. Update Can Status (Full / Half / Empty) - Open to anyone
async function updateCanStatus(status) {
  try {
    const res = await fetch(`${API_BASE}/api/turn/can-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const json = await res.json();
    if (json.success) {
      if (status === 'empty') {
        showToast('🚨 Water marked EMPTY! Room notified.', 'warning');
      } else if (status === 'full') {
        showToast('🟢 Can marked FULL!', 'success');
      } else {
        showToast('🟡 Can marked LOW / HALF', 'info');
      }
      await loadData();
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

// 3. Skip Turn (Admin Only)
async function handleSkipTurn() {
  const reason = document.getElementById('skipReasonInput').value;
  try {
    const res = await fetch(`${API_BASE}/api/turn/skip`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ reason })
    });
    const json = await res.json();
    if (json.success) {
      closeModal('modalSkipTurn');
      showToast(`Turn skipped! Now it's ${json.data.next.name}'s turn.`, 'info');
      await loadData();
    } else {
      showToast(json.error || 'Failed to skip', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

// 4. Swap Turn (Admin Only)
async function handleSwapTurn() {
  const targetMemberId = document.getElementById('swapTargetSelect').value;
  const reason = document.getElementById('swapReasonInput').value;

  if (!targetMemberId) {
    showToast('Select a roommate to swap with', 'warning');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/turn/swap`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ targetMemberId, reason })
    });
    const json = await res.json();
    if (json.success) {
      closeModal('modalSwapTurn');
      showToast(`Turn swapped! Now it's ${json.data.current.name}'s turn.`, 'success');
      await loadData();
    } else {
      showToast(json.error || 'Failed to swap', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

// 5. Set Specific Turn (Admin Only)
async function setCurrentTurn(memberId) {
  try {
    const res = await fetch(`${API_BASE}/api/turn/set-current`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ memberId })
    });
    const json = await res.json();
    if (json.success) {
      showToast(`Turn set to ${json.data.currentTurn.name}!`, 'success');
      await loadData();
    } else {
      showToast(json.error || 'Failed to set turn', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

// 6. Confirm Water Log (Admin Only)
async function confirmWaterLog(logId) {
  try {
    const res = await fetch(`${API_BASE}/api/logs/${logId}/confirm`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (json.success) {
      showToast('✅ Water log verified and confirmed!', 'success');
      await loadData();
      await loadLogs();
    } else {
      showToast(json.error || 'Failed to confirm log', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

// 7. Confirm All Pending Water Logs (Admin Only)
async function handleConfirmAllLogs() {
  try {
    const res = await fetch(`${API_BASE}/api/logs/confirm-all`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (json.success) {
      showToast('✅ All pending water logs confirmed!', 'success');
      await loadData();
      await loadLogs();
    } else {
      showToast(json.error || 'Failed to confirm logs', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

// 8. Log Custom Water Entry
async function handleLogWaterSubmit(e) {
  e.preventDefault();
  const memberId = document.getElementById('logMemberSelect').value;
  let quantity = appState.selectedQuantity;
  if (quantity === 'custom') {
    quantity = parseFloat(document.getElementById('customQuantityInput').value) || 1;
  }
  const source = document.getElementById('logSourceSelect').value;
  const cost = parseFloat(document.getElementById('logCostInput').value) || 0;
  const paidByMemberId = cost > 0 ? document.getElementById('logPaidBySelect').value : memberId;
  const notes = document.getElementById('logNotesInput').value;

  try {
    const res = await fetch(`${API_BASE}/api/logs`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        memberId,
        quantity,
        source,
        cost,
        paidByMemberId,
        notes,
        wasTurn: 1
      })
    });
    const json = await res.json();
    if (json.success) {
      closeModal('modalLogWater');
      launchConfetti();
      playWaterChime();
      if (json.requiresAdminConfirmation) {
        showToast('💧 Water log saved! Waiting for Admin confirmation.', 'success');
      } else {
        showToast('💧 Water log confirmed and saved!', 'success');
      }
      e.target.reset();
      appState.selectedQuantity = 1;
      await loadData();
      await loadLogs();
    } else {
      showToast(json.error || 'Error logging water', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

// 9. Delete Log (Admin Only)
async function deleteLog(id) {
  try {
    const res = await fetch(`${API_BASE}/api/logs/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (json.success) {
      showToast('Log entry removed', 'info');
      await loadData();
      await loadLogs();
    } else {
      showToast(json.error || 'Cannot delete entry', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

// 10. Roommate Management API calls (Admin Only)
async function addMember(name, nickname, color, emoji) {
  try {
    const res = await fetch(`${API_BASE}/api/members`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name, nickname, color, emoji })
    });
    const json = await res.json();
    if (json.success) {
      showToast(`Added ${name} to the room!`, 'success');
      await loadData();
      renderManageMembers();
    } else {
      showToast(json.error || 'Error adding roommate', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

async function updateMember(id, fields) {
  try {
    const res = await fetch(`${API_BASE}/api/members/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(fields)
    });
    const json = await res.json();
    if (json.success) {
      showToast('Roommate updated', 'success');
      await loadData();
    } else {
      showToast(json.error || 'Failed to update roommate', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

async function deleteMember(id) {
  try {
    const res = await fetch(`${API_BASE}/api/members/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (json.success) {
      showToast('Roommate removed', 'info');
      await loadData();
    } else {
      showToast(json.error || 'Failed to remove roommate', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

// 11. Settings API calls (Admin Only)
async function saveRoomSettings(room_name, rotation_mode, default_can_litres) {
  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ room_name, rotation_mode, default_can_litres })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Settings saved!', 'success');
      closeModal('modalSettings');
      await loadData();
    } else {
      showToast(json.error || 'Failed to save settings', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

// 12. Admin Login
async function handleAdminLoginSubmit(e) {
  e.preventDefault();
  const pinInput = document.getElementById('adminPinInput');
  const errorBox = document.getElementById('adminLoginError');
  const pin = pinInput.value.trim();

  if (!pin) return;

  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const json = await res.json();

    if (json.success && json.data?.token) {
      adminToken = json.data.token;
      localStorage.setItem('panipari_admin_token', adminToken);
      isAdmin = true;
      updateAdminUI();
      closeModal('modalAdminLogin');
      pinInput.value = '';
      if (errorBox) errorBox.style.display = 'none';
      showToast('👑 Admin mode unlocked!', 'success');
      await loadData();
      await loadLogs();
    } else {
      if (errorBox) {
        errorBox.textContent = json.error || 'Invalid Admin PIN';
        errorBox.style.display = 'block';
      }
    }
  } catch (err) {
    if (errorBox) {
      errorBox.textContent = 'Server connection error';
      errorBox.style.display = 'block';
    }
  }
}

// 13. Admin Logout
async function handleAdminLogout() {
  if (confirm('Log out of Admin mode?')) {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: getAuthHeaders()
      });
    } catch (e) {
      // Ignore network errors on logout
    }
    adminToken = null;
    localStorage.removeItem('panipari_admin_token');
    isAdmin = false;
    updateAdminUI();
    showToast('Logged out of Admin mode', 'info');
    await loadData();
    await loadLogs();
  }
}

// 14. Change Admin PIN (Admin Only)
async function handleChangeAdminPin() {
  const currentPin = document.getElementById('changePinCurrent').value.trim();
  const newPin = document.getElementById('changePinNew').value.trim();

  if (!currentPin || !newPin) {
    showToast('Please enter both current and new PIN', 'warning');
    return;
  }
  if (newPin.length < 4) {
    showToast('New PIN must be at least 4 characters long', 'warning');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/auth/change-pin`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ currentPin, newPin })
    });
    const json = await res.json();
    if (json.success) {
      showToast('🔑 Admin PIN updated successfully!', 'success');
      document.getElementById('changePinCurrent').value = '';
      document.getElementById('changePinNew').value = '';
    } else {
      showToast(json.error || 'Failed to update PIN', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

// ================= MODAL HELPERS =================

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('active');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

// Render Mobile QR Code
function renderMobileQrModal() {
  const qrContainer = document.getElementById('qrcodeCanvas');
  const ipText = document.getElementById('mobileIpText');
  const btnDirectOpen = document.getElementById('btnDirectOpenLink');
  const btnCopy = document.getElementById('btnCopyMobileLink');

  if (!qrContainer) return;
  qrContainer.innerHTML = '';

  const RENDER_LIVE_URL = 'https://timepass-0vuz.onrender.com';
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const mobileUrl = !isLocalhost ? window.location.origin : (RENDER_LIVE_URL || appState.networkInfo?.deployedUrl || window.location.origin);

  if (ipText) ipText.textContent = mobileUrl;
  if (btnDirectOpen) btnDirectOpen.href = mobileUrl;

  if (typeof QRCode !== 'undefined') {
    new QRCode(qrContainer, {
      text: mobileUrl,
      width: 200,
      height: 200,
      colorDark: '#0f172a',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  if (btnCopy) {
    btnCopy.onclick = () => {
      navigator.clipboard.writeText(mobileUrl).then(() => {
        showToast('Link copied to clipboard!', 'success');
      });
    };
  }
}

// Helper: Escape HTML string
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

// ================= INIT & EVENT LISTENERS =================

document.addEventListener('DOMContentLoaded', async () => {
  // Check Admin session status first
  await verifyAdminAuth();

  // Load initial data
  await loadData();
  await loadLogs();
  await loadNetworkInfo();

  // Periodic polling every 8 seconds for real-time room sync
  setInterval(async () => {
    await loadData();
    const filterVal = document.getElementById('filterMemberSelect')?.value;
    await loadLogs(filterVal || null);
  }, 8000);

  // 1. Admin Login & Logout Header Trigger
  document.getElementById('btnAdminAuth')?.addEventListener('click', () => {
    if (isAdmin) {
      handleAdminLogout();
    } else {
      const errBox = document.getElementById('adminLoginError');
      if (errBox) errBox.style.display = 'none';
      openModal('modalAdminLogin');
      setTimeout(() => document.getElementById('adminPinInput')?.focus(), 150);
    }
  });

  // Admin Login Form Submit
  document.getElementById('formAdminLogin')?.addEventListener('submit', handleAdminLoginSubmit);

  // Toggle PIN visibility button
  document.getElementById('btnTogglePinVisibility')?.addEventListener('click', () => {
    const pinInput = document.getElementById('adminPinInput');
    if (pinInput) {
      pinInput.type = pinInput.type === 'password' ? 'text' : 'password';
    }
  });

  // Change Admin PIN in Settings
  document.getElementById('btnSaveNewPin')?.addEventListener('click', handleChangeAdminPin);

  // 2. Hero Action Buttons
  document.getElementById('btnHeroCompleteTurn')?.addEventListener('click', handleHeroCompleteTurn);
  document.getElementById('btnAlertQuickDone')?.addEventListener('click', handleHeroCompleteTurn);

  // Protected: Skip Turn (Admin Only)
  document.getElementById('btnHeroSkipTurn')?.addEventListener('click', () => {
    requireAdminAction(() => openModal('modalSkipTurn'), 'skip turns');
  });

  // Protected: Swap Turn (Admin Only)
  document.getElementById('btnHeroSwapTurn')?.addEventListener('click', () => {
    requireAdminAction(() => openModal('modalSwapTurn'), 'swap turns');
  });

  // Log other/custom (open to roommates)
  document.getElementById('btnHeroLogCustom')?.addEventListener('click', () => openModal('modalLogWater'));

  // Protected: Quick Add Roommate (Admin Only)
  document.getElementById('btnAddRoommateQuick')?.addEventListener('click', () => {
    requireAdminAction(() => {
      openModal('modalMembers');
      renderManageMembers();
    }, 'add roommates');
  });

  // 3. Can status buttons (Open to all roommates)
  document.querySelectorAll('.can-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const status = btn.dataset.status;
      updateCanStatus(status);
    });
  });

  // 4. Skip & Swap confirms
  document.getElementById('btnConfirmSkip')?.addEventListener('click', handleSkipTurn);
  document.getElementById('btnConfirmSwap')?.addEventListener('click', handleSwapTurn);

  // 5. Modal Close buttons
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeModal(btn.dataset.close);
    });
  });

  // Close modals when clicking backdrop
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('active');
      }
    });
  });

  // 6. Open Modal Buttons
  document.getElementById('btnOpenMembersModal')?.addEventListener('click', () => {
    requireAdminAction(() => {
      openModal('modalMembers');
      renderManageMembers();
    }, 'manage roommates');
  });

  document.getElementById('btnOpenSettingsModal')?.addEventListener('click', () => {
    requireAdminAction(() => {
      const s = appState.summary?.settings;
      if (s) {
        document.getElementById('settingsRoomName').value = s.room_name || '';
        document.getElementById('settingsRotationMode').value = s.rotation_mode || 'round_robin';
        document.getElementById('settingsDefaultLitres').value = s.default_can_litres || '20';
      }
      openModal('modalSettings');
    }, 'modify room settings');
  });

  document.getElementById('btnEditRoomName')?.addEventListener('click', () => {
    requireAdminAction(() => {
      const s = appState.summary?.settings;
      if (s) document.getElementById('settingsRoomName').value = s.room_name || '';
      openModal('modalSettings');
    }, 'rename the room');
  });

  document.getElementById('btnOpenMobileQR')?.addEventListener('click', () => {
    openModal('modalMobileQR');
    renderMobileQrModal();
  });

  // 7. Quantity Pills in Log Modal
  const quantityPills = document.querySelectorAll('#quantityPills .pill-option');
  const customQtyInput = document.getElementById('customQuantityInput');
  quantityPills.forEach(pill => {
    pill.addEventListener('click', () => {
      quantityPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const val = pill.dataset.qty;
      appState.selectedQuantity = val === 'custom' ? 'custom' : Number(val);
      if (val === 'custom') {
        customQtyInput.style.display = 'block';
        customQtyInput.focus();
      } else {
        customQtyInput.style.display = 'none';
      }
    });
  });

  // 8. Cost Input toggles Paid By field
  const costInput = document.getElementById('logCostInput');
  const paidByGroup = document.getElementById('paidByGroup');
  if (costInput && paidByGroup) {
    costInput.addEventListener('input', () => {
      const val = parseFloat(costInput.value) || 0;
      paidByGroup.style.display = val > 0 ? 'block' : 'none';
    });
  }

  // 9. Log Form Submit
  document.getElementById('formLogWater')?.addEventListener('submit', handleLogWaterSubmit);

  // 10. Add Member Form Submit (Admin Only)
  document.getElementById('formAddMember')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('newMemberName').value.trim();
    const nickname = document.getElementById('newMemberNickname').value.trim();
    const color = document.getElementById('newMemberColor').value;
    const emoji = document.getElementById('newMemberEmoji').value;

    if (name) {
      await addMember(name, nickname, color, emoji);
      e.target.reset();
      document.getElementById('newMemberColor').value = '#3b82f6';
      document.getElementById('newMemberEmoji').value = '💧';
    }
  });

  // 11. Room Settings Form Submit (Admin Only)
  document.getElementById('formRoomSettings')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const room_name = document.getElementById('settingsRoomName').value.trim();
    const rotation_mode = document.getElementById('settingsRotationMode').value;
    const default_can_litres = document.getElementById('settingsDefaultLitres').value;
    await saveRoomSettings(room_name, rotation_mode, default_can_litres);
  });

  // Export Backup
  document.getElementById('btnExportBackup')?.addEventListener('click', async () => {
    try {
      const res = await fetch(`${API_BASE}/api/backup/export`, { headers: getAuthHeaders() });
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `panipari-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Backup downloaded successfully!', 'success');
    } catch (err) {
      showToast('Failed to export backup', 'error');
    }
  });

  // Import Backup (Admin Only)
  document.getElementById('btnImportBackupFile')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    requireAdminAction(async () => {
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const res = await fetch(`${API_BASE}/api/backup/import`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(json)
        });
        const result = await res.json();
        if (result.success) {
          showToast('Backup restored successfully!', 'success');
          closeModal('modalSettings');
          await loadData();
          await loadLogs();
        } else {
          showToast(result.error || 'Failed to restore backup', 'error');
        }
      } catch (err) {
        showToast('Invalid backup file', 'error');
      }
    }, 'restore backup data');
  });

  // 12. Activity Log Filter
  document.getElementById('filterMemberSelect')?.addEventListener('change', (e) => {
    loadLogs(e.target.value || null);
  });
});
