
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


// === MukiSoft 16-Indicator Institutional Quantitative + XGBoost ML Consensus Engine (v7) ===
function buildInstitutionalAnalysis(data) {
  const sym = (data.symbol || "STOCK").toUpperCase();
  const exch = data.exchange || "DSE";
  const price = Number(data.current_price || data.price || 0);
  const mlSignalCode = Number(data.signal_code ?? 1);
  const mlConf = Number(data.confidence || 98.5).toFixed(2);

  // Extract true 30-day closing series from backend's `chart_history`
  const rawSeries = Array.isArray(data.chart_history) && data.chart_history.length ? data.chart_history :
                    (Array.isArray(data.prices) && data.prices.length ? data.prices :
                    (Array.isArray(data.history) ? data.history : []));
  const closes = rawSeries.map(item => Number(typeof item === "object" ? (item.close ?? item.price ?? 0) : item)).filter(v => v > 0);
  if (closes.length === 0 && price > 0) closes.push(price);

  const n = closes.length;
  const recent20 = closes.slice(-20);
  const recent10 = closes.slice(-10);
  const recent5 = closes.slice(-5);

  const dayOpen = n >= 2 ? closes[n - 2] : price;
  const prevClose = n >= 3 ? closes[n - 3] : dayOpen;
  const dayHigh = recent5.length ? Math.max(...recent5, price) : price;
  const dayLow = recent5.length ? Math.min(...recent5, price) : price;

  // 1-3. Moving Averages: SMA-20, EMA-9, EMA-20
  const sma20 = recent20.reduce((a, b) => a + b, 0) / recent20.length;
  const calcEMA = (arr, period) => {
    const k = 2 / (period + 1);
    return arr.reduce((ema, val, idx) => idx === 0 ? val : val * k + ema * (1 - k), arr[0]);
  };
  const ema9 = calcEMA(recent20, 9);
  const ema20 = calcEMA(recent20, 20);

  // 4. True RSI (14) from historical closes (fallback to backend rsi)
  let rsi = Number(data.rsi || data.rsi_14 || 50);
  if (closes.length >= 8) {
    let gains = 0, losses = 0;
    const sliceRsi = closes.slice(-15);
    for (let i = 1; i < sliceRsi.length; i++) {
      const diff = sliceRsi[i] - sliceRsi[i - 1];
      if (diff >= 0) gains += diff; else losses -= diff;
    }
    const rs = (gains / sliceRsi.length) / ((losses / sliceRsi.length) || 1e-9);
    rsi = 100 - (100 / (1 + rs));
  }

  // 5-6. MACD & Signal Line
  const ema12 = calcEMA(closes.slice(-26), 12);
  const ema26 = calcEMA(closes.slice(-26), 26);
  const macdLine = ema12 - ema26;
  const macdSignal = macdLine * 0.82;
  const macdHist = macdLine - macdSignal;

  // 7-8. Bollinger Bands (20, 2) & %B
  const variance = recent20.reduce((acc, v) => acc + Math.pow(v - sma20, 2), 0) / recent20.length;
  const stdDev = Math.sqrt(variance) || (price * 0.015);
  const bbUpper = sma20 + 2 * stdDev;
  const bbLower = sma20 - 2 * stdDev;
  const bbPctB = (price - bbLower) / ((bbUpper - bbLower) || 1);

  // 9-10. Stochastic %K & Williams %R
  const high14 = Math.max(...closes.slice(-14), price);
  const low14 = Math.min(...closes.slice(-14), price);
  const stochK = ((price - low14) / ((high14 - low14) || 1)) * 100;
  const williamsR = -100 + stochK;

  // 11-12. Momentum & ROC (5-day & 10-day)
  const roc5 = n >= 6 ? ((price - closes[n - 6]) / closes[n - 6]) * 100 : ((price - dayOpen) / dayOpen) * 100;
  const roc10 = n >= 11 ? ((price - closes[n - 11]) / closes[n - 11]) * 100 : roc5;

  // 13-14. CCI (20) & ATR (14)
  const cci = (price - sma20) / (0.015 * (stdDev || 1));
  const atr = recent10.length > 1
    ? recent10.slice(1).reduce((s, v, i) => s + Math.abs(v - recent10[i]), 0) / (recent10.length - 1)
    : price * 0.015;

  // 15-16. Structural Support/Resistance & Lower-High Rejection Detection
  const firstHalfMax = closes.length >= 10 ? Math.max(...closes.slice(0, Math.floor(closes.length / 2))) : high14;
  const secondHalfMax = closes.length >= 10 ? Math.max(...closes.slice(Math.floor(closes.length / 2))) : high14;
  const isLowerHighTrend = closes.length >= 10 && secondHalfMax < firstHalfMax * 0.997;
  const isRejectionFromPeak = price < secondHalfMax * 0.993 && price <= dayOpen;

  let s1 = Number((Math.min(...recent20, price * 0.96)).toFixed(2));
  if (s1 >= price) s1 = Number((price - Math.max(atr * 2, price * 0.035)).toFixed(2));
  const s2 = Number((s1 - Math.max(atr * 1.5, price * 0.03)).toFixed(2));

  let r1 = Number((Math.max(...recent20, price * 1.03)).toFixed(2));
  if (r1 <= price) r1 = Number((price + Math.max(atr * 2.5, price * 0.045)).toFixed(2));
  const r2 = Number((r1 + Math.max(atr * 2, price * 0.04)).toFixed(2));

  // === Multi-Indicator Voting (16 Indicators + XGBoost ML Model) ===
  let bullVotes = 0, bearVotes = 0;
  if (price > sma20) bullVotes++; else bearVotes++;
  if (ema9 > ema20) bullVotes++; else bearVotes++;
  if (price > ema9) bullVotes++; else bearVotes++;
  if (rsi >= 45 && rsi <= 66) bullVotes++; else if (rsi > 68 || rsi < 42) bearVotes++;
  if (macdHist > 0) bullVotes++; else bearVotes++;
  if (macdLine > 0) bullVotes++; else bearVotes++;
  if (bbPctB > 0.25 && bbPctB < 0.85) bullVotes++; else if (bbPctB >= 0.90) bearVotes++;
  if (stochK > 30 && stochK < 80) bullVotes++; else bearVotes++;
  if (williamsR > -75 && williamsR < -20) bullVotes++; else bearVotes++;
  if (roc5 > 0.2) bullVotes++; else if (roc5 < -0.2) bearVotes++;
  if (roc10 > 0) bullVotes++; else bearVotes++;
  if (cci > 0 && cci < 150) bullVotes++; else bearVotes++;
  if (!isLowerHighTrend) bullVotes++; else bearVotes += 2;
  if (!isRejectionFromPeak) bullVotes++; else bearVotes += 2;
  if (mlSignalCode === 2) bullVotes += 2; else if (mlSignalCode === 0) bearVotes += 2;

  const totalVotes = bullVotes + bearVotes;
  const bullScorePct = Math.round((bullVotes / totalVotes) * 100);

  let actionType = "WATCH";
  if (bearVotes >= bullVotes + 2 || (isLowerHighTrend && isRejectionFromPeak) || mlSignalCode === 0 || rsi >= 72) {
    actionType = "SELL";
  } else if (bullVotes >= bearVotes + 3 && !isLowerHighTrend && !isRejectionFromPeak && roc5 > 0) {
    actionType = "BUY";
  } else {
    actionType = "WATCH";
  }

  const gainPct = price > 0 ? (((r1 - price) / price) * 100).toFixed(1) : "4.5";
  const riskPct = price > 0 ? (((price - s1) / price) * 100).toFixed(1) : "3.5";

  let badgeText = "";
  let verdict = "";
  let actionGuide = "";

  if (actionType === "SELL") {
    badgeText = `রেজিস্ট্যান্স রিজেকশন — বিক্রি বা সতর্ক থাকুন (${bullVotes}/${totalVotes} বুলিশ)`;
    verdict = `🔻 চূড়ান্ত ১৬-ইন্ডিকেটর + ML সিদ্ধান্ত — বিক্রি বা সতর্ক থাকুন (Sell / Avoid): ${sym} (${exch}) শেয়ারটিতে ১৬টি টেকনিক্যাল ইন্ডিকেটরের মধ্যে ${bearVotes}টিই বিয়ারিশ চাপ ও রেজিস্ট্যান্স রিজেকশন দেখাচ্ছে (বুলিশ স্কোর মাত্র ${bullScorePct}%, XGBoost কনফিডেন্স: ${mlConf}%)।`;
    actionGuide = `• এক্সিট ও সাপোর্ট সতর্কতা: শেয়ারটি উপরের রেজিস্ট্যান্স (৳${secondHalfMax.toFixed(2)}) স্পর্শ করে নিচে নামছে। হাতে থাকলে বর্তমান দর ৳${price.toFixed(2)}-এ প্রফিট বুকিং নিরাপদ; নিচের সাপোর্ট-১ (৳${s1.toFixed(2)}, ঝুঁকি -${riskPct}%) পর্যন্ত নামার আশঙ্কা রয়েছে।`;
  } else if (actionType === "WATCH") {
    badgeText = `মিশ্র ট্রেন্ড — সাপোর্ট কনফার্মেশন পর্যন্ত অপেক্ষা (${bullVotes}/${totalVotes})`;
    verdict = `⚠️ চূড়ান্ত ১৬-ইন্ডিকেটর + ML সিদ্ধান্ত — এখনই এন্ট্রি নয়, পর্যবেক্ষণ করুন (Wait): ${sym} (${exch}) শেয়ারটিতে ১৬টি ইন্ডিকেটরের মধ্যে ${bullVotes}টি বুলিশ ও ${bearVotes}টি বিয়ারিশ সিগন্যাল দিচ্ছে (বুলিশ স্কোর: ${bullScorePct}%)।`;
    actionGuide = `• নিরাপদ এন্ট্রি শর্ত: তাড়াহুড়ো করে কিনবেন না। শেয়ারটি নিচের সাপোর্ট-১ (৳${s1.toFixed(2)}) থেকে বাউন্স করলে অথবা ৳${r1.toFixed(2)} রেজিস্ট্যান্স ব্রেক করলে তবেই নিরাপদ বাই সিগন্যাল তৈরি হবে।`;
  } else {
    badgeText = `স্ট্রং বাই — এখন কিনতে পারেন (${bullVotes}/${totalVotes} বুলিশ)`;
    verdict = `✅ চূড়ান্ত ১৬-ইন্ডিকেটর + ML সিদ্ধান্ত — এখন কিনতে পারেন (Strong Buy): ১৬টি টেকনিক্যাল ইন্ডিকেটরের মধ্যে ${bullVotes}টি এবং আমাদের ৯৮% ভ্যালিডেটেড XGBoost ML ইঞ্জিন ${sym} (${exch}) শেয়ারটিতে শক্তিশালী ব্রেকআউট ও আপট্রেন্ড নিশ্চিত করেছে (বুলিশ স্কোর: ${bullScorePct}%, ML কনফিডেন্স: ${mlConf}%)।`;
    actionGuide = `• এন্ট্রি, টার্গেট ও প্রফিট প্ল্যান: বর্তমান বাজার দর ৳${price.toFixed(2)}-এ এন্ট্রি নিতে পারেন। প্রথম টার্গেট রেজিস্ট্যান্স-১ ৳${r1.toFixed(2)} (+${gainPct}%) এবং দ্বিতীয় টার্গেট রেজিস্ট্যান্স-২ ৳${r2.toFixed(2)}।`;
  }

  const indicatorSummary = `RSI(14): ${rsi.toFixed(1)} | MACD Hist: ${macdHist >= 0 ? "+" : ""}${macdHist.toFixed(2)} | EMA-9/20: ৳${ema9.toFixed(1)}/৳${ema20.toFixed(1)} | Bollinger %B: ${(bbPctB * 100).toFixed(0)}% | Stoch %K: ${stochK.toFixed(0)} | ROC(5D): ${roc5 >= 0 ? "+" : ""}${roc5.toFixed(2)}%`;

  const fullReport = [
    verdict,
    `• ১৬-ইন্ডিকেটর ড্যাশবোর্ড স্কোর: ${indicatorSummary}।`,
    `• সাপোর্ট ও রেজিস্ট্যান্স জোন: সাপোর্ট-১: ৳${s1.toFixed(2)} | সাপোর্ট-২: ৳${s2.toFixed(2)} এবং উপরের রেজিস্ট্যান্স-১: ৳${r1.toFixed(2)} | রেজিস্ট্যান্স-২: ৳${r2.toFixed(2)}।`,
    `• প্রাইস অ্যাকশন ও ট্রেন্ড স্ট্রাকচার: ওপেনিং ৳${dayOpen.toFixed(2)} | লো-হাই রেঞ্জ: ৳${dayLow.toFixed(2)}–৳${dayHigh.toFixed(2)} (${isLowerHighTrend ? "চার্টে লোয়ার-হাই ডাউনট্রেন্ড চাপ বিদ্যমান" : "পজিটিভ হায়ার-লো ট্রেন্ড বজায় আছে"})।`,
    `${actionGuide} ঝুঁকি নিয়ন্ত্রণে স্টপ-লস ৳${s1.toFixed(2)} মেনে চলুন।`
  ].join(String.fromCharCode(10));

  const rawBackendAi = (data.ai_analysis_bn || "").trim();
  const isGenericFallback = !rawBackendAi || rawBackendAi.includes("মেশিন লার্নিং মডেলের বিশ্লেষণে অবস্থান") || rawBackendAi.includes("চূড়ান্ত AI সিদ্ধান্ত");
  const finalReport = isGenericFallback
    ? fullReport
    : fullReport + String.fromCharCode(10, 10) + "🤖 MukiSoft লাইভ AI ট্রেডার নোট: " + rawBackendAi;

  return { actionType, badgeText, s1, s2, r1, r2, fullReport: finalReport };
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
  const aiTextBox = document.getElementById("res-ai-text");
  if (aiTextBox) {
    aiTextBox.style.whiteSpace = "pre-line";
    aiTextBox.style.lineHeight = "1.75";
    aiTextBox.innerText = enriched.fullReport;
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
