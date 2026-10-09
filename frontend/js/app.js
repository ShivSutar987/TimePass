// PaniPari - Room Water Turn Manager Client Application

const API_BASE = ''; // Same origin

// App State
let appState = {
  summary: null,
  logs: [],
  networkInfo: null,
  selectedQuantity: 1
};

// Web Audio synthesizer for celebration chime
function playWaterChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    
    // Play two notes (harmonic water ripple)
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
    // Audio might be blocked before first user interaction
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

  const { settings, currentTurn, queue, stats, totals } = summary;

  // 1. Header & Room Name
  const roomTitleElem = document.getElementById('roomNameHeader');
  if (roomTitleElem) {
    roomTitleElem.textContent = settings.room_name || 'Room Water Turn';
  }

  // 2. Can Status Strip & Alert Banner
  renderCanStatus(settings.can_status, currentTurn);

  // 3. Hero Card (Current Turn)
  renderHero(currentTurn);

  // 4. Turn Queue (Next in line)
  renderQueue(queue, settings.rotation_mode);

  // 5. Leaderboard / Fairness Stats
  renderFairnessLeaderboard(stats, totals);

  // 6. Update Modals Dropdowns
  updateModalDropdowns(stats);
}

function renderCanStatus(status, currentTurn) {
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

    let orderLabel = `#${index + 1}`;
    if (isCurrent) orderLabel = 'NOW';
    else if (index === 1) orderLabel = 'NEXT';

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

  sortedStats.forEach((s, idx) => {
    const isChamp = idx === 0 && s.total_cans > 0;
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
    item.innerHTML = `
      <div class="stat-item-top">
        <div class="stat-person">
          <div class="stat-avatar" style="background-color: ${s.color || '#3b82f6'};">
            ${s.emoji || '💧'}
          </div>
          <div>
            <div class="stat-name">
              ${escapeHtml(s.name)} ${s.nickname ? `<span style="font-size:0.8rem; color:#94a3b8;">(${escapeHtml(s.nickname)})</span>` : ''}
              ${isChamp ? ' 🏆' : ''}
              ${!s.is_active ? ' <span style="font-size:0.7rem; color:#f59e0b; background: rgba(245,158,11,0.15); padding:2px 6px; border-radius:4px;">Away</span>' : ''}
            </div>
            <div class="stat-meta">
              ${s.total_litres}L • ${s.turn_count} turns • Last: ${formatDateTime(s.last_brought_at)}
              ${s.total_spent > 0 ? ` • Spent: ₹${s.total_spent}` : ''}
            </div>
          </div>
        </div>
        <div class="stat-score">
          <div class="stat-cans-count">${s.total_cans} <span style="font-size:0.75rem; font-weight:600; color:#94a3b8;">cans</span></div>
          <div>${deltaHtml}</div>
        </div>
      </div>
      <div class="stat-progress-bar">
        <div class="stat-progress-fill" style="width: ${percentage}%; background: ${s.color || '#0284c7'};"></div>
      </div>
    `;
    listContainer.appendChild(item);
  });
}

function renderLogs() {
  const container = document.getElementById('logsListContainer');
  if (!container) return;

  container.innerHTML = '';
  const logs = appState.logs;

  if (!logs || logs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">💧</div>
        <div>No water logs yet! Tap "I Brought Water!" to start tracking.</div>
      </div>
    `;
    return;
  }

  logs.forEach(log => {
    const item = document.createElement('div');
    item.className = 'log-item';
    item.innerHTML = `
      <div class="log-left">
        <div class="log-avatar" style="background-color: ${log.member_color || '#3b82f6'};">
          ${log.member_emoji || '💧'}
        </div>
        <div>
          <div class="log-title">${escapeHtml(log.member_name)} brought ${log.quantity} can(s)</div>
          <div class="log-details">
            <span class="log-tag">${log.litres}L</span>
            <span class="log-tag">${escapeHtml(log.source || 'Cooler')}</span>
            ${log.cost > 0 ? `<span class="log-tag" style="color:#34d399;">₹${log.cost}</span>` : ''}
          </div>
          ${log.notes ? `<div class="log-notes">"${escapeHtml(log.notes)}"</div>` : ''}
        </div>
      </div>
      <div class="log-right">
        <div class="log-time">${formatDateTime(log.logged_at)}</div>
        <button class="btn-delete-log" data-log-id="${log.id}" title="Delete/Undo entry">🗑️</button>
      </div>
    `;
    container.appendChild(item);
  });

  // Attach delete handlers
  container.querySelectorAll('.btn-delete-log').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const logId = btn.dataset.logId;
      if (confirm('Delete this water entry?')) {
        await deleteLog(logId);
      }
    });
  });
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

  // Attach toggle active/away listeners
  list.querySelectorAll('.toggle-away-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.memberId;
      const currentActive = btn.dataset.active === '1' || btn.dataset.active === 'true';
      await updateMember(id, { is_active: !currentActive });
      renderManageMembers();
    });
  });

  // Attach delete listener
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
  const logSelect = document.getElementById('logMemberSelect');
  const paidBySelect = document.getElementById('logPaidBySelect');
  const filterSelect = document.getElementById('filterMemberSelect');
  const swapSelect = document.getElementById('swapTargetSelect');

  const currentTurn = appState.summary?.currentTurn;

  // 1. Log Member Select
  if (logSelect) {
    const prevVal = logSelect.value;
    logSelect.innerHTML = '';
    stats.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.member_id;
      opt.textContent = `${s.emoji} ${s.name} ${s.nickname ? `(${s.nickname})` : ''}`;
      if (currentTurn && s.member_id === currentTurn.id) {
        opt.selected = true;
      }
      logSelect.appendChild(opt);
    });
    if (prevVal && !currentTurn) logSelect.value = prevVal;
  }

  // 2. Paid By Select
  if (paidBySelect) {
    paidBySelect.innerHTML = '';
    stats.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.member_id;
      opt.textContent = `${s.name}`;
      paidBySelect.appendChild(opt);
    });
  }

  // 3. Filter Logs Select
  if (filterSelect) {
    const currentFilter = filterSelect.value;
    filterSelect.innerHTML = '<option value="">All Roommates</option>';
    stats.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.member_id;
      opt.textContent = s.name;
      if (currentFilter == s.member_id) opt.selected = true;
      filterSelect.appendChild(opt);
    });
  }

  // 4. Swap Target Select
  if (swapSelect && currentTurn) {
    swapSelect.innerHTML = '';
    stats.filter(s => s.member_id !== currentTurn.id && s.is_active).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.member_id;
      opt.textContent = `${s.emoji} ${s.name} ${s.nickname ? `(${s.nickname})` : ''} (${s.total_cans} cans)`;
      swapSelect.appendChild(opt);
    });
  }
}

// ================= ACTION HANDLERS =================

// Complete Turn (Quick Hero Action)
async function handleHeroCompleteTurn() {
  const current = appState.summary?.currentTurn;
  if (!current) {
    showToast('No active roommate available', 'warning');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/turn/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: current.id,
        quantity: 1,
        source: 'Water Cooler'
      })
    });
    const json = await res.json();
    if (json.success) {
      launchConfetti();
      playWaterChime();
      showToast(`💧 Great job! ${current.name} completed their turn!`, 'success');
      await loadData();
      await loadLogs();
    } else {
      showToast(json.error || 'Failed to complete turn', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

// Update Can Status (Full, Half, Empty)
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
        const current = appState.summary?.currentTurn;
        showToast(`🚨 Water marked as Empty! ${current ? current.name : 'Someone'} is on turn!`, 'warning');
      } else {
        showToast(`Water status set to ${status}`, 'success');
      }
      await loadData();
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

// Skip Turn
async function handleSkipTurn() {
  const reason = document.getElementById('skipReasonInput').value;
  try {
    const res = await fetch(`${API_BASE}/api/turn/skip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    const json = await res.json();
    if (json.success) {
      closeModal('modalSkipTurn');
      showToast(`Turn skipped! Now it's ${json.data.next.name}'s turn.`, 'warning');
      await loadData();
    } else {
      showToast(json.error || 'Failed to skip', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

// Swap Turn
async function handleSwapTurn() {
  const targetMemberId = document.getElementById('swapTargetSelect').value;
  const reason = document.getElementById('swapReasonInput').value;
  if (!targetMemberId) return;

  try {
    const res = await fetch(`${API_BASE}/api/turn/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

// Log Custom Water Entry
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
      headers: { 'Content-Type': 'application/json' },
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
      showToast('💧 Water log saved successfully!', 'success');
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

// Delete Log
async function deleteLog(id) {
  try {
    const res = await fetch(`${API_BASE}/api/logs/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      showToast('Log entry removed', 'info');
      await loadData();
      await loadLogs();
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

// Roommate Management API calls
async function addMember(name, nickname, color, emoji) {
  try {
    const res = await fetch(`${API_BASE}/api/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });
    const json = await res.json();
    if (json.success) {
      showToast('Roommate updated', 'success');
      await loadData();
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

async function deleteMember(id) {
  try {
    const res = await fetch(`${API_BASE}/api/members/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      showToast('Roommate removed', 'info');
      await loadData();
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

// Settings API calls
async function saveRoomSettings(room_name, rotation_mode, default_can_litres) {
  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_name, rotation_mode, default_can_litres })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Settings saved!', 'success');
      closeModal('modalSettings');
      await loadData();
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

  const mobileUrl = appState.networkInfo?.mobileUrls?.[0] || window.location.origin;

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

  // 1. Hero Action Buttons
  document.getElementById('btnHeroCompleteTurn')?.addEventListener('click', handleHeroCompleteTurn);
  document.getElementById('btnAlertQuickDone')?.addEventListener('click', handleHeroCompleteTurn);

  document.getElementById('btnHeroSkipTurn')?.addEventListener('click', () => openModal('modalSkipTurn'));
  document.getElementById('btnHeroSwapTurn')?.addEventListener('click', () => openModal('modalSwapTurn'));
  document.getElementById('btnHeroLogCustom')?.addEventListener('click', () => openModal('modalLogWater'));
  document.getElementById('btnAddRoommateQuick')?.addEventListener('click', () => {
    openModal('modalMembers');
    renderManageMembers();
  });

  // 2. Can status buttons
  document.querySelectorAll('.can-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const status = btn.dataset.status;
      updateCanStatus(status);
    });
  });

  // 3. Skip & Swap confirms
  document.getElementById('btnConfirmSkip')?.addEventListener('click', handleSkipTurn);
  document.getElementById('btnConfirmSwap')?.addEventListener('click', handleSwapTurn);

  // 4. Modal Close buttons
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

  // 5. Open Modal Buttons
  document.getElementById('btnOpenMembersModal')?.addEventListener('click', () => {
    openModal('modalMembers');
    renderManageMembers();
  });

  document.getElementById('btnOpenSettingsModal')?.addEventListener('click', () => {
    const s = appState.summary?.settings;
    if (s) {
      document.getElementById('settingsRoomName').value = s.room_name || '';
      document.getElementById('settingsRotationMode').value = s.rotation_mode || 'round_robin';
      document.getElementById('settingsDefaultLitres').value = s.default_can_litres || '20';
    }
    openModal('modalSettings');
  });

  document.getElementById('btnEditRoomName')?.addEventListener('click', () => {
    const s = appState.summary?.settings;
    if (s) document.getElementById('settingsRoomName').value = s.room_name || '';
    openModal('modalSettings');
  });

  document.getElementById('btnOpenMobileQR')?.addEventListener('click', () => {
    openModal('modalMobileQR');
    renderMobileQrModal();
  });

  // 6. Quantity Pills in Log Modal
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

  // 7. Cost Input toggles Paid By field
  const costInput = document.getElementById('logCostInput');
  const paidByGroup = document.getElementById('paidByGroup');
  if (costInput && paidByGroup) {
    costInput.addEventListener('input', () => {
      const val = parseFloat(costInput.value) || 0;
      paidByGroup.style.display = val > 0 ? 'block' : 'none';
    });
  }

  // 8. Log Form Submit
  document.getElementById('formLogWater')?.addEventListener('submit', handleLogWaterSubmit);

  // 9. Add Member Form Submit
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

  // 10. Room Settings Form Submit
  document.getElementById('formRoomSettings')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const room_name = document.getElementById('settingsRoomName').value.trim();
    const rotation_mode = document.getElementById('settingsRotationMode').value;
    const default_can_litres = document.getElementById('settingsDefaultLitres').value;
    await saveRoomSettings(room_name, rotation_mode, default_can_litres);
  });

  // 11. Activity Log Filter
  document.getElementById('filterMemberSelect')?.addEventListener('change', (e) => {
    loadLogs(e.target.value || null);
  });
});
