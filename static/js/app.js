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
  sold:      { page: 1, sort: "sold_date",     dir: "desc", perPage: 50 },
  currentTab:     "wrestling",
  editId:         null,   // null = adding a new card, number = editing existing
  editType:       null,   // 'wrestling' or 'soccer'
  importType:     null,
  portfolioChart: null,   // Chart.js instance; kept so we can destroy before redraw
  historyChart:   null,
  editBoxId:      null,   // null = adding a new box, number = editing existing
  boxes:          [],     // cached box list used to populate the box picker in card forms
  sellCardId:     null,   // card being marked as sold
  sellCardType:   null,
  editExpenseId:  null,   // null = adding, number = editing
  editProductId:  null,   // null = adding, number = editing
  selectedProductId: null, // product currently shown in price detail panel
  priceChart:     null,   // Chart.js instance for the price history chart
  editBreakId:    null,   // null = adding, number = editing
  selectedBreakId: null,  // break currently shown in slot detail panel
  editSlotId:     null,
  // Bundles
  selectedBundleId: null,  // bundle currently shown in detail panel
  editBundleId:   null,
  bundles:        [],      // cached bundle list
  selectedCards:  { wrestling: new Set(), soccer: new Set() },  // checked card IDs per tab
};

// Bootstrap modal instances — initialized after DOM is ready
let cardModal, historyModal, importModal, boxModal, sellModal, expenseModal, productModal, priceModal, breakModal, slotModal,
    createBundleModal, bundleAssignModal, sellBundleModal, compsModal;

document.addEventListener("DOMContentLoaded", () => {
  cardModal    = new bootstrap.Modal(document.getElementById("cardModal"));
  historyModal = new bootstrap.Modal(document.getElementById("historyModal"));
  importModal  = new bootstrap.Modal(document.getElementById("importModal"));
  boxModal     = new bootstrap.Modal(document.getElementById("boxModal"));
  sellModal    = new bootstrap.Modal(document.getElementById("sellModal"));
  expenseModal = new bootstrap.Modal(document.getElementById("expenseModal"));
  productModal = new bootstrap.Modal(document.getElementById("productModal"));
  priceModal   = new bootstrap.Modal(document.getElementById("priceModal"));
  breakModal        = new bootstrap.Modal(document.getElementById("breakModal"));
  slotModal         = new bootstrap.Modal(document.getElementById("slotModal"));
  createBundleModal = new bootstrap.Modal(document.getElementById("createBundleModal"));
  bundleAssignModal = new bootstrap.Modal(document.getElementById("bundleAssignModal"));
  sellBundleModal   = new bootstrap.Modal(document.getElementById("sellBundleModal"));
  compsModal        = new bootstrap.Modal(document.getElementById("compsModal"));

  // Toggle new/existing fields in the bundle assign modal
  document.querySelectorAll("input[name='bundleMode']").forEach(el => {
    el.addEventListener("change", () => {
      const isNew = document.getElementById("bm-new").checked;
      document.getElementById("ba-new-fields").classList.toggle("d-none", !isNew);
      document.getElementById("ba-existing-fields").classList.toggle("d-none", isNew);
    });
  });

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
  ["wrestling", "soccer", "sold", "bundles", "breaks", "prices", "portfolio"].forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle("d-none", t !== tab);
  });

  if (tab === "wrestling") loadWrestling();
  else if (tab === "soccer") loadSoccer();
  else if (tab === "sold") loadSold();
  else if (tab === "bundles") loadBundles();
  else if (tab === "breaks") loadBreaks();
  else if (tab === "prices") loadPrices();
  else if (tab === "portfolio") loadPortfolio();
}


// ---------------------------------------------------------------------------
// Boxes (portfolio sub-section)
// ---------------------------------------------------------------------------

async function loadBoxes() {
  state.boxes = await fetch("/api/boxes").then(r => r.json());
  renderBoxes();
}

function renderBoxes() {
  const tbody = document.getElementById("boxes-tbody");
  if (!state.boxes.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-3">No boxes logged yet. Click "Log Box" to add one.</td></tr>`;
    return;
  }
  tbody.innerHTML = state.boxes.map(b => {
    const pl        = b.total_value - b.cost;
    const plClass   = pl >= 0 ? "gain" : "loss";
    const costPerCard = b.card_count > 0 ? (b.cost / b.card_count).toFixed(2) : "—";
    return `<tr>
      <td><strong>${esc(b.name)}</strong></td>
      <td><span class="badge bg-secondary">${esc(b.box_type)}</span></td>
      <td>${fmt(b.cost)}</td>
      <td>${b.card_count}</td>
      <td>${b.card_count > 0 ? "$" + costPerCard : "—"}</td>
      <td>${fmt(b.total_value)}</td>
      <td class="${plClass}">${pl >= 0 ? "+" : ""}${fmt(pl)}</td>
      <td class="notes-cell" title="${esc(b.notes)}">${esc(b.notes)}</td>
      <td class="action-btns">
        <button class="btn btn-xs btn-outline-primary me-1" onclick="openBoxModal(${b.id})" title="Edit"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-xs btn-outline-danger" onclick="deleteBox(${b.id})" title="Delete"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`;
  }).join("");
}

function openBoxModal(id) {
  state.editBoxId = id || null;
  const b = id ? state.boxes.find(x => x.id === id) : null;
  document.getElementById("boxModalTitle").textContent = b ? "Edit Box" : "Log Box Purchase";
  document.getElementById("b-name").value     = b ? b.name     : "";
  document.getElementById("b-box_type").value = b ? b.box_type : "Blaster Box";
  document.getElementById("b-cost").value     = b ? b.cost     : 0;
  document.getElementById("b-notes").value    = b ? b.notes    : "";
  document.getElementById("boxSave").onclick  = saveBox;
  boxModal.show();
}

async function saveBox() {
  const name = document.getElementById("b-name").value.trim();
  if (!name) { alert("Name is required."); return; }
  const body = {
    name,
    box_type: document.getElementById("b-box_type").value,
    cost:     document.getElementById("b-cost").value,
    notes:    document.getElementById("b-notes").value.trim(),
  };
  const url    = state.editBoxId ? `/api/boxes/${state.editBoxId}` : "/api/boxes";
  const method = state.editBoxId ? "PUT" : "POST";
  await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  boxModal.hide();
  loadPortfolio();
}

async function deleteBox(id) {
  const b = state.boxes.find(x => x.id === id);
  const msg = b.card_count > 0
    ? `Delete "${b.name}"? Its ${b.card_count} linked card(s) will not be deleted but will be unlinked.`
    : `Delete "${b.name}"?`;
  if (!confirm(msg)) return;
  await fetch(`/api/boxes/${id}`, { method: "DELETE" });
  loadPortfolio();
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

async function loadExpenses() {
  const expenses = await fetch("/api/expenses").then(r => r.json());
  renderExpenses(expenses);
}

function renderExpenses(expenses) {
  const tbody = document.getElementById("expenses-tbody");
  if (!expenses.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">No expenses logged yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = expenses.map(e => `<tr>
    <td>${esc(e.expense_date)}</td>
    <td><span class="badge bg-secondary">${esc(e.category)}</span></td>
    <td>${esc(e.description)}</td>
    <td class="loss">−${fmt(e.amount)}</td>
    <td class="notes-cell" title="${esc(e.notes)}">${esc(e.notes)}</td>
    <td class="action-btns">
      <button class="btn btn-xs btn-outline-primary me-1" onclick="openExpenseModal(${e.id})" title="Edit"><i class="bi bi-pencil"></i></button>
      <button class="btn btn-xs btn-outline-danger" onclick="deleteExpense(${e.id})" title="Delete"><i class="bi bi-trash"></i></button>
    </td>
  </tr>`).join("");
}

function openExpenseModal(id) {
  state.editExpenseId = id || null;
  const expenses = Array.from(document.querySelectorAll("#expenses-tbody tr")).map(r => r._expense).filter(Boolean);
  // Fetch fresh data if editing
  if (id) {
    fetch("/api/expenses").then(r => r.json()).then(list => {
      const e = list.find(x => x.id === id);
      if (!e) return;
      _fillExpenseModal(e);
    });
  } else {
    _fillExpenseModal(null);
  }
  expenseModal.show();
}

function _fillExpenseModal(e) {
  document.getElementById("expenseModalTitle").textContent = e ? "Edit Expense" : "Log Expense";
  document.getElementById("e-category").value    = e ? e.category    : "Sleeves";
  document.getElementById("e-amount").value      = e ? e.amount      : "0";
  document.getElementById("e-description").value = e ? e.description : "";
  document.getElementById("e-date").value        = e ? e.expense_date : new Date().toISOString().slice(0, 10);
  document.getElementById("e-notes").value       = e ? e.notes       : "";
  document.getElementById("expenseSave").onclick = saveExpense;
}

async function saveExpense() {
  const amount = parseFloat(document.getElementById("e-amount").value);
  if (!amount || amount <= 0) { alert("Enter an amount greater than $0."); return; }
  const body = {
    category:     document.getElementById("e-category").value,
    description:  document.getElementById("e-description").value.trim(),
    amount,
    expense_date: document.getElementById("e-date").value,
    notes:        document.getElementById("e-notes").value.trim(),
  };
  const url    = state.editExpenseId ? `/api/expenses/${state.editExpenseId}` : "/api/expenses";
  const method = state.editExpenseId ? "PUT" : "POST";
  await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  expenseModal.hide();
  loadPortfolio();
}

async function deleteExpense(id) {
  if (!confirm("Delete this expense?")) return;
  await fetch(`/api/expenses/${id}`, { method: "DELETE" });
  loadPortfolio();
}


// ---------------------------------------------------------------------------
// Breaks tab
// ---------------------------------------------------------------------------

async function loadBreaks() {
  const breaks = await fetch("/api/breaks").then(r => r.json());
  renderBreakList(breaks);
  if (state.selectedBreakId) {
    const b = breaks.find(x => x.id === state.selectedBreakId);
    if (b) selectBreak(state.selectedBreakId, b.name);
  }
}

function renderBreakList(breaks) {
  const tbody = document.getElementById("breaks-tbody");
  if (!breaks.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted py-4">No breaks logged yet. Click "New Break" to add one.</td></tr>`;
    return;
  }
  tbody.innerHTML = breaks.map(b => {
    const netClass = b.net >= 0 ? "gain" : "loss";
    const isSelected = b.id === state.selectedBreakId;
    return `<tr class="cursor-pointer ${isSelected ? "table-active" : ""}" onclick="selectBreak(${b.id}, '${esc(b.name)}')">
      <td><strong>${esc(b.name)}</strong></td>
      <td>${esc(b.platform)}</td>
      <td>${esc(b.break_date)}</td>
      <td class="break-boxes-cell" title="${esc(b.box_names.join(", "))}"><small class="text-muted">${esc(b.box_names.join(", ")) || "—"}</small></td>
      <td>${b.slot_count}</td>
      <td>${fmt(b.total_income)}</td>
      <td class="loss">−${fmt(b.box_cost)}</td>
      <td class="loss">−${fmt(b.total_fees)}</td>
      <td class="${netClass}"><strong>${(b.net >= 0 ? "+" : "") + fmt(b.net)}</strong></td>
      <td class="action-btns" onclick="event.stopPropagation()">
        <button class="btn btn-xs btn-outline-primary me-1" onclick="openBreakModal(${b.id})" title="Edit"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-xs btn-outline-danger" onclick="deleteBreak(${b.id})" title="Delete"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`;
  }).join("");
}

async function selectBreak(id, name) {
  state.selectedBreakId = id;
  document.getElementById("break-detail-title").textContent = name;
  document.getElementById("break-detail").classList.remove("d-none");

  const [breaks, slots] = await Promise.all([
    fetch("/api/breaks").then(r => r.json()),
    fetch(`/api/breaks/${id}/slots`).then(r => r.json()),
  ]);
  renderBreakList(breaks);
  renderSlotTable(slots, breaks.find(b => b.id === id));
}

/**
 * Whatnot fee formula:
 *   8% commission on sale price
 *   2.9% processing on total order value (sale + shipping + tax) + $0.30 flat
 * Order total defaults to sale price when shipping/tax aren't known.
 */
function whatnotFees(price, orderTotal) {
  const commission  = price * 0.08;
  const processing  = (orderTotal || price) * 0.029 + 0.30;
  return Math.round((commission + processing) * 100) / 100;
}

function calcSlotFees() {
  const price      = parseFloat(document.getElementById("sl-price").value)      || 0;
  const orderTotal = parseFloat(document.getElementById("sl-order-total").value) || price;
  document.getElementById("sl-fees").value = whatnotFees(price, orderTotal).toFixed(2);
  calcSlotNet();
}

function calcSlotNet() {
  const price = parseFloat(document.getElementById("sl-price").value) || 0;
  const fees  = parseFloat(document.getElementById("sl-fees").value)  || 0;
  document.getElementById("sl-net").value = fmt(price - fees);
}

function renderSlotTable(slots, breakData) {
  const tbody = document.getElementById("slots-tbody");
  if (!slots.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-3">No slots added yet.</td></tr>`;
  } else {
    tbody.innerHTML = slots.map(s => {
      const netClass = s.net >= 0 ? "gain" : "loss";
      return `<tr>
        <td>${esc(s.slot_name)}</td>
        <td>${esc(s.buyer_name)}</td>
        <td>${fmt(s.price)}</td>
        <td class="loss">−${fmt(s.fees)}</td>
        <td class="${netClass}"><strong>${fmt(s.net)}</strong></td>
        <td class="notes-cell" title="${esc(s.notes)}">${esc(s.notes)}</td>
        <td class="action-btns">
          <button class="btn btn-xs btn-outline-primary me-1" onclick="openSlotModal(${s.id})" title="Edit"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-xs btn-outline-danger" onclick="deleteSlot(${s.id})" title="Delete"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
    }).join("");
  }

  // Totals footer
  const totals = document.getElementById("break-slot-totals");
  if (breakData) {
    const netClass = breakData.net >= 0 ? "gain" : "loss";
    totals.innerHTML = `
      <span>Income: <strong>${fmt(breakData.total_income)}</strong></span>
      <span>Box Cost: <strong class="loss">−${fmt(breakData.box_cost)}</strong></span>
      <span>Fees: <strong class="loss">−${fmt(breakData.total_fees)}</strong></span>
      <span>Net: <strong class="${netClass}">${(breakData.net >= 0 ? "+" : "") + fmt(breakData.net)}</strong></span>`;
  }
}

async function openBreakModal(id) {
  state.editBreakId = id || null;
  document.getElementById("breakModalTitle").textContent = id ? "Edit Break" : "New Break";
  document.getElementById("br-date").value  = new Date().toISOString().slice(0, 10);
  document.getElementById("br-notes").value = "";
  document.getElementById("br-platform").value = "Whatnot";

  // Fetch boxes to populate checkbox list
  if (!state.boxes.length) state.boxes = await fetch("/api/boxes").then(r => r.json());

  let selectedBoxIds = [];
  if (id) {
    const breaks = await fetch("/api/breaks").then(r => r.json());
    const b = breaks.find(x => x.id === id);
    if (b) {
      document.getElementById("br-name").value     = b.name;
      document.getElementById("br-platform").value = b.platform;
      document.getElementById("br-date").value     = b.break_date;
      document.getElementById("br-notes").value    = b.notes;
      selectedBoxIds = b.box_ids;
    }
  } else {
    document.getElementById("br-name").value = "";
  }

  const boxList = document.getElementById("br-box-list");
  if (!state.boxes.length) {
    boxList.innerHTML = `<span class="text-muted small">No box purchases logged yet.</span>`;
  } else {
    boxList.innerHTML = state.boxes.map(b => `
      <div class="form-check">
        <input class="form-check-input" type="checkbox" value="${b.id}" id="brbox-${b.id}"
          ${selectedBoxIds.includes(b.id) ? "checked" : ""}>
        <label class="form-check-label" for="brbox-${b.id}">
          ${esc(b.name)} <span class="text-muted">(${fmt(b.cost)})</span>
        </label>
      </div>`).join("");
  }

  document.getElementById("breakSave").onclick = saveBreak;
  breakModal.show();
}

async function saveBreak() {
  const name = document.getElementById("br-name").value.trim();
  if (!name) { alert("Break name is required."); return; }
  const box_ids = [...document.querySelectorAll("#br-box-list input:checked")].map(el => parseInt(el.value));
  const body = {
    name,
    platform:   document.getElementById("br-platform").value.trim(),
    break_date: document.getElementById("br-date").value,
    notes:      document.getElementById("br-notes").value.trim(),
    box_ids,
  };
  const url    = state.editBreakId ? `/api/breaks/${state.editBreakId}` : "/api/breaks";
  const method = state.editBreakId ? "PUT" : "POST";
  await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  breakModal.hide();
  loadBreaks();
}

async function deleteBreak(id) {
  if (!confirm("Delete this break and all its slots?")) return;
  await fetch(`/api/breaks/${id}`, { method: "DELETE" });
  if (state.selectedBreakId === id) {
    state.selectedBreakId = null;
    document.getElementById("break-detail").classList.add("d-none");
  }
  loadBreaks();
}

async function openSlotModal(id) {
  state.editSlotId = id || null;
  document.getElementById("slotModalTitle").textContent = id ? "Edit Slot" : "Add Slot";
  if (id) {
    const slots = await fetch(`/api/breaks/${state.selectedBreakId}/slots`).then(r => r.json());
    const s = slots.find(x => x.id === id);
    if (s) {
      document.getElementById("sl-slot_name").value   = s.slot_name;
      document.getElementById("sl-buyer_name").value  = s.buyer_name;
      document.getElementById("sl-price").value       = s.price;
      document.getElementById("sl-order-total").value = s.price;  // best guess when editing
      document.getElementById("sl-fees").value        = s.fees.toFixed(2);
      document.getElementById("sl-net").value         = fmt(s.net);
      document.getElementById("sl-notes").value       = s.notes;
    }
  } else {
    document.getElementById("sl-slot_name").value   = "";
    document.getElementById("sl-buyer_name").value  = "";
    document.getElementById("sl-price").value       = "0";
    document.getElementById("sl-order-total").value = "0";
    document.getElementById("sl-fees").value        = "0.30";
    document.getElementById("sl-net").value         = fmt(-0.30);
    document.getElementById("sl-notes").value       = "";
  }
  document.getElementById("slotSave").onclick = saveSlot;
  slotModal.show();
}

async function saveSlot() {
  const price = parseFloat(document.getElementById("sl-price").value);
  if (!price || price <= 0) { alert("Enter a price greater than $0."); return; }
  const body = {
    slot_name:  document.getElementById("sl-slot_name").value.trim(),
    buyer_name: document.getElementById("sl-buyer_name").value.trim(),
    price,
    fees:       parseFloat(document.getElementById("sl-fees").value) || 0,
    notes:      document.getElementById("sl-notes").value.trim(),
  };
  const url    = state.editSlotId ? `/api/break-slots/${state.editSlotId}` : `/api/breaks/${state.selectedBreakId}/slots`;
  const method = state.editSlotId ? "PUT" : "POST";
  await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  slotModal.hide();
  selectBreak(state.selectedBreakId, document.getElementById("break-detail-title").textContent);
  // Refresh break list so totals update
  const breaks = await fetch("/api/breaks").then(r => r.json());
  renderBreakList(breaks);
}

async function deleteSlot(id) {
  if (!confirm("Delete this slot?")) return;
  await fetch(`/api/break-slots/${id}`, { method: "DELETE" });
  selectBreak(state.selectedBreakId, document.getElementById("break-detail-title").textContent);
  const breaks = await fetch("/api/breaks").then(r => r.json());
  renderBreakList(breaks);
}

function triggerSlotImport() {
  // Reset the file input so the same file can be re-imported if needed
  const input = document.getElementById("slot-import-file");
  input.value = "";
  input.click();
}

async function importWhatnotCSV(input) {
  const file = input.files[0];
  if (!file || !state.selectedBreakId) return;

  const form = new FormData();
  form.append("file", file);

  const res  = await fetch(`/api/breaks/${state.selectedBreakId}/import-slots`, { method: "POST", body: form });
  const data = await res.json();

  if (!res.ok) { alert("Import failed: " + (data.error || "unknown error")); return; }

  // Refresh slot list and break totals
  const breakName = document.getElementById("break-detail-title").textContent;
  selectBreak(state.selectedBreakId, breakName);
  const breaks = await fetch("/api/breaks").then(r => r.json());
  renderBreakList(breaks);

  alert(`Imported ${data.imported} slot${data.imported !== 1 ? "s" : ""} from Whatnot CSV.`);
}


// ---------------------------------------------------------------------------
// Prices tab
// ---------------------------------------------------------------------------

const RETAILER_COLORS = [
  "#0d6efd","#dc3545","#198754","#fd7e14","#6f42c1","#20c997","#ffc107","#0dcaf0",
];

async function loadPrices() {
  const products = await fetch("/api/box-products").then(r => r.json());
  renderProductList(products);
  // Re-select the previously selected product if there was one
  if (state.selectedProductId) {
    const p = products.find(x => x.id === state.selectedProductId);
    if (p) selectProduct(state.selectedProductId, p.name);
  }
}

function renderProductList(products) {
  const tbody = document.getElementById("products-tbody");
  if (!products.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No boxes tracked yet. Click "Add Box" to start.</td></tr>`;
    return;
  }
  tbody.innerHTML = products.map(p => {
    const best = p.best_price != null ? fmt(p.best_price) : "—";
    const isSelected = p.id === state.selectedProductId;
    return `<tr class="cursor-pointer ${isSelected ? "table-active" : ""}" onclick="selectProduct(${p.id}, '${esc(p.name)}')">
      <td><strong>${esc(p.name)}</strong></td>
      <td>${p.box_type ? `<span class="badge bg-secondary">${esc(p.box_type)}</span>` : ""}</td>
      <td>${p.retailer_count}</td>
      <td><strong>${best}</strong></td>
      <td>${esc(p.best_retailer || "—")}</td>
      <td>${esc(p.last_checked || "—")}</td>
      <td class="action-btns" onclick="event.stopPropagation()">
        <button class="btn btn-xs btn-outline-primary me-1" onclick="openProductModal(${p.id})" title="Edit"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-xs btn-outline-success me-1" onclick="selectProduct(${p.id},'${esc(p.name)}'); openPriceModal()" title="Log Price"><i class="bi bi-plus-lg"></i></button>
        <button class="btn btn-xs btn-outline-danger" onclick="deleteProduct(${p.id})" title="Delete"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`;
  }).join("");
}

async function selectProduct(id, name) {
  state.selectedProductId = id;
  document.getElementById("price-detail-title").textContent = name;
  document.getElementById("price-detail").classList.remove("d-none");

  // Refresh the product list to update the highlighted row
  const products = await fetch("/api/box-products").then(r => r.json());
  renderProductList(products);

  const prices = await fetch(`/api/box-products/${id}/prices`).then(r => r.json());
  renderPriceHistory(prices);
  renderLatestPrices(products.find(p => p.id === id));
  renderPriceChart(prices);
}

function renderLatestPrices(product) {
  if (!product) return;
  const el = document.getElementById("price-latest");
  if (!product.latest_by_retailer.length) {
    el.innerHTML = `<p class="text-muted small">No prices logged yet.</p>`;
    return;
  }
  const sorted = [...product.latest_by_retailer].sort((a, b) => a.price - b.price);
  el.innerHTML = sorted.map((p, i) => {
    const isBest = i === 0;
    const link = p.url ? `<a href="${esc(p.url)}" target="_blank" class="ms-1"><i class="bi bi-box-arrow-up-right"></i></a>` : "";
    return `<div class="d-flex justify-content-between align-items-center mb-1">
      <span>${isBest ? '<i class="bi bi-trophy-fill text-warning me-1"></i>' : ""}${esc(p.retailer)}${link}</span>
      <strong class="${isBest ? "gain" : ""}">${fmt(p.price)}</strong>
    </div>`;
  }).join("");
}

function renderPriceHistory(prices) {
  const tbody = document.getElementById("price-history-tbody");
  if (!prices.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">No prices logged yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = prices.map(p => {
    const link = p.url
      ? `<a href="${esc(p.url)}" target="_blank" class="btn btn-xs btn-outline-secondary"><i class="bi bi-box-arrow-up-right"></i></a>`
      : "—";
    return `<tr>
      <td>${esc(p.checked_date)}</td>
      <td>${esc(p.retailer)}</td>
      <td><strong>${fmt(p.price)}</strong></td>
      <td>${link}</td>
      <td class="notes-cell" title="${esc(p.notes)}">${esc(p.notes)}</td>
      <td class="action-btns">
        <button class="btn btn-xs btn-outline-danger" onclick="deletePrice(${p.id})" title="Delete"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`;
  }).join("");
}

function renderPriceChart(prices) {
  if (state.priceChart) state.priceChart.destroy();
  if (!prices.length) return;

  // Group by retailer, sort each series by date ascending
  const byRetailer = {};
  prices.forEach(p => {
    if (!byRetailer[p.retailer]) byRetailer[p.retailer] = [];
    byRetailer[p.retailer].push({ x: p.checked_date, y: p.price });
  });
  Object.values(byRetailer).forEach(arr => arr.sort((a, b) => a.x.localeCompare(b.x)));

  const retailers = Object.keys(byRetailer);
  const datasets  = retailers.map((retailer, i) => ({
    label: retailer,
    data:  byRetailer[retailer],
    borderColor: RETAILER_COLORS[i % RETAILER_COLORS.length],
    backgroundColor: RETAILER_COLORS[i % RETAILER_COLORS.length] + "22",
    tension: 0.3, fill: false, pointRadius: 5, pointHoverRadius: 7,
  }));

  const ctx = document.getElementById("priceChart").getContext("2d");
  state.priceChart = new Chart(ctx, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      parsing: false,
      plugins: { legend: { position: "top" } },
      scales: {
        x: { type: "category", title: { display: false } },
        y: { ticks: { callback: v => "$" + v.toFixed(2) }, title: { display: false } },
      },
    },
  });
}

function openProductModal(id) {
  state.editProductId = id || null;
  if (id) {
    fetch("/api/box-products").then(r => r.json()).then(list => {
      const p = list.find(x => x.id === id);
      document.getElementById("productModalTitle").textContent = "Edit Box";
      document.getElementById("p-name").value     = p ? p.name     : "";
      document.getElementById("p-box_type").value = p ? p.box_type : "";
      document.getElementById("p-notes").value    = p ? p.notes    : "";
    });
  } else {
    document.getElementById("productModalTitle").textContent = "Add Box";
    document.getElementById("p-name").value     = "";
    document.getElementById("p-box_type").value = "";
    document.getElementById("p-notes").value    = "";
  }
  document.getElementById("productSave").onclick = saveProduct;
  productModal.show();
}

async function saveProduct() {
  const name = document.getElementById("p-name").value.trim();
  if (!name) { alert("Name is required."); return; }
  const body = {
    name,
    box_type: document.getElementById("p-box_type").value,
    notes:    document.getElementById("p-notes").value.trim(),
  };
  const url    = state.editProductId ? `/api/box-products/${state.editProductId}` : "/api/box-products";
  const method = state.editProductId ? "PUT" : "POST";
  await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  productModal.hide();
  loadPrices();
}

async function deleteProduct(id) {
  if (!confirm("Delete this box and all its price history?")) return;
  await fetch(`/api/box-products/${id}`, { method: "DELETE" });
  if (state.selectedProductId === id) {
    state.selectedProductId = null;
    document.getElementById("price-detail").classList.add("d-none");
  }
  loadPrices();
}

function openPriceModal() {
  if (!state.selectedProductId) { alert("Select a box first."); return; }
  document.getElementById("pr-retailer").value = "";
  document.getElementById("pr-price").value    = "0";
  document.getElementById("pr-date").value     = new Date().toISOString().slice(0, 10);
  document.getElementById("pr-url").value      = "";
  document.getElementById("pr-notes").value    = "";
  document.getElementById("priceSave").onclick = savePrice;
  priceModal.show();
}

async function savePrice() {
  const retailer = document.getElementById("pr-retailer").value.trim();
  const price    = parseFloat(document.getElementById("pr-price").value);
  if (!retailer) { alert("Retailer is required."); return; }
  if (!price || price <= 0) { alert("Enter a price greater than $0."); return; }
  const body = {
    retailer,
    price,
    checked_date: document.getElementById("pr-date").value,
    url:          document.getElementById("pr-url").value.trim(),
    notes:        document.getElementById("pr-notes").value.trim(),
  };
  await fetch(`/api/box-products/${state.selectedProductId}/prices`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  priceModal.hide();
  selectProduct(state.selectedProductId, document.getElementById("price-detail-title").textContent);
  // Refresh product list to update best price summary row
  const products = await fetch("/api/box-products").then(r => r.json());
  renderProductList(products);
}

async function deletePrice(id) {
  if (!confirm("Delete this price entry?")) return;
  await fetch(`/api/box-prices/${id}`, { method: "DELETE" });
  selectProduct(state.selectedProductId, document.getElementById("price-detail-title").textContent);
  const products = await fetch("/api/box-products").then(r => r.json());
  renderProductList(products);
}


/** Populate the box <select> in a card form and show the cost preview. */
async function populateBoxPicker(selectedBoxId) {
  if (!state.boxes.length) state.boxes = await fetch("/api/boxes").then(r => r.json());
  const sel = document.getElementById("f-box_id");
  sel.innerHTML = `<option value="">— select box —</option>` +
    state.boxes.map(b =>
      `<option value="${b.id}" data-cost="${b.cost}" data-count="${b.card_count}" ${b.id === selectedBoxId ? "selected" : ""}>${esc(b.name)} (${fmt(b.cost)})</option>`
    ).join("");
  updateCostSuggestion();
}

/** Update the cost hint when a box is selected — cost is set server-side on save. */
function updateCostSuggestion() {
  const sel  = document.getElementById("f-box_id");
  const hint = document.getElementById("box-cost-hint");
  if (!sel || !hint) return;
  const opt = sel.selectedOptions[0];
  if (!opt || !opt.value) { hint.textContent = ""; return; }
  const boxCost = parseFloat(opt.dataset.cost);
  const count   = parseInt(opt.dataset.count) + 1;  // +1 for the card being added
  hint.textContent = `Cost will be set to ${fmt(boxCost)} ÷ ${count} cards = ${fmt(boxCost / count)} after saving`;
}

/** Show or hide the box picker depending on whether source is a box type. */
function onSourceChange() {
  const source = document.getElementById("f-source").value;
  const isBox  = boxSourceSelected(source);
  document.getElementById("box-picker-row").classList.toggle("d-none", !isBox);
  if (isBox) populateBoxPicker(null);
  else {
    const hint = document.getElementById("box-cost-hint");
    if (hint) hint.textContent = "";
  }
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
  document.getElementById("w-filter-set").addEventListener("input",   debounce(() => { state.wrestling.page = 1; loadWrestling(); }, 300));
  document.getElementById("w-filter-brand").addEventListener("input", debounce(() => { state.wrestling.page = 1; loadWrestling(); }, 300));
  document.getElementById("w-filter-type").addEventListener("input",  debounce(() => { state.wrestling.page = 1; loadWrestling(); }, 300));
  document.getElementById("s-search").addEventListener("input",       debounce(() => { state.soccer.page = 1; loadSoccer(); }, 300));
  document.getElementById("s-filter-set").addEventListener("input",   debounce(() => { state.soccer.page = 1; loadSoccer(); }, 300));
  document.getElementById("s-filter-team").addEventListener("input",  debounce(() => { state.soccer.page = 1; loadSoccer(); }, 300));
  document.getElementById("s-filter-type").addEventListener("input",  debounce(() => { state.soccer.page = 1; loadSoccer(); }, 300));
  document.getElementById("sold-search").addEventListener("input",      debounce(() => { state.sold.page = 1; loadSold(); }, 300));
  document.getElementById("sold-filter-type").addEventListener("change", () => { state.sold.page = 1; loadSold(); });

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
      else if (tab === "soccer") loadSoccer();
      else if (tab === "sold") loadSold();
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
    set_name:  document.getElementById("w-filter-set").value,
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
    tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted py-4">No cards found.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.cards.map(c => {
    const gain      = c.current_value - c.cost;
    const gainClass = gain >= 0 ? "gain" : "loss";
    const gainStr   = (gain >= 0 ? "+" : "") + fmt(gain);
    const isChecked = state.selectedCards.wrestling.has(c.id);

    // Build search URLs from card data so users can quickly check market prices
    const ebayQ        = encodeURIComponent(`${c.wrestler_name} ${c.card_type} ${c.brand} wrestling card`);
    const researchUrl  = ebayResearchUrl(`${c.wrestler_name} ${c.card_type} ${c.brand}`);
    const bundleBadge  = c.bundle_id ? `<span class="badge bg-warning text-dark ms-1" title="In a bundle"><i class="bi bi-collection"></i></span>` : "";

    return `<tr>
      <td><input type="checkbox" class="form-check-input" ${isChecked ? "checked" : ""} onchange="onCardCheck('wrestling',${c.id},this.checked)"></td>
      <td><strong>${esc(c.wrestler_name)}</strong>${c.quantity > 1 ? ` <span class="badge bg-info text-dark">×${c.quantity}</span>` : ""}${bundleBadge}</td>
      <td>${esc(c.set_name)}</td>
      <td>${esc(c.brand)}</td>
      <td>${esc(c.card_type)}</td>
      <td>${esc(c.card_number)}</td>
      <td>${fmt(c.cost)}</td>
      <td>${fmt(c.current_value)} <small class="${gainClass}">${gainStr}</small></td>
      <td class="notes-cell" title="${esc(c.notes)}">${esc(c.notes)}</td>
      <td class="action-btns">
        <button class="btn btn-xs btn-outline-primary me-1" onclick="openEditModal('wrestling',${c.id})"                         title="Edit"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-xs btn-outline-success me-1" onclick="openSellModal('wrestling',${c.id},'${esc(c.wrestler_name)}',${c.quantity})" title="Mark Sold"><i class="bi bi-currency-dollar"></i></button>
        <button class="btn btn-xs btn-outline-info me-1"    onclick="showHistory('wrestling',${c.id},'${esc(c.wrestler_name)}')" title="Value History"><i class="bi bi-graph-up"></i></button>
        <button class="btn btn-xs btn-outline-secondary me-1" onclick="showComps('wrestling',${c.id},'${esc(c.wrestler_name)}')" title="eBay Comps"><i class="bi bi-tags"></i></button>
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
    set_name:  document.getElementById("s-filter-set").value,
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
    tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted py-4">No cards found.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.cards.map(c => {
    const gain      = c.current_value - c.cost;
    const gainClass = gain >= 0 ? "gain" : "loss";
    const gainStr   = (gain >= 0 ? "+" : "") + fmt(gain);
    const isChecked = state.selectedCards.soccer.has(c.id);
    const ebayQ       = encodeURIComponent(`${c.player_name} ${c.card_type} ${c.team} soccer card`);
    const researchUrl = ebayResearchUrl(`${c.player_name} ${c.card_type} ${c.team}`);
    const bundleBadge = c.bundle_id ? `<span class="badge bg-warning text-dark ms-1" title="In a bundle"><i class="bi bi-collection"></i></span>` : "";

    return `<tr>
      <td><input type="checkbox" class="form-check-input" ${isChecked ? "checked" : ""} onchange="onCardCheck('soccer',${c.id},this.checked)"></td>
      <td><strong>${esc(c.player_name)}</strong>${c.quantity > 1 ? ` <span class="badge bg-info text-dark">×${c.quantity}</span>` : ""}${bundleBadge}</td>
      <td>${esc(c.set_name)}</td>
      <td>${esc(c.team)}</td>
      <td>${esc(c.league)}</td>
      <td>${esc(c.card_type)}</td>
      <td>${esc(c.card_number)}</td>
      <td>${fmt(c.cost)}</td>
      <td>${fmt(c.current_value)} <small class="${gainClass}">${gainStr}</small></td>
      <td class="notes-cell" title="${esc(c.notes)}">${esc(c.notes)}</td>
      <td class="action-btns">
        <button class="btn btn-xs btn-outline-primary me-1" onclick="openEditModal('soccer',${c.id})"                         title="Edit"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-xs btn-outline-success me-1" onclick="openSellModal('soccer',${c.id},'${esc(c.player_name)}',${c.quantity})" title="Mark Sold"><i class="bi bi-currency-dollar"></i></button>
        <button class="btn btn-xs btn-outline-info me-1"    onclick="showHistory('soccer',${c.id},'${esc(c.player_name)}')"   title="Value History"><i class="bi bi-graph-up"></i></button>
        <button class="btn btn-xs btn-outline-secondary me-1" onclick="showComps('soccer',${c.id},'${esc(c.player_name)}')"   title="eBay Comps"><i class="bi bi-tags"></i></button>
        <a      class="btn btn-xs btn-outline-warning me-1" href="https://www.ebay.com/sch/i.html?_nkw=${ebayQ}" target="_blank" title="eBay Search"><i class="bi bi-bag"></i></a>
        <a      class="btn btn-xs btn-outline-success me-1" href="${researchUrl}"                                 target="_blank" title="eBay Sold Research"><i class="bi bi-bar-chart"></i></a>
        <button class="btn btn-xs btn-outline-danger"       onclick="deleteCard('soccer',${c.id})"                            title="Delete"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`;
  }).join("");
}


// ---------------------------------------------------------------------------
// Portfolio tab
// ---------------------------------------------------------------------------

async function loadPortfolio() {
  loadBoxes();
  loadExpenses();
  const [stats, salesStats, expStats, breakStats, boxStats] = await Promise.all([
    fetch("/api/stats").then(r => r.json()),
    fetch("/api/sales/stats").then(r => r.json()),
    fetch("/api/expenses/stats").then(r => r.json()),
    fetch("/api/breaks/stats").then(r => r.json()),
    fetch("/api/boxes/stats").then(r => r.json()),
  ]);
  const w = stats.wrestling, s = stats.soccer, t = stats.total;
  const ss = salesStats;
  const es = expStats;
  const bs = breakStats;
  const bx = boxStats;

  const plClass = pn => pn >= 0 ? "gain" : "loss";
  const plStr   = pn => (pn >= 0 ? "+" : "") + fmt(pn);
  const trueNet = ss.net_profit + bs.net - es.grand_total - bx.total;

  document.getElementById("portfolio-summary").innerHTML = `
    <table class="table table-sm mb-0">
      <thead><tr><th></th><th>Cards</th><th>Cost</th><th>Value</th><th>Unrealized P&L</th></tr></thead>
      <tbody>
        <tr>
          <td><strong>Wrestling</strong></td><td>${w.count}</td>
          <td>${fmt(w.cost)}</td><td>${fmt(w.value)}</td>
          <td class="${plClass(w.value-w.cost)}">${plStr(w.value-w.cost)}</td>
        </tr>
        <tr>
          <td><strong>Soccer</strong></td><td>${s.count}</td>
          <td>${fmt(s.cost)}</td><td>${fmt(s.value)}</td>
          <td class="${plClass(s.value-s.cost)}">${plStr(s.value-s.cost)}</td>
        </tr>
        <tr class="table-dark">
          <td><strong>Active Total</strong></td><td>${t.count}</td>
          <td><strong>${fmt(t.cost)}</strong></td><td><strong>${fmt(t.value)}</strong></td>
          <td class="${plClass(t.value-t.cost)}"><strong>${plStr(t.value-t.cost)}</strong></td>
        </tr>
      </tbody>
    </table>
    <hr class="my-2">
    <p class="fw-bold mb-1">Realized Sales (${ss.count} sold)</p>
    <table class="table table-sm mb-0">
      <thead><tr><th>Revenue</th><th>Fees</th><th>Cost Basis</th><th>Net Profit</th></tr></thead>
      <tbody>
        <tr>
          <td>${fmt(ss.total_revenue)}</td>
          <td class="loss">−${fmt(ss.total_fees)}</td>
          <td class="loss">−${fmt(ss.total_cost)}</td>
          <td class="${plClass(ss.net_profit)}"><strong>${plStr(ss.net_profit)}</strong></td>
        </tr>
      </tbody>
    </table>
    <hr class="my-2">
    <p class="fw-bold mb-1">Supply &amp; Overhead (${es.by_category.length} categories)</p>
    <table class="table table-sm mb-0">
      ${es.by_category.map(c => `<tr><td class="text-muted">${esc(c.category)}</td><td class="loss">−${fmt(c.total)}</td></tr>`).join("")}
      <tr class="table-dark">
        <td><strong>Total Expenses</strong></td>
        <td class="loss"><strong>−${fmt(es.grand_total)}</strong></td>
      </tr>
    </table>
    <hr class="my-2">
    <p class="fw-bold mb-1">Box Purchases (${bx.count} not in a break)</p>
    <table class="table table-sm mb-0">
      <tbody>
        <tr class="table-dark">
          <td><strong>Total Spent</strong></td>
          <td class="loss"><strong>−${fmt(bx.total)}</strong></td>
        </tr>
      </tbody>
    </table>
    <hr class="my-2">
    <p class="fw-bold mb-1">Card Breaks (${bs.break_count} breaks)</p>
    <table class="table table-sm mb-0">
      <thead><tr><th>Income</th><th>Box Cost</th><th>Fees</th><th>Net</th></tr></thead>
      <tbody>
        <tr>
          <td>${fmt(bs.total_income)}</td>
          <td class="loss">−${fmt(bs.total_box_cost)}</td>
          <td class="loss">−${fmt(bs.total_fees)}</td>
          <td class="${plClass(bs.net)}"><strong>${plStr(bs.net)}</strong></td>
        </tr>
      </tbody>
    </table>
    <hr class="my-2">
    <div class="d-flex justify-content-between align-items-center">
      <strong>True Net Profit</strong>
      <strong class="${plClass(trueNet)} fs-5">${plStr(trueNet)}</strong>
    </div>`;

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

async function openAddModal(type) {
  state.editId   = null;
  state.editType = type;
  const opts = await fetch(`/api/${type}/options`).then(r => r.json());
  document.getElementById("modalTitle").textContent = `Add ${type === "wrestling" ? "Wrestling" : "Soccer"} Card`;
  document.getElementById("modalBody").innerHTML    = type === "wrestling" ? wrestlingForm({}, opts) : soccerForm({}, opts);
  document.getElementById("modalSave").onclick      = saveCard;
  cardModal.show();
}

async function openEditModal(type, id) {
  state.editId   = id;
  state.editType = type;

  // There's no single-card GET endpoint, so we fetch the full list and find
  // the card by ID. For very large collections this could be slow; a dedicated
  // /api/<type>/<id> GET endpoint would be the fix if it becomes a problem.
  const [data, opts] = await Promise.all([
    fetch(`/api/${type}?page=1&per_page=10000`).then(r => r.json()),
    fetch(`/api/${type}/options`).then(r => r.json()),
  ]);
  const c = data.cards.find(x => x.id === id);
  if (!c) return;

  document.getElementById("modalTitle").textContent = `Edit ${type === "wrestling" ? "Wrestling" : "Soccer"} Card`;
  document.getElementById("modalBody").innerHTML    = type === "wrestling" ? wrestlingForm(c, opts) : soccerForm(c, opts);
  document.getElementById("modalSave").onclick      = saveCard;
  cardModal.show();
  // If this card came from a box, populate the picker and pre-select the box
  if (boxSourceSelected(c.source)) populateBoxPicker(c.box_id);
}

/**
 * Build a <datalist> from dynamic DB values, falling back to hardcoded defaults
 * when the database has no entries yet (fresh install).
 */
function datalistHtml(id, dbValues, defaults) {
  const values = dbValues && dbValues.length ? dbValues : defaults;
  return `<datalist id="${id}">${values.map(v => `<option value="${esc(v)}">`).join("")}</datalist>`;
}

/** Returns the HTML for the wrestling card add/edit form, pre-filled with card data. */
function wrestlingForm(c, opts = {}) {
  return `
    <div class="row g-2">
      <div class="col-md-6">
        <label class="form-label">Wrestler Name *</label>
        <input class="form-control" id="f-wrestler_name" value="${esc(c.wrestler_name||"")}">
      </div>
      <div class="col-md-6">
        <label class="form-label">Set</label>
        <input class="form-control" id="f-set_name" list="w-set-list" value="${esc(c.set_name||"")}">
        ${datalistHtml("w-set-list", opts.set_name, [
          "Topps Chrome WWE 2026","Upper Deck AEW Allure 2026","Topps Chrome WWE 2025",
          "Topps WWE 2025","Panini Prizm WWE 2024",
        ])}
      </div>
      <div class="col-md-6">
        <label class="form-label">Brand</label>
        <input class="form-control" id="f-brand" list="w-brand-list" value="${esc(c.brand||"")}">
        ${datalistHtml("w-brand-list", opts.brand, [
          "Raw","SmackDown","NXT","AEW","WCW","ECW","WWF",
        ])}
      </div>
      <div class="col-md-6">
        <label class="form-label">Card Type</label>
        <input class="form-control" id="f-card_type" list="w-type-list" value="${esc(c.card_type||"")}">
        ${datalistHtml("w-type-list", opts.card_type, [
          "Base","Refractor","Auto","Prizm","Patch","Patch Auto","Rookie","Rookie Auto",
          "Parallel","Gold","Silver","Bronze","Superfractor","1/1",
        ])}
      </div>
      <div class="col-md-6">
        <label class="form-label">Card Number</label>
        <input class="form-control" id="f-card_number" value="${esc(c.card_number||"")}">
      </div>
      <div class="col-md-4">
        <label class="form-label">Quantity</label>
        <input class="form-control" type="number" min="1" id="f-quantity" value="${c.quantity||1}">
      </div>
      <div class="col-md-8">
        <label class="form-label">Source</label>
        <select class="form-select" id="f-source" onchange="onSourceChange()">
          ${["Single","Blaster Box","Hobby Box","Retail Pack","Hanger Box","Mega Box","Collector Box","Trade","Gift","Other"]
            .map(s => `<option ${(c.source||"Single")===s?"selected":""}>${s}</option>`).join("")}
        </select>
      </div>
      <div class="col-md-6 ${boxSourceSelected(c.source) ? '' : 'd-none'}" id="box-picker-row">
        <label class="form-label">Box</label>
        <select class="form-select" id="f-box_id" onchange="updateCostSuggestion()">
          <option value="">— select box —</option>
        </select>
        <small class="text-muted" id="box-cost-hint"></small>
      </div>
      <div class="col-md-6">
        <label class="form-label">Cost ($) <small class="text-muted">per card</small></label>
        <input class="form-control" type="number" step="0.01" id="f-cost" value="${c.cost||0}">
      </div>
      <div class="col-md-6">
        <label class="form-label">Current Value ($) <small class="text-muted">per card</small></label>
        <div class="input-group">
          <input class="form-control" type="number" step="0.01" id="f-current_value" value="${c.current_value||0}">
          <button class="btn btn-outline-secondary" type="button" onclick="showCompsFromForm('wrestling')" title="Look up eBay prices"><i class="bi bi-tags"></i></button>
        </div>
      </div>
      <div class="col-12">
        <label class="form-label">Notes</label>
        <textarea class="form-control" id="f-notes" rows="2">${esc(c.notes||"")}</textarea>
      </div>
    </div>`;
}

/** Returns the HTML for the soccer card add/edit form, pre-filled with card data. */
function soccerForm(c, opts = {}) {
  return `
    <div class="row g-2">
      <div class="col-md-6">
        <label class="form-label">Player Name *</label>
        <input class="form-control" id="f-player_name" value="${esc(c.player_name||"")}">
      </div>
      <div class="col-md-6">
        <label class="form-label">Set</label>
        <input class="form-control" id="f-set_name" list="s-set-list" value="${esc(c.set_name||"")}">
        ${datalistHtml("s-set-list", opts.set_name, [
          "Donruss Road to World Cup 25-26","Topps Chrome UEFA Champions League 2025",
          "Panini Prizm FIFA World Cup 2026","Topps Chrome MLS 2025","Panini Donruss Soccer 2025",
        ])}
      </div>
      <div class="col-md-6">
        <label class="form-label">Team</label>
        <input class="form-control" id="f-team" list="s-team-list" value="${esc(c.team||"")}">
        ${datalistHtml("s-team-list", opts.team, [
          "USA","Brazil","Argentina","England","France","Germany","Spain","Portugal",
          "Netherlands","Italy","Mexico","Japan","Colombia","Uruguay","Belgium",
          "Croatia","Morocco","Senegal",
        ])}
      </div>
      <div class="col-md-6">
        <label class="form-label">League</label>
        <input class="form-control" id="f-league" list="s-league-list" value="${esc(c.league||"")}">
        ${datalistHtml("s-league-list", opts.league, [
          "International","Premier League","La Liga","Bundesliga","Serie A","Ligue 1",
          "MLS","Champions League","Europa League","World Cup","Copa America","CONCACAF",
        ])}
      </div>
      <div class="col-md-6">
        <label class="form-label">Card Type</label>
        <input class="form-control" id="f-card_type" list="s-type-list" value="${esc(c.card_type||"")}">
        ${datalistHtml("s-type-list", opts.card_type, [
          "Base","Refractor","Auto","Prizm","Patch","Patch Auto","Rookie","Rookie Auto",
          "Parallel","Gold","Silver","Bronze","Superfractor","1/1",
        ])}
      </div>
      <div class="col-md-6">
        <label class="form-label">Card Number</label>
        <input class="form-control" id="f-card_number" value="${esc(c.card_number||"")}">
      </div>
      <div class="col-md-4">
        <label class="form-label">Quantity</label>
        <input class="form-control" type="number" min="1" id="f-quantity" value="${c.quantity||1}">
      </div>
      <div class="col-md-8">
        <label class="form-label">Source</label>
        <select class="form-select" id="f-source" onchange="onSourceChange()">
          ${["Single","Blaster Box","Hobby Box","Retail Pack","Hanger Box","Mega Box","Collector Box","Trade","Gift","Other"]
            .map(s => `<option ${(c.source||"Single")===s?"selected":""}>${s}</option>`).join("")}
        </select>
      </div>
      <div class="col-md-6 ${boxSourceSelected(c.source) ? '' : 'd-none'}" id="box-picker-row">
        <label class="form-label">Box</label>
        <select class="form-select" id="f-box_id" onchange="updateCostSuggestion()">
          <option value="">— select box —</option>
        </select>
        <small class="text-muted" id="box-cost-hint"></small>
      </div>
      <div class="col-md-6">
        <label class="form-label">Cost ($) <small class="text-muted">per card</small></label>
        <input class="form-control" type="number" step="0.01" id="f-cost" value="${c.cost||0}">
      </div>
      <div class="col-md-6">
        <label class="form-label">Current Value ($) <small class="text-muted">per card</small></label>
        <div class="input-group">
          <input class="form-control" type="number" step="0.01" id="f-current_value" value="${c.current_value||0}">
          <button class="btn btn-outline-secondary" type="button" onclick="showCompsFromForm('soccer')" title="Look up eBay prices"><i class="bi bi-tags"></i></button>
        </div>
      </div>
      <div class="col-12">
        <label class="form-label">Notes</label>
        <textarea class="form-control" id="f-notes" rows="2">${esc(c.notes||"")}</textarea>
      </div>
    </div>`;
}

async function saveCard() {
  const type = state.editType;
  const source = document.getElementById("f-source").value;
  const boxId  = document.getElementById("f-box_id")?.value || null;
  const quantity = Math.max(1, parseInt(document.getElementById("f-quantity").value) || 1);
  const body = type === "wrestling" ? {
    wrestler_name: document.getElementById("f-wrestler_name").value.trim(),
    set_name:      document.getElementById("f-set_name").value.trim(),
    brand:         document.getElementById("f-brand").value.trim(),
    card_type:     document.getElementById("f-card_type").value.trim(),
    card_number:   document.getElementById("f-card_number").value.trim(),
    cost:          document.getElementById("f-cost").value,
    current_value: document.getElementById("f-current_value").value,
    quantity, source, box_id: boxId || null,
    notes:         document.getElementById("f-notes").value.trim(),
  } : {
    player_name:   document.getElementById("f-player_name").value.trim(),
    set_name:      document.getElementById("f-set_name").value.trim(),
    team:          document.getElementById("f-team").value.trim(),
    league:        document.getElementById("f-league").value.trim(),
    card_type:     document.getElementById("f-card_type").value.trim(),
    card_number:   document.getElementById("f-card_number").value.trim(),
    cost:          document.getElementById("f-cost").value,
    current_value: document.getElementById("f-current_value").value,
    quantity, source, box_id: boxId || null,
    notes:         document.getElementById("f-notes").value.trim(),
  };

  const nameField = type === "wrestling" ? body.wrestler_name : body.player_name;
  if (!nameField) { alert("Name is required."); return; }

  // Duplicate detection — only when adding a new card, not editing an existing one
  if (!state.editId) {
    const nameKey  = type === "wrestling" ? "wrestler_name" : "player_name";
    const dupParams = new URLSearchParams({
      [nameKey]:   nameField,
      set_name:    body.set_name,
      card_type:   body.card_type,
      card_number: body.card_number,
    });
    const matches = await fetch(`/api/${type}/check-duplicate?${dupParams}`).then(r => r.json());

    if (matches.length > 0) {
      const existing    = matches[0];
      const existingQty = existing.quantity || 1;
      const newTotal    = existingQty + quantity;
      const cardLabel   = type === "wrestling" ? existing.wrestler_name : existing.player_name;
      const detail      = [existing.set_name, existing.card_type, existing.card_number].filter(Boolean).join(" · ");
      const msg = `"${cardLabel}"${detail ? ` (${detail})` : ""} is already in your inventory ` +
        `with ${existingQty} cop${existingQty === 1 ? "y" : "ies"}.\n\n` +
        `Click OK to add to the existing entry (quantity → ${newTotal}),\n` +
        `or Cancel to create a separate entry.`;

      if (confirm(msg)) {
        // Merge: bump the existing card's quantity and close
        const res = await fetch(`/api/${type}/${existing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...existing, quantity: newTotal }),
        });
        if (!res.ok) { alert("Error updating quantity."); return; }
        cardModal.hide();
        if (type === "wrestling") loadWrestling();
        else loadSoccer();
        loadNavStats();
        if (state.currentTab === "portfolio") loadBoxes();
        else state.boxes = await fetch("/api/boxes").then(r => r.json());
        return;
      }
      // User clicked Cancel — fall through and create a separate entry
    }
  }

  const url    = state.editId ? `/api/${type}/${state.editId}` : `/api/${type}`;
  const method = state.editId ? "PUT" : "POST";
  const res    = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) { alert("Error saving card."); return; }

  cardModal.hide();
  if (type === "wrestling") loadWrestling();
  else loadSoccer();
  loadNavStats();
  // Refresh box stats so card counts stay current
  if (state.currentTab === "portfolio") loadBoxes();
  else state.boxes = await fetch("/api/boxes").then(r => r.json());
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
// Sold tab
// ---------------------------------------------------------------------------

async function loadSold() {
  const s = state.sold;
  const params = new URLSearchParams({
    q:         document.getElementById("sold-search").value,
    card_type: document.getElementById("sold-filter-type").value,
    sort: s.sort, dir: s.dir, page: s.page, per_page: s.perPage,
  });
  const data = await fetch(`/api/sales?${params}`).then(r => r.json());
  renderSoldTable(data);
  renderSoldPagination(data);
  renderSoldSummary(data);
}

function renderSoldTable(data) {
  const tbody = document.getElementById("sold-tbody");
  if (!data.sales.length) {
    tbody.innerHTML = `<tr><td colspan="12" class="text-center text-muted py-4">No sales recorded yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.sales.map(s => {
    const plClass = s.net_profit >= 0 ? "gain" : "loss";
    const plStr   = (s.net_profit >= 0 ? "+" : "") + fmt(s.net_profit);
    const badge   = s.card_type === "wrestling"
      ? `<span class="badge bg-danger">W</span>`
      : `<span class="badge bg-primary">S</span>`;
    const bundleBadge = s.bundle_name
      ? ` <span class="badge bg-warning text-dark" title="Bundle: ${esc(s.bundle_name)}"><i class="bi bi-collection"></i> ${esc(s.bundle_name)}</span>`
      : "";
    return `<tr>
      <td>${badge}</td>
      <td><strong>${esc(s.name)}</strong>${bundleBadge}</td>
      <td>${esc(s.set_name)}</td>
      <td><small class="text-muted">${esc(s.card_detail)}${s.card_number ? " #"+esc(s.card_number) : ""}</small></td>
      <td>${esc(s.sold_date)}</td>
      <td>${esc(s.platform)}</td>
      <td>${fmt(s.cost)}</td>
      <td>${fmt(s.sold_price)}</td>
      <td>${fmt(s.fees)}</td>
      <td class="${plClass}"><strong>${plStr}</strong></td>
      <td class="notes-cell" title="${esc(s.notes)}">${esc(s.notes)}</td>
      <td class="action-btns">
        <button class="btn btn-xs btn-outline-secondary" onclick="unarchiveSale(${s.id})" title="Unarchive (restore to inventory)"><i class="bi bi-arrow-counterclockwise"></i></button>
      </td>
    </tr>`;
  }).join("");
}

function renderSoldSummary(data) {
  // Compute totals from the current page — a separate stats call is used in Portfolio
  // for accurate all-time numbers; here we just show the filtered page count.
  document.getElementById("sold-summary").innerHTML =
    `<span><strong>${data.total}</strong> sales</span>`;
}

function renderSoldPagination(data) {
  const s     = state.sold;
  const el    = document.getElementById("sold-pagination");
  const start = (data.page - 1) * s.perPage + 1;
  const end   = Math.min(data.page * s.perPage, data.total);

  el.innerHTML = `
    <div class="d-flex align-items-center gap-2">
      <small class="text-muted">Showing ${data.total ? start : 0}–${end} of ${data.total}</small>
      <select class="form-select form-select-sm per-page-select" onchange="changeSoldPerPage(this.value)">
        ${[25,50,100,200].map(n => `<option value="${n}" ${n===s.perPage?"selected":""}>${n}/page</option>`).join("")}
      </select>
    </div>
    <nav>
      <ul class="pagination pagination-sm mb-0">
        <li class="page-item ${data.page===1?"disabled":""}">
          <a class="page-link" href="#" onclick="goSoldPage(${data.page-1})">‹</a>
        </li>
        ${pageNums(data.page, data.pages).map(p =>
          p === "..."
            ? `<li class="page-item disabled"><span class="page-link">…</span></li>`
            : `<li class="page-item ${p===data.page?"active":""}"><a class="page-link" href="#" onclick="goSoldPage(${p})">${p}</a></li>`
        ).join("")}
        <li class="page-item ${data.page===data.pages||data.pages===0?"disabled":""}">
          <a class="page-link" href="#" onclick="goSoldPage(${data.page+1})">›</a>
        </li>
      </ul>
    </nav>`;
}

function goSoldPage(page) { state.sold.page = page; loadSold(); }
function changeSoldPerPage(val) { state.sold.perPage = parseInt(val); state.sold.page = 1; loadSold(); }

function openSellModal(type, id, name, quantity) {
  state.sellCardId   = id;
  state.sellCardType = type;
  const qtyNote = (quantity > 1) ? ` — ${quantity - 1} will remain in inventory` : "";
  document.getElementById("sell-card-label").textContent = `Selling 1 copy: ${name}${qtyNote}`;
  document.getElementById("sell-price").value    = "0";
  document.getElementById("sell-fees").value     = "0";
  document.getElementById("sell-platform").value = "";
  document.getElementById("sell-date").value     = new Date().toISOString().slice(0, 10);
  document.getElementById("sell-notes").value    = "";
  document.getElementById("sellSave").onclick    = saveSale;
  sellModal.show();
}

async function saveSale() {
  const price = parseFloat(document.getElementById("sell-price").value);
  if (!price || price <= 0) { alert("Enter a sold price greater than $0."); return; }
  const body = {
    card_type:  state.sellCardType,
    card_id:    state.sellCardId,
    sold_price: price,
    fees:       parseFloat(document.getElementById("sell-fees").value) || 0,
    platform:   document.getElementById("sell-platform").value.trim(),
    sold_date:  document.getElementById("sell-date").value,
    notes:      document.getElementById("sell-notes").value.trim(),
  };
  const res = await fetch("/api/sales", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) { alert("Error recording sale."); return; }
  sellModal.hide();
  // Refresh whichever inventory tab sent us here, plus nav stats
  if (state.sellCardType === "wrestling") loadWrestling();
  else loadSoccer();
  loadNavStats();
}

async function unarchiveSale(saleId) {
  if (!confirm("Restore this card to active inventory? The sale record will be deleted.")) return;
  await fetch(`/api/sales/${saleId}`, { method: "DELETE" });
  loadSold();
  loadNavStats();
}


// ---------------------------------------------------------------------------
// Bundles tab
// ---------------------------------------------------------------------------

async function loadBundles() {
  state.bundles = await fetch("/api/bundles").then(r => r.json());
  renderBundleList(state.bundles);
  if (state.selectedBundleId) {
    const b = state.bundles.find(x => x.id === state.selectedBundleId);
    if (b) renderBundleDetail(b);
  }
}

function renderBundleList(bundles) {
  const tbody = document.getElementById("bundles-tbody");
  if (!bundles.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">No bundles yet. Select cards from Wrestling or Soccer tabs and click Bundle, or click "New Bundle" above.</td></tr>`;
    return;
  }
  tbody.innerHTML = bundles.map(b => {
    const pl        = b.total_value - b.total_cost;
    const plClass   = pl >= 0 ? "gain" : "loss";
    const isSelected = b.id === state.selectedBundleId;
    const statusBadge = b.status === "sold"
      ? `<span class="badge bg-success">Sold</span>`
      : `<span class="badge bg-primary">Active</span>`;
    return `<tr class="cursor-pointer ${isSelected ? "table-active" : ""}" onclick="selectBundle(${b.id})">
      <td><strong>${esc(b.name)}</strong></td>
      <td>${b.card_count}</td>
      <td>${fmt(b.total_cost)}</td>
      <td>${fmt(b.total_value)}</td>
      <td class="${plClass}">${(pl >= 0 ? "+" : "") + fmt(pl)}</td>
      <td>${statusBadge}</td>
      <td class="notes-cell" title="${esc(b.notes)}">${esc(b.notes)}</td>
      <td class="action-btns" onclick="event.stopPropagation()">
        <button class="btn btn-xs btn-outline-primary me-1" onclick="openEditBundleModal(${b.id})" title="Edit"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-xs btn-outline-danger" onclick="disbandBundle(${b.id})" title="Disband & delete"><i class="bi bi-x-circle"></i></button>
      </td>
    </tr>`;
  }).join("");
}

function selectBundle(id) {
  state.selectedBundleId = id;
  const b = state.bundles.find(x => x.id === id);
  if (b) renderBundleDetail(b);
  renderBundleList(state.bundles); // re-render to highlight selected row
}

function renderBundleDetail(b) {
  document.getElementById("bundle-detail-title").textContent = b.name;
  document.getElementById("bundle-detail").classList.remove("d-none");

  const tbody = document.getElementById("bundle-cards-tbody");
  const isSold = b.status === "sold";

  // Hide sell/edit/disband buttons for sold bundles
  document.querySelector("#bundle-detail .btn-success").classList.toggle("d-none", isSold);
  document.querySelector("#bundle-detail .btn-outline-danger").classList.toggle("d-none", isSold);
  document.querySelector("#bundle-detail .btn-outline-primary").classList.toggle("d-none", isSold);

  if (!b.cards.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-3">${isSold ? "Bundle sold — cards moved to Sold ledger." : "No cards in this bundle yet."}</td></tr>`;
  } else {
    tbody.innerHTML = b.cards.map(c => {
      const badge = c.label_type === "wrestling"
        ? `<span class="badge bg-danger">W</span>`
        : `<span class="badge bg-primary">S</span>`;
      return `<tr>
        <td>${badge}</td>
        <td><strong>${esc(c.display_name)}</strong>${c.quantity > 1 ? ` <span class="badge bg-info text-dark">×${c.quantity}</span>` : ""}</td>
        <td>${esc(c.set_name)}</td>
        <td><small class="text-muted">${esc(c.display_detail)}</small></td>
        <td>${fmt(c.cost)}</td>
        <td>${fmt(c.current_value)}</td>
        <td class="action-btns">
          ${isSold ? "" : `<button class="btn btn-xs btn-outline-danger" onclick="removeCardFromBundle('${c.label_type}',${c.id})" title="Remove from bundle"><i class="bi bi-x-lg"></i></button>`}
        </td>
      </tr>`;
    }).join("");
  }

  const totals = document.getElementById("bundle-card-totals");
  const pl = b.total_value - b.total_cost;
  const plClass = pl >= 0 ? "gain" : "loss";
  totals.innerHTML = `
    <span>${b.card_count} card${b.card_count !== 1 ? "s" : ""}</span>
    <span>Total Cost: <strong>${fmt(b.total_cost)}</strong></span>
    <span>Total Value: <strong>${fmt(b.total_value)}</strong></span>
    <span>P&L: <strong class="${plClass}">${(pl >= 0 ? "+" : "") + fmt(pl)}</strong></span>`;
}

// --- Create / Edit bundle ---

function openCreateBundleModal() {
  state.editBundleId = null;
  document.getElementById("createBundleTitle").textContent = "New Bundle";
  document.getElementById("cb-name").value  = "";
  document.getElementById("cb-notes").value = "";
  document.getElementById("createBundleSave").onclick = saveBundle;
  createBundleModal.show();
}

function openEditBundleModal(id) {
  const bundleId = id || state.selectedBundleId;
  if (!bundleId) return;
  state.editBundleId = bundleId;
  const b = state.bundles.find(x => x.id === bundleId);
  if (!b) return;
  document.getElementById("createBundleTitle").textContent = "Edit Bundle";
  document.getElementById("cb-name").value  = b.name;
  document.getElementById("cb-notes").value = b.notes;
  document.getElementById("createBundleSave").onclick = saveBundle;
  createBundleModal.show();
}

async function saveBundle() {
  const name = document.getElementById("cb-name").value.trim();
  if (!name) { alert("Bundle name is required."); return; }
  const body = { name, notes: document.getElementById("cb-notes").value.trim() };
  const url    = state.editBundleId ? `/api/bundles/${state.editBundleId}` : "/api/bundles";
  const method = state.editBundleId ? "PUT" : "POST";
  const res  = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const saved = await res.json();
  createBundleModal.hide();
  await loadBundles();
  // If we just created a new bundle and we're on the bundles tab, select it
  if (!state.editBundleId) selectBundle(saved.id);
}

async function disbandBundle(id) {
  const bundleId = id || state.selectedBundleId;
  if (!bundleId) return;
  const b = state.bundles.find(x => x.id === bundleId);
  if (!confirm(`Disband "${b ? b.name : "this bundle"}"? All cards will return to regular inventory.`)) return;
  await fetch(`/api/bundles/${bundleId}`, { method: "DELETE" });
  if (state.selectedBundleId === bundleId) {
    state.selectedBundleId = null;
    document.getElementById("bundle-detail").classList.add("d-none");
  }
  await loadBundles();
}

function disbandSelectedBundle() {
  disbandBundle(state.selectedBundleId);
}

// --- Assign cards to bundle from inventory tabs ---

async function openBundleAssignModal(tab) {
  const selected = state.selectedCards[tab];
  if (!selected.size) return;

  // Reset to "new bundle" mode
  document.getElementById("bm-new").checked = true;
  document.getElementById("ba-new-fields").classList.remove("d-none");
  document.getElementById("ba-existing-fields").classList.add("d-none");

  const count = selected.size;
  document.getElementById("bundleAssignTitle").textContent = `Add ${count} card${count !== 1 ? "s" : ""} to Bundle`;
  document.getElementById("bundleAssignSubtitle").textContent =
    `${count} card${count !== 1 ? "s" : ""} selected from the ${tab} tab.`;
  document.getElementById("ba-name").value  = "";
  document.getElementById("ba-notes").value = "";

  // Populate the existing-bundle dropdown with active bundles
  if (!state.bundles.length) state.bundles = await fetch("/api/bundles").then(r => r.json());
  const activeBundles = state.bundles.filter(b => b.status === "active");
  const sel = document.getElementById("ba-bundle-select");
  sel.innerHTML = `<option value="">— select a bundle —</option>` +
    activeBundles.map(b => `<option value="${b.id}">${esc(b.name)} (${b.card_count} cards)</option>`).join("");

  document.getElementById("bundleAssignSave").onclick = () => saveBundleAssign(tab);
  bundleAssignModal.show();
}

async function saveBundleAssign(tab) {
  const isNew = document.getElementById("bm-new").checked;
  const cards = [...state.selectedCards[tab]].map(id => ({ type: tab, id }));

  let bundleId;
  if (isNew) {
    const name = document.getElementById("ba-name").value.trim();
    if (!name) { alert("Bundle name is required."); return; }
    const body = { name, notes: document.getElementById("ba-notes").value.trim() };
    const res  = await fetch("/api/bundles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const newBundle = await res.json();
    bundleId = newBundle.id;
  } else {
    bundleId = parseInt(document.getElementById("ba-bundle-select").value);
    if (!bundleId) { alert("Select a bundle."); return; }
  }

  await fetch(`/api/bundles/${bundleId}/cards`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cards }),
  });

  bundleAssignModal.hide();
  // Clear selections
  state.selectedCards[tab].clear();
  updateBundleButton(tab);
  // Refresh the inventory tab so bundle badges appear
  if (tab === "wrestling") loadWrestling();
  else loadSoccer();
  // Refresh bundle cache
  state.bundles = await fetch("/api/bundles").then(r => r.json());
}

// --- Remove a card from the currently-selected bundle ---

async function removeCardFromBundle(cardType, cardId) {
  if (!state.selectedBundleId) return;
  if (!confirm("Remove this card from the bundle? It will return to regular inventory.")) return;
  await fetch(`/api/bundles/${state.selectedBundleId}/cards/${cardType}/${cardId}`, { method: "DELETE" });
  state.bundles = await fetch("/api/bundles").then(r => r.json());
  const b = state.bundles.find(x => x.id === state.selectedBundleId);
  if (b) renderBundleDetail(b);
  renderBundleList(state.bundles);
}

// --- Sell bundle ---

function openSellBundleModal() {
  if (!state.selectedBundleId) return;
  const b = state.bundles.find(x => x.id === state.selectedBundleId);
  if (!b || b.status === "sold") return;

  document.getElementById("sellBundleTitle").textContent = `Sell Bundle: ${b.name}`;

  // Show card list summary
  const listEl = document.getElementById("sell-bundle-card-list");
  if (b.cards.length) {
    listEl.innerHTML = b.cards.map(c => {
      const badge = c.label_type === "wrestling" ? "W" : "S";
      return `<div class="d-flex justify-content-between">
        <span><strong>[${badge}]</strong> ${esc(c.display_name)}${c.set_name ? ` — ${esc(c.set_name)}` : ""}</span>
        <span class="text-muted">Value: ${fmt(c.current_value)}</span>
      </div>`;
    }).join("");
  } else {
    listEl.innerHTML = `<span class="text-muted">No cards in bundle.</span>`;
  }

  document.getElementById("sb-price").value    = "0";
  document.getElementById("sb-fees").value     = "0";
  document.getElementById("sb-platform").value = "";
  document.getElementById("sb-date").value     = new Date().toISOString().slice(0, 10);
  document.getElementById("sb-notes").value    = "";
  document.getElementById("sellBundleSave").onclick = saveBundleSale;
  sellBundleModal.show();
}

async function saveBundleSale() {
  const price = parseFloat(document.getElementById("sb-price").value);
  if (!price || price <= 0) { alert("Enter a sale price greater than $0."); return; }
  const body = {
    sold_price: price,
    fees:       parseFloat(document.getElementById("sb-fees").value)     || 0,
    platform:   document.getElementById("sb-platform").value.trim(),
    sold_date:  document.getElementById("sb-date").value,
    notes:      document.getElementById("sb-notes").value.trim(),
  };
  const res = await fetch(`/api/bundles/${state.selectedBundleId}/sell`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) { alert("Error recording bundle sale."); return; }
  const data = await res.json();
  sellBundleModal.hide();
  state.selectedBundleId = null;
  document.getElementById("bundle-detail").classList.add("d-none");
  await loadBundles();
  loadNavStats();
  alert(`Bundle sold! ${data.sold_count} card${data.sold_count !== 1 ? "s" : ""} moved to Sold ledger.`);
}

// --- Checkbox management ---

function onCardCheck(tab, id, checked) {
  if (checked) state.selectedCards[tab].add(id);
  else         state.selectedCards[tab].delete(id);
  updateBundleButton(tab);
}

function updateBundleButton(tab) {
  const count = state.selectedCards[tab].size;
  const btn   = document.getElementById(`${tab === "wrestling" ? "w" : "s"}-bundle-btn`);
  const span  = document.getElementById(`${tab === "wrestling" ? "w" : "s"}-bundle-count`);
  if (btn)  btn.disabled = count === 0;
  if (span) span.textContent = count;
}

function selectAllCards(tab, checked) {
  const prefix = tab === "wrestling" ? "w" : "s";
  const tbody  = document.getElementById(`${prefix}-tbody`);
  // Set checked state on each row checkbox and fire the change event so
  // onCardCheck() updates state.selectedCards accordingly.
  tbody.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.checked = checked;
    cb.dispatchEvent(new Event("change"));
  });
}


// ---------------------------------------------------------------------------
// eBay comps
// ---------------------------------------------------------------------------

// Track which card the comps modal is open for so "Use this price" knows what to update
// formMode: true = fill the add/edit form's value field instead of saving to DB
const compsState = { type: null, id: null, formMode: false };

async function showCompsFromForm(type) {
  const name     = document.getElementById(type === "wrestling" ? "f-wrestler_name" : "f-player_name")?.value.trim();
  const cardType = document.getElementById("f-card_type")?.value.trim();
  const setName  = document.getElementById("f-set_name")?.value.trim();
  if (!name) { alert("Enter a name first."); return; }
  const suffix   = type === "soccer" ? "soccer card" : "card";
  const keywords = [name, cardType, setName, suffix].filter(Boolean).join(" ");
  compsState.type     = type;
  compsState.id       = null;
  compsState.formMode = true;
  await _showCompsModal(name, `/api/comps?q=${encodeURIComponent(keywords)}`);
}

async function showComps(type, id, name) {
  compsState.type     = type;
  compsState.id       = id;
  compsState.formMode = false;

  await _showCompsModal(name, `/api/${type}/${id}/comps`);
}

async function _showCompsModal(name, url) {
  // Reset modal to loading state
  document.getElementById("comps-loading").classList.remove("d-none");
  document.getElementById("comps-content").classList.add("d-none");
  document.getElementById("comps-empty").classList.add("d-none");
  document.getElementById("comps-error").classList.add("d-none");
  document.querySelector("#compsModal .modal-title").textContent = `eBay Comps — ${name}`;
  document.getElementById("comps-keywords").textContent = "";
  document.getElementById("comps-manual-price").value = "";
  compsModal.show();

  let data;
  try {
    const res = await fetch(url);
    data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
  } catch (err) {
    document.getElementById("comps-loading").classList.add("d-none");
    document.getElementById("comps-error").classList.remove("d-none");
    document.getElementById("comps-error").textContent = "Error fetching comps: " + err.message;
    return;
  }

  document.getElementById("comps-loading").classList.add("d-none");
  document.getElementById("comps-keywords").textContent = `Search: "${data.keywords}"`;

  if (!data.items || !data.items.length) {
    document.getElementById("comps-empty").classList.remove("d-none");
    document.getElementById("comps-empty-keywords").textContent = `Search used: "${data.keywords}"`;
    return;
  }

  // Populate suggestion bar — label depends on whether we got sold or asking prices
  const isSold = data.price_type === "sold";
  const typeLabel = isSold
    ? `<span class="badge bg-success me-1">Sold</span>`
    : `<span class="badge bg-secondary me-1">Asking</span>`;
  document.getElementById("comps-suggestion-text").innerHTML =
    `${typeLabel} Suggested price (avg of <strong>${data.items.length}</strong> ${isSold ? "sold" : "current listings"}): <strong>${fmt(data.suggested_price)}</strong>`;
  document.getElementById("comps-use-btn").onclick = () => applyCompPrice(data.suggested_price);

  // Second column header: date for sold, condition for asking
  document.getElementById("comps-col-2").textContent = isSold ? "Date" : "Condition";

  // Populate table
  document.getElementById("comps-tbody").innerHTML = data.items.map(item => `
    <tr>
      <td style="max-width:340px" class="text-truncate" title="${esc(item.title)}">${esc(item.title)}</td>
      <td class="text-nowrap"><small class="text-muted">${esc(isSold ? item.date : item.condition)}</small></td>
      <td class="text-nowrap"><strong>${fmt(item.price)}</strong></td>
      <td><a href="${esc(item.url)}" target="_blank" class="btn btn-xs btn-outline-secondary" title="View listing"><i class="bi bi-box-arrow-up-right"></i></a></td>
    </tr>`).join("");

  document.getElementById("comps-content").classList.remove("d-none");
}

function applyManualCompPrice(fromEmpty = false) {
  const inputId = fromEmpty ? "comps-manual-price-empty" : "comps-manual-price";
  const price   = parseFloat(document.getElementById(inputId).value);
  if (!price || price <= 0) { alert("Enter a price greater than $0."); return; }
  applyCompPrice(price);
}

async function applyCompPrice(price) {
  const { type, id, formMode } = compsState;

  if (formMode) {
    // Fill the add/edit form's value field — don't save yet
    const input = document.getElementById("f-current_value");
    if (input) input.value = price.toFixed(2);
    compsModal.hide();
    return;
  }

  if (!type || !id) return;

  // Fetch the card's current data so we can do a minimal update
  const listRes = await fetch(`/api/${type}?page=1&per_page=10000`);
  const list    = await listRes.json();
  const card    = list.cards.find(c => c.id === id);
  if (!card) { alert("Card not found."); return; }

  await fetch(`/api/${type}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...card, current_value: price }),
  });

  compsModal.hide();

  // Refresh the table so the new value shows immediately
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

/** Returns true for source values that represent a box purchase. */
function boxSourceSelected(source) {
  return ["Blaster Box","Hobby Box","Retail Pack","Hanger Box","Mega Box","Collector Box"].includes(source);
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
