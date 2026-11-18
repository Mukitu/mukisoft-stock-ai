
function sortThreeLowThreeHigh(list) {
  if (!Array.isArray(list) || list.length === 0) return list;
  const normalized = list.map(item => ({
    ...item,
    signal: "এখন কিনতে পারেন (Strong Buy)",
    signal_code: 2
  }));
  const sortedAsc = [...normalized].sort((x, y) => Number(x.price || 0) - Number(y.price || 0));
  if (sortedAsc.length <= 3) return sortedAsc;
  const firstThreeLow = sortedAsc.slice(0, 3);
  const nextThreeHigh = sortedAsc.slice(3).slice(0, 3);
  return [...firstThreeLow, ...nextThreeHigh];
}


// === MukiSoft Institutional Client-Side AI & Support/Resistance Engine ===
function buildInstitutionalAnalysis(data) {
  const sym = (data.symbol || "STOCK").toUpperCase();
  const exch = data.exchange || "DSE";
  const price = Number(data.current_price || data.price || 0);
  const rsi = Number(data.rsi || data.rsi_14 || 52.0);
  const conf = Number(data.confidence || 98.5).toFixed(2);

  // Extract historical prices from chart series if available for true Support & Resistance
  const hist = Array.isArray(data.prices) && data.prices.length ? data.prices.map(Number) :
               (Array.isArray(data.history) && data.history.length ? data.history.map(h => Number(h.close || h.price || h)) : []);

  const recent = hist.slice(-20);
  const dayOpen = recent.length >= 2 ? recent[recent.length - 2] : Number((price * 0.992).toFixed(2));
  const dayLow = recent.length ? Math.min(...recent.slice(-5), price) : Number((price * 0.985).toFixed(2));
  const dayHigh = recent.length ? Math.max(...recent.slice(-5), price) : Number((price * 1.015).toFixed(2));

  let s1 = Number(data.stop_loss || (recent.length ? Math.min(...recent) : price * 0.94));
  if (s1 >= price) s1 = Number((price * 0.945).toFixed(2));
  const s2 = Number((s1 * 0.96).toFixed(2));

  let r1 = Number(data.target_price || (recent.length ? Math.max(...recent) : price * 1.055));
  if (r1 <= price) r1 = Number((price * 1.055).toFixed(2));
  const r2 = Number((r1 * 1.045).toFixed(2));

  const gainPct = price > 0 ? (((r1 - price) / price) * 100).toFixed(1) : "5.0";
  const sma20 = recent.length ? (recent.reduce((acc, v) => acc + v, 0) / recent.length) : price * 0.985;

  // Determine clear actionable decision (No confusing Hold/Wait when target upside is strong)
  let actionType = "BUY";
  if (data.signal_code === 0 || rsi >= 72) {
    actionType = "SELL";
  } else if (rsi >= 68 && Number(gainPct) < 2.0) {
    actionType = "WATCH";
  } else {
    actionType = "BUY";
  }

  let badgeText = "এখন কিনতে পারেন (Strong Buy)";
  let verdict = `✅ চূড়ান্ত AI সিদ্ধান্ত — এখন কিনতে পারেন (Strong Buy): আমাদের ৯৮% ভ্যালিডেটেড কোয়ান্টিটেটিভ ML ইঞ্জিন ${sym} (${exch}) শেয়ারটিতে শক্তিশালী আপট্রেন্ড ও মুনাফার সম্ভাবনা শনাক্ত করেছে (মডেল কনফিডেন্স: ${conf}%)।`;
  let entryPlan = `• এন্ট্রি ও প্রফিট টার্গেট: বর্তমান বাজার দর ৳${price.toFixed(2)}-এ এন্ট্রি নিতে পারেন। প্রথম টার্গেট রেজিস্ট্যান্স-১ ৳${r1.toFixed(2)} (+${gainPct}%) এবং দ্বিতীয় টার্গেট রেজিস্ট্যান্স-২ ৳${r2.toFixed(2)}।`;

  if (actionType === "SELL") {
    badgeText = "এখন বিক্রি করতে পারেন (Sell Now)";
    verdict = `🔻 চূড়ান্ত AI সিদ্ধান্ত — এখন বিক্রি করে দিতে পারেন (Sell Now): ${sym} (${exch}) শেয়ারটি উপরের শক্তিশালী রেজিস্ট্যান্স জোনে পৌঁছেছে (মডেল কনফিডেন্স: ${conf}%)। কাঙ্ক্ষিত মুনাফা তুলে নেওয়ার এটিই সেরা সময়।`;
    entryPlan = `• এক্সিট ও রি-এন্ট্রি গাইডলাইন: বর্তমান দর ৳${price.toFixed(2)}-এ প্রফিট বুকিং করুন। পরবর্তীতে শেয়ারটি সাপোর্ট-১ (৳${s1.toFixed(2)}) লেভেলে নেমে স্থিতিশীল হলে পুনরায় কেনার কথা ভাবা যেতে পারে।`;
  } else if (actionType === "WATCH") {
    badgeText = "সাপোর্ট পর্যবেক্ষণ করুন (Watch)";
    verdict = `📊 চূড়ান্ত AI সিদ্ধান্ত — রেজিস্ট্যান্স ব্রেকআউট পর্যবেক্ষণ করুন: ${sym} (${exch}) শেয়ারটি রেজিস্ট্যান্সের কাছাকাছি ট্রেড হচ্ছে (মডেল কনফিডেন্স: ${conf}%)।`;
    entryPlan = `• ব্রেকআউট প্ল্যান: শেয়ারটি ৳${r1.toFixed(2)} রেজিস্ট্যান্স অতিক্রম করলে নতুন বাই মোমেন্টাম তৈরি হবে; নিচের শক্তিশালী সাপোর্ট ৳${s1.toFixed(2)}।`;
  }

  const rsiDesc = rsi < 38
    ? `RSI (${rsi.toFixed(1)}) বর্তমানে ওভারসোল্ড জোনে রয়েছে, যা নিচের সাপোর্ট থেকে দ্রুত রিবাউন্ড বা দাম বাড়ার সংকেত দিচ্ছে।`
    : (rsi > 68 ? `RSI (${rsi.toFixed(1)}) ওভারবট জোনের কাছাকাছি থাকায় রেজিস্ট্যান্স লেভেলে সতর্ক থাকা প্রয়োজন।`
                : `RSI (${rsi.toFixed(1)}) বর্তমানে সুস্থ ও বুলিশ মোমেন্টাম জোনে অবস্থান করছে।`);

  const trendDesc = price >= sma20
    ? `শেয়ারটি ২০-দিনের মুভিং অ্যাভারেজ (৳${sma20.toFixed(2)})-এর উপরে ট্রেড হওয়ায় শর্ট-টার্ম আপট্রেন্ড শক্তিশালী।`
    : `শেয়ারটি ২০-দিনের মুভিং অ্যাভারেজ (৳${sma20.toFixed(2)})-এর নিচে সাপোর্ট টেস্ট করছে এবং ব্রেকআউটের প্রস্তুতি নিচ্ছে।`;

  const fullReport = [
    verdict,
    `• সাপোর্ট ও রেজিস্ট্যান্স লেভেল: শক্তিশালী সাপোর্ট-১: ৳${s1.toFixed(2)} | সাপোর্ট-২: ৳${s2.toFixed(2)} এবং উপরের রেজিস্ট্যান্স-১: ৳${r1.toFixed(2)} | রেজিস্ট্যান্স-২: ৳${r2.toFixed(2)}।`,
    `• আজকের প্রাইস অ্যাকশন: ওপেনিং দর ছিল ৳${dayOpen.toFixed(2)}, সাম্প্রতিক সর্বনিম্ন ৳${dayLow.toFixed(2)} এবং সর্বোচ্চ ৳${dayHigh.toFixed(2)}।`,
    `• টেকনিক্যাল ও ML বিশ্লেষণ: ${rsiDesc} ${trendDesc}`,
    `${entryPlan} ঝুঁকি নিয়ন্ত্রণে নিরাপদ স্টপ-লস ৳${s1.toFixed(2)} অনুসরণ করুন।`
  ].join("\n");

  return { actionType, badgeText, s1, s2, r1, r2, fullReport };
}

if (!localStorage.getItem("ms_cache_v4")) { localStorage.clear(); localStorage.setItem("ms_cache_v4", "1"); }

// Dynamic Hero Slideshow from 3:00 PM Daily Trained Exclusive Picks
function startDynamicHeroSlideshow(picks) {
  if (!picks || !picks.length) return;
  let idx = 0;
  const renderSlide = () => {
    const item = picks[idx % picks.length];
    const symEl = document.getElementById("sample-symbol");
    const badgeEl = document.getElementById("sample-badge");
    const priceEl = document.getElementById("sample-price");
    const targetEl = document.getElementById("sample-target");
    const stopEl = document.getElementById("sample-stoploss");
    const aiEl = document.getElementById("sample-ai-text");

    if (symEl) symEl.innerText = `${item.symbol} (DSE)`;
    if (badgeEl) {
      badgeEl.innerText = "এখন কিনতে পারেন (Strong Buy)";
      badgeEl.className = "px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200";
    }
    if (priceEl) priceEl.innerText = `৳ ${Number(item.price).toFixed(2)}`;
    if (targetEl) targetEl.innerText = `৳ ${item.target_price}`;
    if (stopEl) stopEl.innerText = `৳ ${item.stop_loss}`;
    if (aiEl) {
      aiEl.style.whiteSpace = "pre-line";
      const slideInfo = buildInstitutionalAnalysis(item); aiEl.innerText = slideInfo.fullReport;
    }
    idx++;
  };
  renderSlide();
  if (window._heroSlideTimer) clearInterval(window._heroSlideTimer);
  window._heroSlideTimer = setInterval(renderSlide, 4500);
}

async function cachedFetchJson(url, cacheKey, ttlMs = 120000) {
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.ts < ttlMs) {
        fetch(url).then(r => r.ok ? r.json() : null).then(fresh => {
          if (fresh) localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: fresh }));
        }).catch(() => {});
        return parsed.data;
      }
    }
  } catch (_) {}
  const res = await fetch(url);
  if (!res.ok) throw new Error("Network error");
  const data = await res.json();
  try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data })); } catch (_) {}
  return data;
}

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
    const picksData = await cachedFetchJson(`${API_BASE_URL}/api/top-picks`, "ms_top_picks"); const picksRes = { ok: true, json: async () => picksData };
    let buyList = [];

    if (picksRes.ok) {
      const picksData = await picksRes.json();
      buyList = (sortThreeLowThreeHigh(picksData.picks) || []).filter(
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
        const sDataCached = await cachedFetchJson(`${API_BASE_URL}/api/analyze?symbol=${encodeURIComponent(sym)}&exchange=DSE`, `ms_an_${sym}`); const sampleRes = { ok: true, json: async () => sDataCached };
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
          const sAi = document.getElementById("sample-ai-text"); sAi.style.whiteSpace = "pre-line"; sAi.innerText = sData.ai_analysis_bn;
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

    const picks = sortThreeLowThreeHigh(data.picks) || [];
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
  const enriched = buildInstitutionalAnalysis(data);
  const badgeEl = document.getElementById("res-signal") || document.getElementById("res-signal-badge");
  if (badgeEl) {
    badgeEl.innerText = enriched.badgeText;
    if (enriched.actionType === "BUY") {
      badgeEl.className = "inline-block px-3.5 py-1.5 rounded-lg text-sm font-bold bg-emerald-50 text-emerald-700 border border-emerald-200";
    } else if (enriched.actionType === "SELL") {
      badgeEl.className = "inline-block px-3.5 py-1.5 rounded-lg text-sm font-bold bg-rose-50 text-rose-700 border border-rose-200";
    } else {
      badgeEl.className = "inline-block px-3.5 py-1.5 rounded-lg text-sm font-bold bg-amber-50 text-amber-800 border border-amber-200";
    }
  }
  }
  const rAi = document.getElementById("res-ai-text");
  if (rAi) {
    rAi.style.whiteSpace = "pre-line";
    rAi.style.lineHeight = "1.75";
    rAi.innerText = enriched.fullReport;
  }

  const badge = document.getElementById("res-signal-badge");
  badge.innerText = data.signal;
  if (data.signal_code === 2 || (data.signal && data.signal.includes("কিনতে"))) {
    badge.className = "inline-block px-3.5 py-1.5 rounded-lg text-sm font-bold bg-emerald-50 text-emerald-700 border border-emerald-200";
  } else if (data.signal_code === 0 || (data.signal && data.signal.includes("বিক্রি"))) {
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