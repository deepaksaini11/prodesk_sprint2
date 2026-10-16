/* ---------- State ---------- */
const STORAGE_KEY = "cashflow_state_v1";
const SYMBOLS = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };

// All amounts are stored in INR (base currency). Display converts using `rate`.
let state = { salary: 0, expenses: [] };
let currency = "INR";
let rate = 1;
let chart = null;

/* ---------- DOM refs ---------- */
const $ = (id) => document.getElementById(id);
const salaryForm = $("salaryForm"), expenseForm = $("expenseForm");
const salaryInput = $("salary"), nameInput = $("expName"), amountInput = $("expAmount");
const salaryError = $("salaryError"), expenseError = $("expenseError");
const salaryDisplay = $("salaryDisplay"), expensesDisplay = $("expensesDisplay"), balanceDisplay = $("balance");
const listEl = $("expenseList"), alertBanner = $("alertBanner");
const currencySelect = $("currency"), downloadBtn = $("downloadBtn");

/* ---------- Persistence ---------- */
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Could not save to localStorage", e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.salary = Number(parsed.salary) || 0;
    state.expenses = Array.isArray(parsed.expenses) ? parsed.expenses : [];
  } catch (e) {
    console.error("Could not read localStorage", e);
    state = { salary: 0, expenses: [] };
  }
}

/* ---------- Helpers ---------- */
const totalExpenses = () => state.expenses.reduce((sum, e) => sum + Number(e.amount), 0);
const remaining = () => state.salary - totalExpenses();
const fmt = (inrValue) => `${SYMBOLS[currency]}${(inrValue * rate).toFixed(2)}`;

function setError(el, input, msg) {
  el.textContent = msg;
  if (input) input.classList.toggle("invalid", Boolean(msg));
}

/* ---------- Validation ---------- */
function validNumber(raw) {
  if (raw.trim() === "") return { ok: false, msg: "This field cannot be empty." };
  const n = Number(raw);
  if (Number.isNaN(n)) return { ok: false, msg: "Enter a valid number." };
  if (n < 0) return { ok: false, msg: "Value cannot be negative." };
  return { ok: true, value: n };
}

/* ---------- Render ---------- */
function render() {
  const total = totalExpenses();
  const bal = remaining();

  salaryDisplay.textContent = fmt(state.salary);
  expensesDisplay.textContent = fmt(total);
  balanceDisplay.textContent = fmt(bal);

  // Threshold alert: balance below 10% of salary
  const low = state.salary > 0 && bal < state.salary * 0.1;
  balanceDisplay.classList.toggle("low", low);
  alertBanner.classList.toggle("show", low);

  // Expense list
  listEl.innerHTML = "";
  if (state.expenses.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No expenses yet. Add one using the form.";
    listEl.appendChild(li);
  } else {
    state.expenses.forEach((exp) => {
      const li = document.createElement("li");

      const name = document.createElement("span");
      name.textContent = exp.name;

      const amt = document.createElement("span");
      amt.className = "amt";
      amt.textContent = fmt(Number(exp.amount));

      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "🗑";
      del.setAttribute("aria-label", `Delete ${exp.name}`);
      del.addEventListener("click", () => deleteExpense(exp.id));

      li.append(name, amt, del);
      listEl.appendChild(li);
    });
  }

  renderChart(total, bal);
}

function renderChart(total, bal) {
  const data = [Math.max(bal, 0) * rate, total * rate];
  if (chart) {
    chart.data.datasets[0].data = data;
    chart.update();
    return;
  }
  chart = new Chart($("pieChart"), {
    type: "pie",
    data: {
      labels: ["Remaining Balance", "Total Expenses"],
      datasets: [{ data, backgroundColor: ["#1f6f50", "#c62828"] }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

/* ---------- Actions ---------- */
function deleteExpense(id) {
  state.expenses = state.expenses.filter((e) => e.id !== id);
  saveState();
  render();
}

salaryForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const r = validNumber(salaryInput.value);
  if (!r.ok) return setError(salaryError, salaryInput, r.msg);
  setError(salaryError, salaryInput, "");
  // Input is entered in the currently selected currency; store in INR.
  state.salary = r.value / rate;
  saveState();
  salaryInput.value = "";
  render();
});

expenseForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  const amt = validNumber(amountInput.value);

  if (!name) return setError(expenseError, nameInput, "Expense name cannot be empty.");
  nameInput.classList.remove("invalid");
  if (!amt.ok) return setError(expenseError, amountInput, amt.msg);

  setError(expenseError, amountInput, "");
  state.expenses.push({ id: Date.now() + Math.random(), name, amount: amt.value / rate });
  saveState();
  nameInput.value = "";
  amountInput.value = "";
  render();
});

/* ---------- Currency conversion (Frankfurter, keyless) ---------- */
currencySelect.addEventListener("change", async () => {
  const target = currencySelect.value;
  if (target === "INR") {
    currency = "INR";
    rate = 1;
    return render();
  }
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=INR&to=${target}`);
    if (!res.ok) throw new Error("API error " + res.status);
    const json = await res.json();
    rate = json.rates[target];
    currency = target;
    render();
  } catch (err) {
    console.error(err);
    alert("Could not fetch exchange rate. Showing INR.");
    currencySelect.value = "INR";
    currency = "INR";
    rate = 1;
    render();
  }
});

/* ---------- PDF report (jsPDF) ---------- */
downloadBtn.addEventListener("click", () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  // Standard PDF fonts lack the ₹ glyph, so use currency codes in the PDF.
  const money = (v) => `${currency} ${(v * rate).toFixed(2)}`;
  let y = 20;

  doc.setFontSize(18);
  doc.text("Cash-Flow Report", 14, y); y += 10;
  doc.setFontSize(11);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, y); y += 10;
  doc.text(`Total Salary: ${money(state.salary)}`, 14, y); y += 8;
  doc.text("Expenses:", 14, y); y += 8;

  if (state.expenses.length === 0) {
    doc.text("  (none)", 14, y); y += 8;
  } else {
    state.expenses.forEach((exp, i) => {
      if (y > 275) { doc.addPage(); y = 20; }
      doc.text(`  ${i + 1}. ${exp.name}: ${money(Number(exp.amount))}`, 14, y);
      y += 7;
    });
  }

  y += 4;
  if (y > 270) { doc.addPage(); y = 20; }
  doc.text(`Total Expenses: ${money(totalExpenses())}`, 14, y); y += 8;
  doc.setFontSize(13);
  doc.text(`Remaining Balance: ${money(remaining())}`, 14, y);
  doc.save("cash-flow-report.pdf");
});

/* ---------- Init ---------- */
loadState();
render();
