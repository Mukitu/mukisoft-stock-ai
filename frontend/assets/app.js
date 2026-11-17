// ============================================================
// MukiSoft AI - Live Scraper + Multi-File Upload + Manual Input
// ============================================================

const API_BASE_URL = "https://mukisoft-stock-ai.onrender.com";

const SECTOR_STOCKS = {
  "Pharmaceuticals & Chemicals": ["ACI", "SQURPHARMA", "RENATA", "BXPHARMA", "ACMEPL", "BEACONPHAR", "ORIONPHARM", "IBNSINA"],
  "Bank": ["BRACBANK", "CITYBANK", "DUTCHBANGL", "EBL", "ISLAMIBANK", "PUBALIBANK", "PRIMEBANK", "MTB", "UCB"],
  "Telecommunication": ["GP", "ROBI", "BSCCL"],
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
let uploadedFilesList = []; // Supports multiple images & PDFs with individual delete

document.addEventListener("DOMContentLoaded", () => {
  const menuBtn = document.getElementById("mobile-menu-btn");
  const mobileMenu = document.getElementById("mobile-menu");
  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener("click", () => mobileMenu.classList.toggle("hidden"));
  }

  loadDynamicLandingData();
  initSectorDropdowns();
  updateOfficialLinks();

  // Clipboard paste support (Cmd+V / Ctrl+V) adds to file list
  window.addEventListener("paste", (e) => {
    const fallbackBox = document.getElementById("screenshot-fallback-box");
    if (!fallbackBox || fallbackBox.classList.contains("hidden")) return;
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    const pastedFiles = [];
    for (const item of items) {
      if (item.type.indexOf("image") !== -1) {
        pastedFiles.push(item.getAsFile());
      }
    }
    if (pastedFiles.length > 0) handleFilesAdded(pastedFiles);
  });

  const params = new URLSearchParams(window.location.search);
  const urlSymbol = params.get("symbol");
  const urlExchange = params.get("exchange");
  if (document.getElementById("analyze-form")) {
    if (urlExchange) setExchange(urlExchange);
    if (urlSymbol) {
      document.getElementById("symbol-input").value = urlSymbol.toUpperCase();
      updateOfficialLinks();
      runStockAnalysis();
    }
  }
});

function updateOfficialLinks() {
  const input = document.getElementById("symbol-input");
  if (!input) return;
  const sym = input.value.trim().toUpperCase() || "ACI";
  const dseLink = document.getElementById("dse-direct-link");
  const cseLink = document.getElementById("cse-direct-link");
  const label = document.getElementById("fallback-symbol-label");

  if (dseLink) dseLink.href = `https://www.dse.com.bd/company/${encodeURIComponent(sym)}`;
  if (cseLink) cseLink.href = `https://www.cse.com.bd/company/companydetails/${encodeURIComponent(sym)}`;
  if (label) label.innerText = `${sym} (${selectedExchange})`;
}

async function loadDynamicLandingData() {
  const dsexEl = document.getElementById("live-dsex");
  const ds30El = document.getElementById("live-ds30");
  const updEl = document.getElementById("live-updated");
  if (!dsexEl) return;

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
    }
  } catch (_) {}

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
    }
  } catch (_) {}
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
      updateOfficialLinks();
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
  updateOfficialLinks();
}

async function runStockAnalysis(e) {
  if (e) e.preventDefault();
  const symbol = document.getElementById("symbol-input").value.trim().toUpperCase();
  if (!symbol) return;

  updateOfficialLinks();

  const loader = document.getElementById("loader-box");
  const fallbackBox = document.getElementById("screenshot-fallback-box");
  const resultBox = document.getElementById("result-dashboard");
  const submitBtn = document.getElementById("submit-btn");

  fallbackBox.classList.add("hidden");
  resultBox.classList.add("hidden");
  document.getElementById("loader-text").innerText = `${symbol} (${selectedExchange})-এর রিয়েল-টাইম ডেটা স্ক্র্যাপ করা হচ্ছে...`;
  loader.classList.remove("hidden");
  submitBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE_URL}/api/analyze?symbol=${encodeURIComponent(symbol)}&exchange=${selectedExchange}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || "Live scrape failed");
    }

    renderDashboard(data);
    loader.classList.add("hidden");
    resultBox.classList.remove("hidden");
  } catch (err) {
    loader.classList.add("hidden");
    fallbackBox.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
  }
}

// Multi-File Add & Individual Delete Functions
function handleFilesAdded(fileList) {
  for (const file of fileList) {
    uploadedFilesList.push(file);
  }
  const input = document.getElementById("doc-input");
  if (input) input.value = ""; // Reset input so same file can be re-added if deleted
  renderFileList();
}

function removeFileAtIndex(idx) {
  uploadedFilesList.splice(idx, 1);
  renderFileList();
}

function renderFileList() {
  const container = document.getElementById("file-list-container");
  if (!container) return;

  if (uploadedFilesList.length === 0) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  container.classList.remove("hidden");
  container.innerHTML = "";

  uploadedFilesList.forEach((file, index) => {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const card = document.createElement("div");
    card.className = "flex items-center justify-between gap-2 bg-slate-900 border border-slate-700 rounded-xl p-3";

    const info = document.createElement("div");
    info.className = "flex items-center gap-2.5 overflow-hidden";
    info.innerHTML = `
      <span class="text-lg shrink-0">${isPdf ? "📄" : "🖼️"}</span>
      <span class="text-xs text-slate-200 font-medium truncate">${file.name}</span>
    `;

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.innerText = "✕";
    delBtn.title = "ফাইলটি ডিলিট করুন";
    delBtn.className = "w-7 h-7 rounded-lg bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white text-xs font-bold shrink-0 transition cursor-pointer";
    delBtn.onclick = () => removeFileAtIndex(index);

    card.appendChild(info);
    card.appendChild(delBtn);
    container.appendChild(card);
  });
}

async function runDocumentAnalysis(e) {
  e.preventDefault();
  if (uploadedFilesList.length === 0) {
    alert("অনুগ্রহ করে অন্তত একটি স্ক্রিনশট (Image) অথবা PDF ফাইল যোগ করুন।");
    return;
  }

  const symbol = document.getElementById("symbol-input").value.trim().toUpperCase() || "STOCK";
  const formData = new FormData();
  uploadedFilesList.forEach((file) => {
    formData.append("files", file);
  });
  formData.append("symbol", symbol);
  formData.append("exchange", selectedExchange);

  const loader = document.getElementById("loader-box");
  const resultBox = document.getElementById("result-dashboard");
  const btn = document.getElementById("doc-submit-btn");

  resultBox.classList.add("hidden");
  document.getElementById("loader-text").innerText = `${uploadedFilesList.length}টি ফাইল থেকে MukiSoft AI বিশ্লেষণ করছে...`;
  loader.classList.remove("hidden");
  btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE_URL}/api/analyze-document`, {
      method: "POST",
      body: formData
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || "বিশ্লেষণ করা যায়নি।");
    }

    renderDashboard(data);
    loader.classList.add("hidden");
    resultBox.classList.remove("hidden");
  } catch (err) {
    loader.classList.add("hidden");
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function runManualAnalysis(e) {
  e.preventDefault();
  const symbol = document.getElementById("symbol-input").value.trim().toUpperCase() || "STOCK";
  const payload = {
    symbol: symbol,
    exchange: selectedExchange,
    open_price: parseFloat(document.getElementById("m-open").value),
    high_price: parseFloat(document.getElementById("m-high").value),
    low_price: parseFloat(document.getElementById("m-low").value),
    close_price: parseFloat(document.getElementById("m-close").value),
    yesterday_close: parseFloat(document.getElementById("m-ycp").value) || 0
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