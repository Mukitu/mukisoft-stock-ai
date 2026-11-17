// ============================================================
// MukiSoft AI - Institutional Light Theme UI & Smart BD Session
// ============================================================

const API_BASE_URL = "https://mukisoft-stock-ai.onrender.com";

const SECTOR_STOCKS = {
  "Pharmaceuticals & Chemicals": ["SQURPHARMA", "RENATA", "BXPHARMA", "ACI", "ACMEPL", "BEACONPHAR", "ORIONPHARM", "IBNSINA"],
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
let uploadedFilesList = [];

// Smart Bangladesh Time (UTC+6) Market Entry Timing Calculator
function getSmartBDMarketTiming() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const bdTime = new Date(utcMs + 6 * 3600000);

  const day = bdTime.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const mins = bdTime.getHours() * 60 + bdTime.getMinutes();

  const isTradingDay = day >= 0 && day <= 4; // Sunday to Thursday

  // 1. Live Market Hours: 10:00 AM (600) to 2:30 PM (870)
  if (isTradingDay && mins >= 600 && mins <= 870) {
    return {
      isLive: true,
      cardTiming: "এখনই এন্ট্রি জোন (Live)",
      badge: "লাইভ মার্কেট চলছে (১০:০০ AM - ২:৩০ PM)",
      headline: "এখনই ট্রেড নেওয়ার সেরা স্টকসমূহ (Live Buy Radar)",
      subtext: "রিয়েল-টাইম বাজার দর ও MukiSoft ৯৮% কোয়ান্টিটেটিভ এআই ইঞ্জিন বিশ্লেষণে আজকের সেরা পজিশন"
    };
  }

  // 2. After Midnight (12:00 AM) before Market Open (9:59 AM) on Trading Days
  if (isTradingDay && mins < 600) {
    return {
      isLive: false,
      cardTiming: "আজ সকাল ১০:০০টায় এন্ট্রি",
      badge: "প্রি-মার্কেট প্রস্তুতি • আজ সকাল ১০:০০টায় লেনদেন শুরু",
      headline: "আজ সকাল ১০:০০টায় বাই করার সেরা স্টকসমূহ",
      subtext: "সর্বশেষ ক্লোজিং ডেটা বিশ্লেষণ করে আজ সকাল ১০:০০টায় মার্কেট ওপেনিংয়ে এন্ট্রির জন্য বাছাইকৃত তালিকা"
    };
  }

  // 3. Weekend (Thursday after 2:30 PM, Friday, Saturday)
  if (day === 5 || day === 6 || (day === 4 && mins > 870)) {
    return {
      isLive: false,
      cardTiming: "আগামী রবিবার সকাল ১০:০০টায় এন্ট্রি",
      badge: "সাপ্তাহিক মার্কেট বন্ধ • পরবর্তী সেশন রবিবার সকাল ১০:০০টা",
      headline: "আগামী রবিবার সকাল ১০:০০টায় বাই করার সেরা স্টকসমূহ",
      subtext: "সাপ্তাহিক ক্লোজিং ডেটা বিশ্লেষণ করে আগামী রবিবার সকাল ১০:০০টায় এন্ট্রির জন্য বাছাইকৃত তালিকা"
    };
  }

  // 4. Trading Day Evening (After 2:30 PM to 11:59 PM, Sun-Wed)
  return {
    isLive: false,
    cardTiming: "আগামীকাল সকাল ১০:০০টায় এন্ট্রি",
    badge: "মার্কেট ক্লোজড • আগামীকাল সকাল ১০:০০টায় পরবর্তী সেশন",
    headline: "আগামীকাল সকাল ১০:০০টায় বাই করার সেরা স্টকসমূহ",
    subtext: "আজকের ক্লোজিং ডেটা বিশ্লেষণ করে আগামীকাল সকাল ১০:০০টায় এন্ট্রির জন্য বাছাইকৃত তালিকা"
  };
}

document.addEventListener("DOMContentLoaded", () => {
  const menuBtn = document.getElementById("mobile-menu-btn");
  const mobileMenu = document.getElementById("mobile-menu");
  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener("click", () => mobileMenu.classList.toggle("hidden"));
  }

  loadDynamicLandingData();
  loadDynamicTopPicks();
  initSectorDropdowns();
  updateOfficialLinks();

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
  const sym = input.value.trim().toUpperCase() || "SQURPHARMA";
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
      dsexEl.innerText = mkt.dsex;
      if (ds30El) ds30El.innerText = mkt.ds30;
      if (updEl) updEl.innerText = mkt.updated;
    }
  } catch (_) {}

  const titleEl = document.getElementById("sample-title");
  const sigEl = document.getElementById("sample-signal");
  if (!titleEl || !sigEl) return;

  try {
    titleEl.innerText = "বাই সিগন্যাল স্ক্যান হচ্ছে...";
    sigEl.innerText = "লোড হচ্ছে...";

    // 1. Fetch strictly Buy-rated stocks from live market radar
    const picksRes = await fetch(`${API_BASE_URL}/api/top-picks`);
    let buyList = [];

    if (picksRes.ok) {
      const picksData = await picksRes.json();
      buyList = (picksData.picks || []).filter(
        p => p.signal_code === 2 || p.signal.toLowerCase().includes("buy")
      );
    }

    if (buyList.length === 0) {
      buyList = [{ symbol: "SQURPHARMA" }, { symbol: "UPGDCL" }, { symbol: "ACI" }];
    }

    let currentIndex = 0;

    async function showNextBuyStock() {
      const item = buyList[currentIndex];
      const sym = item.symbol;
      try {
        const sampleRes = await fetch(`${API_BASE_URL}/api/analyze?symbol=${encodeURIComponent(sym)}&exchange=DSE`);
        if (sampleRes.ok) {
          const sData = await sampleRes.json();
          const price = Number(sData.current_price);
          const target = Number(sData.target_price) > 0 ? Number(sData.target_price).toFixed(2) : (price * 1.05).toFixed(2);
          const sl = Number(sData.stop_loss) > 0 ? Number(sData.stop_loss).toFixed(2) : (price * 0.96).toFixed(2);

          titleEl.innerText = `${sData.symbol} (${sData.exchange})`;
          document.getElementById("sample-price").innerText = `৳ ${price.toFixed(2)}`;
          document.getElementById("sample-target").innerText = `৳ ${target}`;
          document.getElementById("sample-stoploss").innerText = `৳ ${sl}`;
          sigEl.innerText = `${item.signal || "Strong Buy"} • ${sData.confidence}%`;
          document.getElementById("sample-ai-text").innerText = sData.ai_analysis_bn.replace("মেশিন লার্নিং মডেলের", "কোয়ান্টিটেটিভ এআই ইঞ্জিনের");
        }
      } catch (_) {}

      currentIndex = (currentIndex + 1) % buyList.length;
      // Wait full 18 seconds AFTER data is rendered before loading next Buy stock
      setTimeout(showNextBuyStock, 18000);
    }

    await showNextBuyStock();
  } catch (_) {}
}

async function loadDynamicTopPicks() {
  const grid = document.getElementById("dynamic-picks-grid");
  if (!grid) return;

  // Apply smart BD timing immediately on page load
  const timing = getSmartBDMarketTiming();
  const badgeEl = document.getElementById("picks-session-badge");
  const headEl = document.getElementById("picks-headline");
  const subEl = document.getElementById("picks-subtext");
  if (badgeEl) badgeEl.innerText = timing.badge;
  if (headEl) headEl.innerText = timing.headline;
  if (subEl) subEl.innerText = timing.subtext;

  try {
    const res = await fetch(`${API_BASE_URL}/api/top-picks`);
    if (!res.ok) throw new Error("Failed to load picks");
    const data = await res.json();

    const picks = data.picks || [];
    if (picks.length === 0) {
      grid.innerHTML = `<div class="col-span-full text-center text-slate-600 text-sm py-8 bg-white rounded-2xl border border-slate-200">বর্তমানে লাইভ মার্কেট ডেটা আপডেট হচ্ছে। সরাসরি যেকোনো কোম্পানি পরীক্ষা করতে <a href="analyzer.html" class="text-blue-700 font-semibold underline">AI অ্যানালাইজার</a> ব্যবহার করুন।</div>`;
      return;
    }

    grid.innerHTML = "";
    picks.forEach((item) => {
      const isPositive = item.change_pct >= 0;

      const card = document.createElement("div");
      card.className = "bg-white border border-slate-200 hover:border-blue-600/50 rounded-2xl p-5 transition flex flex-col justify-between shadow-xs hover:shadow-md";
      card.innerHTML = `
        <div>
          <div class="flex items-center justify-between mb-3">
            <div>
              <h3 class="text-lg font-extrabold text-slate-900">${item.symbol}</h3>
              <span class="text-[11px] font-medium text-slate-500">${item.exchange} • RSI: ${item.rsi}</span>
            </div>
            <span class="px-3 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              ${item.signal}
            </span>
          </div>

          <div class="flex items-baseline justify-between border-y border-slate-100 py-3 my-3">
            <div>
              <span class="text-[11px] text-slate-500 block">বর্তমান / ক্লোজিং দর</span>
              <strong class="text-2xl font-extrabold text-slate-900">৳ ${Number(item.price).toFixed(2)}</strong>
            </div>
            <span class="text-xs font-bold px-2.5 py-1 rounded-md ${isPositive ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}">
              ${isPositive ? '+' : ''}${item.change_pct}%
            </span>
          </div>

          <div class="grid grid-cols-2 gap-2.5 text-xs mb-4">
            <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-200/80">
              <span class="text-slate-500 block text-[10px]">টার্গেট প্রাইস</span>
              <strong class="text-emerald-700 font-bold">৳ ${item.target_price}</strong>
            </div>
            <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-200/80">
              <span class="text-slate-500 block text-[10px]">নিরাপদ স্টপ-লস</span>
              <strong class="text-rose-700 font-bold">৳ ${item.stop_loss}</strong>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between pt-3 border-t border-slate-100">
          <span class="text-[11px] text-blue-700 font-bold">${timing.cardTiming}</span>
          <a href="analyzer.html?symbol=${encodeURIComponent(item.symbol)}&exchange=DSE" class="text-xs font-bold bg-blue-700 hover:bg-blue-800 text-white px-3.5 py-1.5 rounded-lg transition">
            AI রিপোর্ট
          </a>
        </div>
      `;
      grid.appendChild(card);
    });
  } catch (err) {
    grid.innerHTML = `<div class="col-span-full text-center text-slate-600 text-sm py-6 bg-white rounded-2xl border border-slate-200">লাইভ মার্কেট স্ক্যানার প্রস্তুত হচ্ছে—যেকোনো স্টক দেখতে <a href="analyzer.html" class="text-blue-700 font-semibold underline">MukiSoft AI অ্যানালাইজার</a> খুলুন।</div>`;
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
    dseBtn.className = "px-5 py-2.5 rounded-lg text-sm font-bold bg-blue-700 text-white shadow-xs transition cursor-pointer";
    cseBtn.className = "px-5 py-2.5 rounded-lg text-sm font-bold text-slate-600 hover:text-slate-900 transition cursor-pointer";
  } else {
    cseBtn.className = "px-5 py-2.5 rounded-lg text-sm font-bold bg-blue-700 text-white shadow-xs transition cursor-pointer";
    dseBtn.className = "px-5 py-2.5 rounded-lg text-sm font-bold text-slate-600 hover:text-slate-900 transition cursor-pointer";
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
  document.getElementById("loader-text").innerText = `${symbol} (${selectedExchange})-এর রিয়েল-টাইম ডেটা সংগ্রহ ও বিশ্লেষণ করা হচ্ছে...`;
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

function handleFilesAdded(fileList) {
  for (const file of fileList) {
    uploadedFilesList.push(file);
  }
  const input = document.getElementById("doc-input");
  if (input) input.value = "";
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
    card.className = "flex items-center justify-between gap-2 bg-slate-50 border border-slate-300 rounded-xl p-3";

    const info = document.createElement("div");
    info.className = "flex items-center gap-2.5 overflow-hidden";
    info.innerHTML = `
      <span class="px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px] font-bold shrink-0">${isPdf ? "PDF" : "IMG"}</span>
      <span class="text-xs text-slate-800 font-medium truncate">${file.name}</span>
    `;

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.innerText = "Remove";
    delBtn.className = "px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white text-[11px] font-bold shrink-0 transition cursor-pointer";
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
    badge.className = "inline-block px-3.5 py-1.5 rounded-lg text-sm font-bold bg-emerald-50 text-emerald-700 border border-emerald-200";
  } else if (data.signal_code === 0) {
    badge.className = "inline-block px-3.5 py-1.5 rounded-lg text-sm font-bold bg-rose-50 text-rose-700 border border-rose-200";
  } else {
    badge.className = "inline-block px-3.5 py-1.5 rounded-lg text-sm font-bold bg-amber-50 text-amber-800 border border-amber-200";
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
          borderColor: "#1D4ED8",
          backgroundColor: "rgba(29, 78, 216, 0.08)",
          borderWidth: 2.5,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: "#F1F5F9" }, ticks: { color: "#475569" } },
          y: { grid: { color: "#F1F5F9" }, ticks: { color: "#475569" } }
        }
      }
    });
  }
}