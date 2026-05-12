/**
 * Card Tracker — frontend
 *
 * Single-page app built with vanilla JS + Bootstrap 5 + Chart.js.
 * All data lives on the Flask backend; this file handles rendering,
 * user interaction, and API calls. No build step required.
 */

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

/**
 * Holds UI state for both tabs independently so switching tabs preserves
 * the user's current sort/filter/page position.
 */
const state = {
  wrestling: { page: 1, sort: "wrestler_name", dir: "asc", perPage: 50 },
  soccer:    { page: 1, sort: "player_name",   dir: "asc", perPage: 50 },
  currentTab:     "wrestling",
  editId:         null,   // null = adding a new card, number = editing existing
  editType:       null,   // 'wrestling' or 'soccer'
  importType:     null,
  portfolioChart: null,   // Chart.js instance; kept so we can destroy before redraw
  historyChart:   null,
};

// Bootstrap modal instances — initialized after DOM is ready
let cardModal, historyModal, importModal;

document.addEventListener("DOMContentLoaded", () => {
  cardModal    = new bootstrap.Modal(document.getElementById("cardModal"));
  historyModal = new bootstrap.Modal(document.getElementById("historyModal"));
  importModal  = new bootstrap.Modal(document.getElementById("importModal"));

  setupTabs();
  setupSearch();
  loadWrestling();
  loadNavStats();
});


// ---------------------------------------------------------------------------
// Tab management
// ---------------------------------------------------------------------------

function setupTabs() {
  document.querySelectorAll("[data-tab]").forEach(el => {
    el.addEventListener("click", e => {
      e.preventDefault();
      switchTab(el.dataset.tab);
    });
  });
}

function switchTab(tab) {
  state.currentTab = tab;

  // Update nav link active state
  document.querySelectorAll("[data-tab]").forEach(el => {
    el.classList.toggle("active", el.dataset.tab === tab);
  });

  // Show only the selected tab panel
  ["wrestling", "soccer", "portfolio"].forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle("d-none", t !== tab);
  });

  if (tab === "wrestling") loadWrestling();
  else if (tab === "soccer") loadSoccer();
  else if (tab === "portfolio") loadPortfolio();
}


// ---------------------------------------------------------------------------
// Search, filter, and sort wiring
// ---------------------------------------------------------------------------

function setupSearch() {
  // Debounce prevents a new API call on every keypress; 300ms feels instant.
  const debounce = (fn, ms) => {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  };

  document.getElementById("w-search").addEventListener("input",      debounce(() => { state.wrestling.page = 1; loadWrestling(); }, 300));
  document.getElementById("w-filter-brand").addEventListener("input", debounce(() => { state.wrestling.page = 1; loadWrestling(); }, 300));
  document.getElementById("w-filter-type").addEventListener("input",  debounce(() => { state.wrestling.page = 1; loadWrestling(); }, 300));
  document.getElementById("s-search").addEventListener("input",       debounce(() => { state.soccer.page = 1; loadSoccer(); }, 300));
  document.getElementById("s-filter-team").addEventListener("input",  debounce(() => { state.soccer.page = 1; loadSoccer(); }, 300));
  document.getElementById("s-filter-type").addEventListener("input",  debounce(() => { state.soccer.page = 1; loadSoccer(); }, 300));

  // Clicking a sortable header toggles asc/desc; clicking a new column resets to asc
  document.querySelectorAll("th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      const tab = th.dataset.tab;
      const s   = state[tab];
      if (s.sort === col) s.dir = s.dir === "asc" ? "desc" : "asc";
      else { s.sort = col; s.dir = "asc"; }
      s.page = 1;
      if (tab === "wrestling") loadWrestling();
      else loadSoccer();
    });
  });

  document.getElementById("chart-filter").addEventListener("change", loadPortfolioChart);
}


// ---------------------------------------------------------------------------
// Wrestling tab
// ---------------------------------------------------------------------------

async function loadWrestling() {
  const s = state.wrestling;
  const params = new URLSearchParams({
    q:         document.getElementById("w-search").value,
    brand:     document.getElementById("w-filter-brand").value,
    card_type: document.getElementById("w-filter-type").value,
    sort: s.sort, dir: s.dir, page: s.page, per_page: s.perPage,
  });
  const data = await fetch(`/api/wrestling?${params}`).then(r => r.json());
  renderWrestlingTable(data);
  renderPagination("w-pagination", data, "wrestling");
  renderSummary("w-summary", data);
}

function renderWrestlingTable(data) {
  const tbody = document.getElementById("w-tbody");
  if (!data.cards.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">No cards found.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.cards.map(c => {
    const gain      = c.current_value - c.cost;
    const gainClass = gain >= 0 ? "gain" : "loss";
    const gainStr   = (gain >= 0 ? "+" : "") + fmt(gain);

    // Build search URLs from card data so users can quickly check market prices
    const ebayQ        = encodeURIComponent(`${c.wrestler_name} ${c.card_type} ${c.brand} wrestling card`);
    const researchUrl  = ebayResearchUrl(`${c.wrestler_name} ${c.card_type} ${c.brand}`);

    return `<tr>
      <td><strong>${esc(c.wrestler_name)}</strong></td>
      <td>${esc(c.brand)}</td>
      <td>${esc(c.card_type)}</td>
      <td>${esc(c.card_number)}</td>
      <td>${fmt(c.cost)}</td>
      <td>${fmt(c.current_value)} <small class="${gainClass}">${gainStr}</small></td>
      <td class="notes-cell" title="${esc(c.notes)}">${esc(c.notes)}</td>
      <td class="action-btns">
        <button class="btn btn-xs btn-outline-primary me-1" onclick="openEditModal('wrestling',${c.id})"                         title="Edit"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-xs btn-outline-info me-1"    onclick="showHistory('wrestling',${c.id},'${esc(c.wrestler_name)}')" title="Value History"><i class="bi bi-graph-up"></i></button>
        <a      class="btn btn-xs btn-outline-warning me-1" href="https://www.ebay.com/sch/i.html?_nkw=${ebayQ}" target="_blank" title="eBay Search"><i class="bi bi-bag"></i></a>
        <a      class="btn btn-xs btn-outline-success me-1" href="${researchUrl}"                                 target="_blank" title="eBay Sold Research"><i class="bi bi-bar-chart"></i></a>
        <button class="btn btn-xs btn-outline-danger"       onclick="deleteCard('wrestling',${c.id})"                           title="Delete"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`;
  }).join("");
}


// ---------------------------------------------------------------------------
// Soccer tab
// ---------------------------------------------------------------------------

async function loadSoccer() {
  const s = state.soccer;
  const params = new URLSearchParams({
    q:         document.getElementById("s-search").value,
    team:      document.getElementById("s-filter-team").value,
    card_type: document.getElementById("s-filter-type").value,
    sort: s.sort, dir: s.dir, page: s.page, per_page: s.perPage,
  });
  const data = await fetch(`/api/soccer?${params}`).then(r => r.json());
  renderSoccerTable(data);
  renderPagination("s-pagination", data, "soccer");
  renderSummary("s-summary", data);
}

function renderSoccerTable(data) {
  const tbody = document.getElementById("s-tbody");
  if (!data.cards.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted py-4">No cards found.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.cards.map(c => {
    const gain      = c.current_value - c.cost;
    const gainClass = gain >= 0 ? "gain" : "loss";
    const gainStr   = (gain >= 0 ? "+" : "") + fmt(gain);
    const ebayQ       = encodeURIComponent(`${c.player_name} ${c.card_type} ${c.team} soccer card`);
    const researchUrl = ebayResearchUrl(`${c.player_name} ${c.card_type} ${c.team}`);

    return `<tr>
      <td><strong>${esc(c.player_name)}</strong></td>
      <td>${esc(c.team)}</td>
      <td>${esc(c.league)}</td>
      <td>${esc(c.card_type)}</td>
      <td>${esc(c.card_number)}</td>
      <td>${c.year || ""}</td>
      <td>${fmt(c.cost)}</td>
      <td>${fmt(c.current_value)} <small class="${gainClass}">${gainStr}</small></td>
      <td class="notes-cell" title="${esc(c.notes)}">${esc(c.notes)}</td>
      <td class="action-btns">
        <button class="btn btn-xs btn-outline-primary me-1" onclick="openEditModal('soccer',${c.id})"                       title="Edit"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-xs btn-outline-info me-1"    onclick="showHistory('soccer',${c.id},'${esc(c.player_name)}')" title="Value History"><i class="bi bi-graph-up"></i></button>
        <a      class="btn btn-xs btn-outline-warning me-1" href="https://www.ebay.com/sch/i.html?_nkw=${ebayQ}" target="_blank" title="eBay Search"><i class="bi bi-bag"></i></a>
        <a      class="btn btn-xs btn-outline-success me-1" href="${researchUrl}"                                 target="_blank" title="eBay Sold Research"><i class="bi bi-bar-chart"></i></a>
        <button class="btn btn-xs btn-outline-danger"       onclick="deleteCard('soccer',${c.id})"                          title="Delete"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`;
  }).join("");
}


// ---------------------------------------------------------------------------
// Portfolio tab
// ---------------------------------------------------------------------------

async function loadPortfolio() {
  const stats = await fetch("/api/stats").then(r => r.json());
  const w = stats.wrestling, s = stats.soccer, t = stats.total;

  document.getElementById("portfolio-summary").innerHTML = `
    <table class="table table-sm mb-0">
      <thead><tr><th></th><th>Cards</th><th>Cost</th><th>Value</th><th>P&L</th></tr></thead>
      <tbody>
        <tr>
          <td><strong>Wrestling</strong></td><td>${w.count}</td>
          <td>${fmt(w.cost)}</td><td>${fmt(w.value)}</td>
          <td class="${w.value-w.cost>=0?'gain':'loss'}">${(w.value-w.cost>=0?"+":"")+fmt(w.value-w.cost)}</td>
        </tr>
        <tr>
          <td><strong>Soccer</strong></td><td>${s.count}</td>
          <td>${fmt(s.cost)}</td><td>${fmt(s.value)}</td>
          <td class="${s.value-s.cost>=0?'gain':'loss'}">${(s.value-s.cost>=0?"+":"")+fmt(s.value-s.cost)}</td>
        </tr>
        <tr class="table-dark">
          <td><strong>Total</strong></td><td>${t.count}</td>
          <td><strong>${fmt(t.cost)}</strong></td><td><strong>${fmt(t.value)}</strong></td>
          <td class="${t.value-t.cost>=0?'gain':'loss'}"><strong>${(t.value-t.cost>=0?"+":"")+fmt(t.value-t.cost)}</strong></td>
        </tr>
      </tbody>
    </table>`;

  loadPortfolioChart();
}

async function loadPortfolioChart() {
  const filter  = document.getElementById("chart-filter").value;
  const history = await fetch(`/api/portfolio/history?type=${filter}`).then(r => r.json());

  // Must destroy the previous Chart.js instance before creating a new one on
  // the same canvas element, or Chart.js will throw a canvas-reuse error.
  if (state.portfolioChart) state.portfolioChart.destroy();

  const ctx    = document.getElementById("portfolioChart").getContext("2d");
  const labels = history.map(h => h.date);
  const datasets = [];

  if (filter === "all" || filter === "wrestling") {
    datasets.push({
      label: "Wrestling", data: history.map(h => h.wrestling),
      borderColor: "#dc3545", backgroundColor: "rgba(220,53,69,0.1)", tension: 0.3, fill: false,
    });
  }
  if (filter === "all" || filter === "soccer") {
    datasets.push({
      label: "Soccer", data: history.map(h => h.soccer),
      borderColor: "#0d6efd", backgroundColor: "rgba(13,110,253,0.1)", tension: 0.3, fill: false,
    });
  }
  if (filter === "all") {
    datasets.push({
      label: "Total", data: history.map(h => h.total),
      borderColor: "#198754", backgroundColor: "rgba(25,135,84,0.1)", tension: 0.3, fill: true, borderWidth: 2,
    });
  }

  state.portfolioChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: { legend: { position: "top" } },
      scales:  { y: { ticks: { callback: v => "$" + v.toFixed(2) } } },
    },
  });
}


// ---------------------------------------------------------------------------
// Value history modal (per-card chart)
// ---------------------------------------------------------------------------

async function showHistory(type, id, name) {
  const history = await fetch(`/api/${type}/${id}/history`).then(r => r.json());
  document.getElementById("historyTitle").textContent = `Value History — ${name}`;

  if (state.historyChart) state.historyChart.destroy();
  historyModal.show();

  // Chart.js needs the canvas to be visible and sized before it can render.
  // The setTimeout gives Bootstrap's fade animation time to complete (~150ms).
  setTimeout(() => {
    const ctx = document.getElementById("historyChart").getContext("2d");
    state.historyChart = new Chart(ctx, {
      type: "line",
      data: {
        labels:   history.map(h => h.date),
        datasets: [{
          label: "Value", data: history.map(h => h.value),
          borderColor: "#0d6efd", backgroundColor: "rgba(13,110,253,0.1)", tension: 0.3, fill: true,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales:  { y: { ticks: { callback: v => "$" + v.toFixed(2) } } },
      },
    });
  }, 200);
}


// ---------------------------------------------------------------------------
// Add / Edit modal
// ---------------------------------------------------------------------------

function openAddModal(type) {
  state.editId   = null;
  state.editType = type;
  document.getElementById("modalTitle").textContent = `Add ${type === "wrestling" ? "Wrestling" : "Soccer"} Card`;
  document.getElementById("modalBody").innerHTML    = type === "wrestling" ? wrestlingForm({}) : soccerForm({});
  document.getElementById("modalSave").onclick      = saveCard;
  cardModal.show();
}

async function openEditModal(type, id) {
  state.editId   = id;
  state.editType = type;

  // There's no single-card GET endpoint, so we fetch the full list and find
  // the card by ID. For very large collections this could be slow; a dedicated
  // /api/<type>/<id> GET endpoint would be the fix if it becomes a problem.
  const data = await fetch(`/api/${type}?page=1&per_page=10000`).then(r => r.json());
  const c    = data.cards.find(x => x.id === id);
  if (!c) return;

  document.getElementById("modalTitle").textContent = `Edit ${type === "wrestling" ? "Wrestling" : "Soccer"} Card`;
  document.getElementById("modalBody").innerHTML    = type === "wrestling" ? wrestlingForm(c) : soccerForm(c);
  document.getElementById("modalSave").onclick      = saveCard;
  cardModal.show();
}

/** Returns the HTML for the wrestling card add/edit form, pre-filled with card data. */
function wrestlingForm(c) {
  return `
    <div class="row g-2">
      <div class="col-md-6">
        <label class="form-label">Wrestler Name *</label>
        <input class="form-control" id="f-wrestler_name" value="${esc(c.wrestler_name||"")}">
      </div>
      <div class="col-md-6">
        <label class="form-label">Brand</label>
        <input class="form-control" id="f-brand" list="brand-list" value="${esc(c.brand||"")}">
        <datalist id="brand-list">
          <option value="Raw"><option value="SmackDown"><option value="NXT">
          <option value="AEW"><option value="WCW"><option value="ECW"><option value="WWF">
        </datalist>
      </div>
      <div class="col-md-6">
        <label class="form-label">Card Type</label>
        <input class="form-control" id="f-card_type" list="type-list" value="${esc(c.card_type||"")}">
        <datalist id="type-list">
          <option value="Base"><option value="Refractor"><option value="Auto">
          <option value="Prizm"><option value="Patch"><option value="Rookie">
          <option value="Parallel"><option value="Gold"><option value="Silver"><option value="Bronze">
        </datalist>
      </div>
      <div class="col-md-6">
        <label class="form-label">Card Number</label>
        <input class="form-control" id="f-card_number" value="${esc(c.card_number||"")}">
      </div>
      <div class="col-md-6">
        <label class="form-label">Cost ($)</label>
        <input class="form-control" type="number" step="0.01" id="f-cost" value="${c.cost||0}">
      </div>
      <div class="col-md-6">
        <label class="form-label">Current Value ($)</label>
        <input class="form-control" type="number" step="0.01" id="f-current_value" value="${c.current_value||0}">
      </div>
      <div class="col-12">
        <label class="form-label">Notes</label>
        <textarea class="form-control" id="f-notes" rows="2">${esc(c.notes||"")}</textarea>
      </div>
    </div>`;
}

/** Returns the HTML for the soccer card add/edit form, pre-filled with card data. */
function soccerForm(c) {
  return `
    <div class="row g-2">
      <div class="col-md-6">
        <label class="form-label">Player Name *</label>
        <input class="form-control" id="f-player_name" value="${esc(c.player_name||"")}">
      </div>
      <div class="col-md-6">
        <label class="form-label">Team</label>
        <input class="form-control" id="f-team" value="${esc(c.team||"")}">
      </div>
      <div class="col-md-6">
        <label class="form-label">League</label>
        <input class="form-control" id="f-league" list="league-list" value="${esc(c.league||"")}">
        <datalist id="league-list">
          <option value="Premier League"><option value="La Liga"><option value="Bundesliga">
          <option value="Serie A"><option value="Ligue 1"><option value="MLS"><option value="Champions League">
        </datalist>
      </div>
      <div class="col-md-6">
        <label class="form-label">Card Type</label>
        <input class="form-control" id="f-card_type" list="type-list2" value="${esc(c.card_type||"")}">
        <datalist id="type-list2">
          <option value="Base"><option value="Refractor"><option value="Auto">
          <option value="Prizm"><option value="Patch"><option value="Rookie"><option value="Parallel">
        </datalist>
      </div>
      <div class="col-md-6">
        <label class="form-label">Card Number</label>
        <input class="form-control" id="f-card_number" value="${esc(c.card_number||"")}">
      </div>
      <div class="col-md-6">
        <label class="form-label">Year</label>
        <input class="form-control" type="number" id="f-year" value="${c.year||""}">
      </div>
      <div class="col-md-6">
        <label class="form-label">Cost ($)</label>
        <input class="form-control" type="number" step="0.01" id="f-cost" value="${c.cost||0}">
      </div>
      <div class="col-md-6">
        <label class="form-label">Current Value ($)</label>
        <input class="form-control" type="number" step="0.01" id="f-current_value" value="${c.current_value||0}">
      </div>
      <div class="col-12">
        <label class="form-label">Notes</label>
        <textarea class="form-control" id="f-notes" rows="2">${esc(c.notes||"")}</textarea>
      </div>
    </div>`;
}

async function saveCard() {
  const type = state.editType;
  const body = type === "wrestling" ? {
    wrestler_name: document.getElementById("f-wrestler_name").value.trim(),
    brand:         document.getElementById("f-brand").value.trim(),
    card_type:     document.getElementById("f-card_type").value.trim(),
    card_number:   document.getElementById("f-card_number").value.trim(),
    cost:          document.getElementById("f-cost").value,
    current_value: document.getElementById("f-current_value").value,
    notes:         document.getElementById("f-notes").value.trim(),
  } : {
    player_name:   document.getElementById("f-player_name").value.trim(),
    team:          document.getElementById("f-team").value.trim(),
    league:        document.getElementById("f-league").value.trim(),
    card_type:     document.getElementById("f-card_type").value.trim(),
    card_number:   document.getElementById("f-card_number").value.trim(),
    year:          document.getElementById("f-year").value,
    cost:          document.getElementById("f-cost").value,
    current_value: document.getElementById("f-current_value").value,
    notes:         document.getElementById("f-notes").value.trim(),
  };

  const nameField = type === "wrestling" ? body.wrestler_name : body.player_name;
  if (!nameField) { alert("Name is required."); return; }

  const url    = state.editId ? `/api/${type}/${state.editId}` : `/api/${type}`;
  const method = state.editId ? "PUT" : "POST";
  const res    = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) { alert("Error saving card."); return; }

  cardModal.hide();
  if (type === "wrestling") loadWrestling();
  else loadSoccer();
  loadNavStats();
}


// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

async function deleteCard(type, id) {
  if (!confirm("Delete this card? This cannot be undone.")) return;
  await fetch(`/api/${type}/${id}`, { method: "DELETE" });
  if (type === "wrestling") loadWrestling();
  else loadSoccer();
  loadNavStats();
}


// ---------------------------------------------------------------------------
// CSV export / import
// ---------------------------------------------------------------------------

function exportCSV(type) {
  // Triggering via location.href lets the browser handle the file download
  // dialog without any extra JS plumbing.
  window.location.href = `/api/export/${type}`;
}

function openImport(type) {
  state.importType = type;
  document.getElementById("importFile").value   = "";
  document.getElementById("importSave").onclick = doImport;
  importModal.show();
}

async function doImport() {
  const file = document.getElementById("importFile").files[0];
  if (!file) { alert("Select a file first."); return; }

  const form = new FormData();
  form.append("file", file);
  const res  = await fetch(`/api/import/${state.importType}`, { method: "POST", body: form });
  const data = await res.json();

  importModal.hide();
  alert(`Imported ${data.imported} cards.`);
  if (state.importType === "wrestling") loadWrestling();
  else loadSoccer();
  loadNavStats();
}


// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

function renderPagination(containerId, data, tab) {
  const s     = state[tab];
  const el    = document.getElementById(containerId);
  const start = (data.page - 1) * s.perPage + 1;
  const end   = Math.min(data.page * s.perPage, data.total);

  el.innerHTML = `
    <div class="d-flex align-items-center gap-2">
      <small class="text-muted">Showing ${data.total ? start : 0}–${end} of ${data.total}</small>
      <select class="form-select form-select-sm per-page-select" onchange="changePerPage('${tab}', this.value)">
        ${[25,50,100,200].map(n => `<option value="${n}" ${n===s.perPage?"selected":""}>${n}/page</option>`).join("")}
      </select>
    </div>
    <nav>
      <ul class="pagination pagination-sm mb-0">
        <li class="page-item ${data.page===1?"disabled":""}">
          <a class="page-link" href="#" onclick="goPage('${tab}',${data.page-1})">‹</a>
        </li>
        ${pageNums(data.page, data.pages).map(p =>
          p === "..."
            ? `<li class="page-item disabled"><span class="page-link">…</span></li>`
            : `<li class="page-item ${p===data.page?"active":""}"><a class="page-link" href="#" onclick="goPage('${tab}',${p})">${p}</a></li>`
        ).join("")}
        <li class="page-item ${data.page===data.pages||data.pages===0?"disabled":""}">
          <a class="page-link" href="#" onclick="goPage('${tab}',${data.page+1})">›</a>
        </li>
      </ul>
    </nav>`;
}

/**
 * Returns a compact page number array with ellipsis placeholders,
 * e.g. [1, "...", 4, 5, 6, "...", 20] for page 5 of 20.
 */
function pageNums(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (current > 3) pages.push("...");
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i);
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}

function goPage(tab, page) {
  state[tab].page = page;
  if (tab === "wrestling") loadWrestling();
  else loadSoccer();
}

function changePerPage(tab, val) {
  state[tab].perPage = parseInt(val);
  state[tab].page    = 1;
  if (tab === "wrestling") loadWrestling();
  else loadSoccer();
}


// ---------------------------------------------------------------------------
// Summary bar and nav stats
// ---------------------------------------------------------------------------

function renderSummary(id, data) {
  const gain      = data.total_value - data.total_cost;
  const gainClass = gain >= 0 ? "gain" : "loss";
  document.getElementById(id).innerHTML = `
    <span><strong>${data.total}</strong> cards</span>
    <span>Cost: <strong>${fmt(data.total_cost)}</strong></span>
    <span>Value: <strong>${fmt(data.total_value)}</strong></span>
    <span>P&L: <strong class="${gainClass}">${gain >= 0 ? "+" : ""}${fmt(gain)}</strong></span>`;
}

async function loadNavStats() {
  const stats = await fetch("/api/stats").then(r => r.json());
  const t = stats.total;
  document.getElementById("nav-stats").innerHTML = `
    <span class="nav-stats-item"><strong>${t.count}</strong> cards</span>
    <span class="nav-stats-item">Value: <strong>${fmt(t.value)}</strong></span>`;
}


// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Build an eBay Seller Research URL for sold listings over the last 30 days.
 * Timestamps must be in milliseconds and generated fresh each call so the
 * 30-day window always ends at the current moment.
 */
function ebayResearchUrl(keywords) {
  const end   = Date.now();
  const start = end - 30 * 24 * 60 * 60 * 1000;
  const params = new URLSearchParams({
    marketplace: "EBAY-US",
    keywords,
    dayRange:   "30",
    endDate:    end,
    startDate:  start,
    categoryId: "0",
    offset:     "0",
    limit:      "50",
    tabName:    "SOLD",
    tz:         "America/Chicago",
  });
  return `https://www.ebay.com/sh/research?${params}`;
}

/** Format a number as a dollar amount. */
function fmt(n) {
  return "$" + (parseFloat(n) || 0).toFixed(2);
}

/**
 * Escape a string for safe insertion into HTML attributes and text nodes.
 * Prevents XSS when rendering user-supplied card data into the table.
 */
function esc(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#39;");
}
