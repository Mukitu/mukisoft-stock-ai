// ============================================================
// MukiSoft AI - Live Scraper First + Image/PDF Document Fallback
// ============================================================

const API_BASE_URL = "https://mukisoft-stock-ai.onrender.com";

const SECTOR_STOCKS = {
  "Bank": ["BRACBANK", "CITYBANK", "DUTCHBANGL", "EBL", "ISLAMIBANK", "PUBALIBANK", "PRIMEBANK", "MTB", "UCB"],
  "Pharmaceuticals & Chemicals": ["SQURPHARMA", "RENATA", "BXPHARMA", "ACMEPL", "BEACONPHAR", "ORIONPHARM", "ACI", "IBNSINA"],
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
let selectedDocFile = null;

document.addEventListener("DOMContentLoaded", () => {
  const menuBtn = document.getElementById("mobile-menu-btn");
  const mobileMenu = document.getElementById("mobile-menu");
  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener("click", () => mobileMenu.classList.toggle("hidden"));
  }

  loadDynamicLandingData();
  initSectorDropdowns();

  // Clipboard paste support (Cmd+V / Ctrl+V)
  window.addEventListener("paste", (e) => {
    const fallbackBox = document.getElementById("screenshot-fallback-box");
    if (!fallbackBox || fallbackBox.classList.contains("hidden")) return;
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
      if (item.type.indexOf("image") !== -1) {
        setDocumentPreview(item.getAsFile());
        break;
      }
    }
  });

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
  const fallbackBox = document.getElementById("screenshot-fallback-box");
  const resultBox = document.getElementById("result-dashboard");
  const submitBtn = document.getElementById("submit-btn");

  // Always hide upload box first and try live scraping
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
    document.getElementById("fallback-symbol-label").innerText = `${symbol} (${selectedExchange})`;
    document.getElementById("dse-direct-link").href = `https://www.dse.com.bd/company/${encodeURIComponent(symbol)}`;
    document.getElementById("cse-direct-link").href = `https://www.cse.com.bd/market/current_price`;
    fallbackBox.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
  }
}

function previewDocument(input) {
  if (input.files && input.files[0]) {
    setDocumentPreview(input.files[0]);
  }
}

function setDocumentPreview(file) {
  selectedDocFile = file;
  const img = document.getElementById("screenshot-preview");
  const pdfBadge = document.getElementById("pdf-preview-badge");
  const placeholder = document.getElementById("upload-placeholder");

  placeholder.classList.add("hidden");
  img.classList.add("hidden");
  pdfBadge.classList.add("hidden");

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    pdfBadge.innerText = `📄 PDF সংযুক্ত হয়েছে: ${file.name}`;
    pdfBadge.classList.remove("hidden");
  } else {
    const reader = new FileReader();
    reader.onload = (e) => {
      img.src = e.target.result;
      img.classList.remove("hidden");
    };
    reader.readAsDataURL(file);
  }
}

async function runDocumentAnalysis(e) {
  e.preventDefault();
  if (!selectedDocFile) {
    alert("অনুগ্রহ করে একটি স্ক্রিনশট (Image) অথবা PDF ফাইল সিলেক্ট করুন।");
    return;
  }

  const symbol = document.getElementById("symbol-input").value.trim().toUpperCase() || "STOCK";
  const formData = new FormData();
  formData.append("file", selectedDocFile);
  formData.append("symbol", symbol);
  formData.append("exchange", selectedExchange);

  const loader = document.getElementById("loader-box");
  const resultBox = document.getElementById("result-dashboard");
  const btn = document.getElementById("doc-submit-btn");

  resultBox.classList.add("hidden");
  document.getElementById("loader-text").innerText = "MukiSoft AI ফাইল থেকে ডেটা পড়ে বিশ্লেষণ করছে...";
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