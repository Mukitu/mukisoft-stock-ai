// ============================================================
// MukiSoft AI - 100% Dynamic Live Data & Interactive Controller
// ============================================================

const API_BASE_URL = "https://mukisoft-stock-ai.onrender.com";

const SECTOR_STOCKS = {
  "Pharmaceuticals & Chemicals": ["SQURPHARMA", "RENATA", "BXPHARMA", "ACMEPL", "BEACONPHAR", "ORIONPHARM", "ACI", "IBNSINA"],
  "Telecommunication": ["GP", "ROBI", "BSCCL"],
  "Bank": ["BRACBANK", "CITYBANK", "DUTCHBANGL", "EBL", "ISLAMIBANK", "PUBALIBANK", "PRIMEBANK", "MTB", "UCB"],
  "Engineering": ["WALTONHIL", "BSRMSTEEL", "BSRMLTD", "GPHISPAT", "SINGERBD", "RUNNERAUTO", "BBSCABLES"],
  "Fuel & Power": ["UPGDCL", "SUMITPOWER", "MJLPBD", "JAMUNAOIL", "MPETROLEUM", "PADMAOIL", "LINDEBD", "POWERGRID"],
  "Food & Allied": ["BATBC", "OLYMPIC", "UNILEVERCL", "AMCL(PRAN)", "APEXFOODS", "GOLDENSON"],
  "IT Sector": ["AAMRANET", "AAMRATECH", "AGNISYSL", "BDCOM", "GENEXIL", "INTRACO", "ITCON"],
  "Financial Institutions (NBFI)": ["LANKABAFIN", "IDLC", "DBH", "IPDC", "DELTALIFE", "GREENDELL"],
  "Textile & Garments": ["SQUARE", "ENVOYTEX", "MALEKSPIN", "MATINSPINN", "PARAMOUNT", "SAIHAMTEX"],
  "Cement & Ceramics": ["LAFARGEHOL", "HEIDELBCEM", "CONFIDCEM", "CROWNCEMNT", "RAKCEC", "MONNOCERA"]
};

let selectedExchange = "DSE";
let priceChartInstance = null;

document.addEventListener("DOMContentLoaded", () => {
  const menuBtn = document.getElementById("mobile-menu-btn");
  const mobileMenu = document.getElementById("mobile-menu");
  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener("click", () => mobileMenu.classList.toggle("hidden"));
  }

  loadDynamicLandingData();
  initSectorDropdowns();

  const params = new URLSearchParams(window.location.search);
  const urlSymbol = params.get("symbol");
  const urlExchange = params.get("exchange");
  if (document.getElementById("analyze-form")) {
    if (urlExchange) setExchange(urlExchange);
    if (urlSymbol) {
      document.getElementById("symbol-input").value = urlSymbol.toUpperCase();
      runStockAnalysis();
    }
  }
});

async function loadDynamicLandingData() {
  const dsexEl = document.getElementById("live-dsex");
  const ds30El = document.getElementById("live-ds30");
  const updEl = document.getElementById("live-updated");
  if (!dsexEl) return;

  // 1. Live Market Ticker
  try {
    const res = await fetch(`${API_BASE_URL}/api/market-live`);
    if (res.ok) {
      const mkt = await res.json();
      dsexEl.classList.remove("animate-pulse");
      dsexEl.innerText = mkt.dsex;
      if (ds30El) {
        ds30El.classList.remove("animate-pulse");
        ds30El.innerText = mkt.ds30;
      }
      if (updEl) updEl.innerText = mkt.updated;
    } else {
      dsexEl.innerText = "DSE Live";
      if (ds30El) ds30El.innerText = "CSE Live";
    }
  } catch (_) {
    dsexEl.innerText = "DSE Online";
    if (ds30El) ds30El.innerText = "CSE Online";
  }

  // 2. Live Terminal Card on Landing Page
  const sigEl = document.getElementById("sample-signal");
  try {
    const sampleRes = await fetch(`${API_BASE_URL}/api/analyze?symbol=SQURPHARMA&exchange=DSE`);
    if (sampleRes.ok) {
      const sData = await sampleRes.json();
      document.getElementById("sample-price").innerText = `৳ ${Number(sData.current_price).toFixed(2)}`;
      document.getElementById("sample-target").innerText = `৳ ${sData.target_price}`;
      document.getElementById("sample-stoploss").innerText = `৳ ${sData.stop_loss}`;
      if (sigEl) {
        sigEl.classList.remove("animate-pulse");
        sigEl.innerText = `${sData.signal} • ${sData.confidence}%`;
      }
      document.getElementById("sample-ai-text").innerText = `"${sData.ai_analysis_bn}"`;
    } else if (sigEl) {
      sigEl.classList.remove("animate-pulse");
      sigEl.innerText = "টার্মিনাল প্রস্তুত";
      document.getElementById("sample-ai-text").innerText =
        "যেকোনো শেয়ারের রিয়েল-টাইম বিশ্লেষণ দেখতে উপরের সার্চ বক্সে কোম্পানির কোড লিখে 'বিশ্লেষণ দেখুন' বাটনে ক্লিক করুন।";
    }
  } catch (_) {
    if (sigEl) {
      sigEl.classList.remove("animate-pulse");
      sigEl.innerText = "টার্মিনাল প্রস্তুত";
    }
  }
}

function initSectorDropdowns() {
  const sectorSelect = document.getElementById("sector-select");
  const stockSelect = document.getElementById("stock-select");
  const symbolInput = document.getElementById("symbol-input");
  if (!sectorSelect || !stockSelect) return;

  Object.keys(SECTOR_STOCKS).forEach((sector) => {
    const opt = document.createElement("option");
    opt.value = sector;
    opt.innerText = sector;
    sectorSelect.appendChild(opt);
  });

  function updateStockOptions() {
    const chosenSector = sectorSelect.value;
    stockSelect.innerHTML = `<option value="">-- কোম্পানি সিলেক্ট করুন --</option>`;
    (SECTOR_STOCKS[chosenSector] || []).forEach((sym) => {
      const opt = document.createElement("option");
      opt.value = sym;
      opt.innerText = sym;
      stockSelect.appendChild(opt);
    });
  }

  sectorSelect.addEventListener("change", updateStockOptions);
  stockSelect.addEventListener("change", () => {
    if (stockSelect.value && symbolInput) {
      symbolInput.value = stockSelect.value;
    }
  });

  updateStockOptions();
}

function setExchange(ex) {
  selectedExchange = ex;
  const dseBtn = document.getElementById("btn-dse");
  const cseBtn = document.getElementById("btn-cse");
  if (!dseBtn || !cseBtn) return;

  if (ex === "DSE") {
    dseBtn.className = "px-5 py-2.5 rounded-lg text-sm font-bold bg-blue-600 text-white shadow-lg transition";
    cseBtn.className = "px-5 py-2.5 rounded-lg text-sm font-bold text-slate-400 hover:text-white transition";
  } else {
    cseBtn.className = "px-5 py-2.5 rounded-lg text-sm font-bold bg-blue-600 text-white shadow-lg transition";
    dseBtn.className = "px-5 py-2.5 rounded-lg text-sm font-bold text-slate-400 hover:text-white transition";
  }
}

async function runStockAnalysis(e) {
  if (e) e.preventDefault();
  const symbol = document.getElementById("symbol-input").value.trim().toUpperCase();
  if (!symbol) return;

  const loader = document.getElementById("loader-box");
  const manualBox = document.getElementById("manual-fallback-box");
  const resultBox = document.getElementById("result-dashboard");
  const submitBtn = document.getElementById("submit-btn");

  manualBox.classList.add("hidden");
  resultBox.classList.add("hidden");
  loader.classList.remove("hidden");
  submitBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE_URL}/api/analyze?symbol=${encodeURIComponent(symbol)}&exchange=${selectedExchange}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || "Auto-fetch failed");
    }

    renderDashboard(data);
    loader.classList.add("hidden");
    resultBox.classList.remove("hidden");
  } catch (err) {
    loader.classList.add("hidden");
    document.getElementById("manual-symbol-label").innerText = `${symbol} (${selectedExchange})`;
    manualBox.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
  }
}

async function runManualAnalysis(e) {
  e.preventDefault();
  const symbol = document.getElementById("symbol-input").value.trim().toUpperCase() || "CUSTOM";
  const payload = {
    symbol: symbol,
    exchange: selectedExchange,
    open_price: parseFloat(document.getElementById("m-open").value),
    high_price: parseFloat(document.getElementById("m-high").value),
    low_price: parseFloat(document.getElementById("m-low").value),
    close_price: parseFloat(document.getElementById("m-close").value),
    volume: parseFloat(document.getElementById("m-volume").value) || 100000,
    sma_20: parseFloat(document.getElementById("m-sma").value),
    rsi_14: parseFloat(document.getElementById("m-rsi").value) || 50.0
  };

  const loader = document.getElementById("loader-box");
  const resultBox = document.getElementById("result-dashboard");
  loader.classList.remove("hidden");

  try {
    const res = await fetch(`${API_BASE_URL}/api/analyze-manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    renderDashboard(data);
    loader.classList.add("hidden");
    resultBox.classList.remove("hidden");
  } catch (err) {
    loader.classList.add("hidden");
    alert("সার্ভারের সাথে সংযোগ হচ্ছে না। একটু পর আবার চেষ্টা করুন।");
  }
}

function renderDashboard(data) {
  document.getElementById("res-symbol").innerText = `${data.symbol} (${data.exchange})`;
  document.getElementById("res-price").innerText = `৳ ${Number(data.current_price).toFixed(2)}`;
  document.getElementById("res-rsi").innerText = data.rsi;
  document.getElementById("res-confidence").innerText = `${data.confidence}%`;
  document.getElementById("res-target").innerText = `৳ ${data.target_price}`;
  document.getElementById("res-stoploss").innerText = `৳ ${data.stop_loss}`;
  document.getElementById("res-ai-text").innerText = data.ai_analysis_bn;

  const badge = document.getElementById("res-signal-badge");
  badge.innerText = data.signal;
  if (data.signal_code === 2) {
    badge.className = "inline-block px-3.5 py-1.5 rounded-lg text-sm font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30";
  } else if (data.signal_code === 0) {
    badge.className = "inline-block px-3.5 py-1.5 rounded-lg text-sm font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30";
  } else {
    badge.className = "inline-block px-3.5 py-1.5 rounded-lg text-sm font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30";
  }

  const ctx = document.getElementById("stockChart");
  if (ctx && data.chart_history) {
    if (priceChartInstance) priceChartInstance.destroy();
    priceChartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels: data.chart_history.map((d) => d.date),
        datasets: [{
          label: `${data.symbol} Price (BDT)`,
          data: data.chart_history.map((d) => d.close),
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59, 130, 246, 0.15)",
          borderWidth: 2.5,
          fill: true,
          tension: 0.35
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: "rgba(148, 163, 184, 0.08)" }, ticks: { color: "#94a3b8" } },
          y: { grid: { color: "rgba(148, 163, 184, 0.08)" }, ticks: { color: "#94a3b8" } }
        }
      }
    });
  }
}