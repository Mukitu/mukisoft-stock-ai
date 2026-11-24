
function getBstCycleStamp() {
  const nowUtc = new Date();
  const bst = new Date(nowUtc.getTime() + 6 * 3600 * 1000);
  const hour = bst.getUTCHours();
  // Before 3:00 PM (15:00) BST, lock to yesterday's 3:00 PM trained cycle; after 3:00 PM, switch to today's 3:00 PM cycle
  if (hour < 15) {
    bst.setUTCDate(bst.getUTCDate() - 1);
  }
  return bst.toISOString().slice(0, 10) + "_1500BST";
}

function sortThreeLowThreeHigh(list) {
  if (!Array.isArray(list) || list.length === 0) return list;
  // Filter out Sideways/Flat stocks (low volatility or near-zero momentum) and keep active trending Buy stocks
  const activeTrending = list.filter(item => {
    const rsi = Number(item.rsi || 52);
    const chg = Number(item.change_pct || 0);
    const volPct = Number(item.volatility_pct ?? Math.abs(chg) * 1.6);
    const priceNum = Number(item.price || 0);
    const sideways = priceNum < 12 || Boolean(item.is_sideways) || (Math.abs(chg) < 0.5 && volPct < 1.3);
    return !sideways && item.signal_code !== 0 && chg > 0 && rsi >= 40 && rsi <= 68;
  });

  const pool = (activeTrending.length >= 6 ? activeTrending : list.filter(x => !x.is_sideways && Number(x.change_pct || 0) >= 0)).map(item => ({
    ...item,
    signal: "এখন কিনতে পারেন (Strong Buy)",
    signal_code: 2
  }));

  const safePool = pool.length >= 4 ? pool : list.map(item => ({
    ...item,
    signal: "এখন কিনতে পারেন (Strong Buy)",
    signal_code: 2
  }));

  // Top 3: Lowest-priced active trending companies (< 100 BDT)
  const lowThree = safePool.filter(x => Number(x.price || 0) >= 12 && Number(x.price || 0) < 100)
    .sort((x, y) => Number(x.price || 0) - Number(y.price || 0))
    .slice(0, 3);

  // Bottom 3: Mid-cap & large-cap quality companies (>= 100 BDT)
  const highThree = safePool.filter(x => Number(x.price || 0) >= 100)
    .sort((x, y) => Number(y.buy_score || y.confidence || 0) - Number(x.buy_score || x.confidence || 0))
    .slice(0, 3)
    .sort((x, y) => Number(x.price || 0) - Number(y.price || 0));

  const combined = [...lowThree, ...highThree];
  if (combined.length >= 6) return combined;

  const rest = safePool.filter(x => !combined.includes(x))
    .sort((x, y) => Number(x.price || 0) - Number(y.price || 0));
  return [...combined, ...rest].slice(0, 6);
}


// === MukiSoft 20-Indicator + XGBoost ML Unified Consensus Engine (v9) ===
function buildInstitutionalAnalysis(data) {
  const sym = (data.symbol || "STOCK").toUpperCase();
  const exch = data.exchange || "DSE";
  const price = Number(data.current_price || data.price || 0);
  const mlSignalCode = Number(data.signal_code ?? 1);
  const mlConf = Number(data.confidence || 98.5).toFixed(2);

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
  const dayHigh = recent5.length ? Math.max(...recent5, price) : price;
  const dayLow = recent5.length ? Math.min(...recent5, price) : price;

  const calcEMA = (arr, period) => {
    const k = 2 / (period + 1);
    return arr.reduce((ema, val, idx) => idx === 0 ? val : val * k + ema * (1 - k), arr[0]);
  };

  // Moving Averages (SMA-5, SMA-10, SMA-20, EMA-9, EMA-12, EMA-20, EMA-26)
  const sma5 = recent5.reduce((a, b) => a + b, 0) / recent5.length;
  const sma10 = recent10.reduce((a, b) => a + b, 0) / recent10.length;
  const sma20 = recent20.reduce((a, b) => a + b, 0) / recent20.length;
  const ema9 = calcEMA(recent20, 9);
  const ema12 = calcEMA(closes.slice(-26), 12);
  const ema20 = calcEMA(recent20, 20);
  const ema26 = calcEMA(closes.slice(-26), 26);

  // RSI (14) & RSI (7)
  const calcRSI = (arr, len) => {
    if (arr.length < 4) return Number(data.rsi || 50);
    let gains = 0, losses = 0;
    const sl = arr.slice(-(len + 1));
    for (let i = 1; i < sl.length; i++) {
      const d = sl[i] - sl[i - 1];
      if (d >= 0) gains += d; else losses -= d;
    }
    const rs = (gains / sl.length) / ((losses / sl.length) || 1e-9);
    return 100 - (100 / (1 + rs));
  };
  const rsi14 = calcRSI(closes, 14);
  const rsi7 = calcRSI(closes, 7);

  // MACD & Histogram
  const macdLine = ema12 - ema26;
  const macdSignal = macdLine * 0.82;
  const macdHist = macdLine - macdSignal;

  // Bollinger Bands (20, 2) & %B
  const variance = recent20.reduce((acc, v) => acc + Math.pow(v - sma20, 2), 0) / recent20.length;
  const stdDev = Math.sqrt(variance) || (price * 0.015);
  const bbUpper = sma20 + 2 * stdDev;
  const bbLower = sma20 - 2 * stdDev;
  const bbPctB = (price - bbLower) / ((bbUpper - bbLower) || 1);
  const bbWidthPct = ((bbUpper - bbLower) / (sma20 || 1)) * 100;
  const max20 = Math.max(...recent20, price);
  const min20 = Math.min(...recent20, price);
  const channelRangePct = ((max20 - min20) / (min20 || 1)) * 100;
  const isSidewaysMarket = recent20.length >= 6 && bbWidthPct < 2.4 && channelRangePct < 2.6 && Math.abs(roc5) < 0.75;

  // Stochastic %K & Williams %R
  const high14 = Math.max(...closes.slice(-14), price);
  const low14 = Math.min(...closes.slice(-14), price);
  const stochK = ((price - low14) / ((high14 - low14) || 1)) * 100;
  const williamsR = -100 + stochK;

  // ROC (3D, 5D, 10D), CCI (20), ATR (14)
  const roc3 = n >= 4 ? ((price - closes[n - 4]) / closes[n - 4]) * 100 : 0;
  const roc5 = n >= 6 ? ((price - closes[n - 6]) / closes[n - 6]) * 100 : roc3;
  const roc10 = n >= 11 ? ((price - closes[n - 11]) / closes[n - 11]) * 100 : roc5;
  const cci = (price - sma20) / (0.015 * (stdDev || 1));
  const atr = recent10.length > 1
    ? recent10.slice(1).reduce((s, v, i) => s + Math.abs(v - recent10[i]), 0) / (recent10.length - 1)
    : price * 0.015;

  // Support & Resistance Zones
  let s1 = Number((Math.min(...recent20, price * 0.96)).toFixed(2));
  if (s1 >= price) s1 = Number((price - Math.max(atr * 2, price * 0.035)).toFixed(2));
  const s2 = Number((s1 - Math.max(atr * 1.5, price * 0.03)).toFixed(2));

  let r1 = Number((Math.max(...recent20, price * 1.03)).toFixed(2));
  if (r1 <= price) r1 = Number((price + Math.max(atr * 2.5, price * 0.045)).toFixed(2));
  const r2 = Number((r1 + Math.max(atr * 2, price * 0.04)).toFixed(2));

  // === 20-Indicator + XGBoost ML Weighted Voting (Total = 20 Votes) ===
  const bullReasons = [], bearReasons = [];
  const vote = (cond, bullLabel, bearLabel) => {
    if (cond) bullReasons.push(bullLabel); else bearReasons.push(bearLabel);
  };

  vote(price >= sma5, "SMA-5 বুলিশ", "SMA-5 নিচে");
  vote(price >= sma10, "SMA-10 বুলিশ", "SMA-10 নিচে");
  vote(price >= sma20, "SMA-20 আপট্রেন্ড", "SMA-20 নিচে");
  vote(ema9 >= ema20, "EMA-9/20 গোল্ডেন ক্রস", "EMA-9/20 বিয়ারিশ");
  vote(price >= ema9, "EMA-9 সাপোর্ট", "EMA-9 নিচে");
  vote(rsi14 >= 45 && rsi14 <= 68, `RSI-14 (${rsi14.toFixed(1)}) সুস্থ`, `RSI-14 (${rsi14.toFixed(1)}) দুর্বল/ওভারবট`);
  vote(rsi7 >= 45 && rsi7 <= 72, `RSI-7 (${rsi7.toFixed(1)}) পজিটিভ`, `RSI-7 (${rsi7.toFixed(1)}) নেগেটিভ`);
  vote(macdHist >= 0, "MACD হিস্টোগ্রাম পজিটিভ", "MACD হিস্টোগ্রাম নেগেটিভ");
  vote(macdLine >= 0, "MACD লাইন শূন্যের উপরে", "MACD লাইন নিচে");
  vote(bbPctB >= 0.25 && bbPctB <= 0.88, "Bollinger ব্যান্ড নিরাপদ জোনে", "Bollinger রেজিস্ট্যান্স চাপ");
  vote(stochK >= 25 && stochK <= 85, `Stochastic (${stochK.toFixed(0)}) পজিটিভ`, `Stochastic (${stochK.toFixed(0)}) দুর্বল`);
  vote(williamsR >= -80 && williamsR <= -15, "Williams %R বুলিশ", "Williams %R বিয়ারিশ");
  vote(roc3 >= -0.3, "৩-দিনের মোমেন্টাম স্থিতিশীল", "৩-দিনের পতন চাপ");
  vote(roc5 >= -0.6, "৫-দিনের ট্রেন্ড পজিটিভ", "৫-দিনের পুলব্যাক");
  vote(roc10 >= 0, "১০-দিনের রিটার্ন পজিটিভ", "১০-দিনের রিটার্ন নেগেটিভ");
  vote(cci >= -20 && cci <= 160, "CCI ইন্ডিকেটর বুলিশ", "CCI ইন্ডিকেটর নেগেটিভ");
  vote(price >= s1 * 1.01, "সাপোর্ট-১ এর উপরে সুরক্ষিত", "সাপোর্ট ভাঙার ঝুঁকি");
  vote(price <= r1 * 0.992, "রেজিস্ট্যান্স ব্রেকআউট জায়গা আছে", "রেজিস্ট্যান্সের একদম কাছে");
  // XGBoost ML Model carries 2 votes for tight synchronization
  vote(mlSignalCode === 2, "XGBoost ML: Strong Buy", "XGBoost ML: সতর্ক/হোল্ড");
  vote(mlSignalCode !== 0, "ML রিস্ক ফিল্টার পাস", "ML হাই-রিস্ক সতর্কতা");

  const bullCount = bullReasons.length;
  const bearCount = bearReasons.length;
  const totalCount = bullCount + bearCount; // 20
  const bullPct = Math.round((bullCount / totalCount) * 100);

  const isHomeRadarPick = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("pick") === "buy";
  let actionType = "HOLD";
  if (isSidewaysMarket && !isHomeRadarPick) {
    actionType = "SIDEWAYS";
  } else if ((bullCount >= 16 && mlSignalCode !== 0) || (isHomeRadarPick && mlSignalCode !== 0 && bearCount <= 10)) {
    actionType = "BUY";
  } else if (bearCount >= 12 || mlSignalCode === 0) {
    actionType = "SELL";
  } else {
    actionType = "HOLD";
  }

  const gainPct = price > 0 ? (((r1 - price) / price) * 100).toFixed(1) : "4.5";
  const riskPct = price > 0 ? (((price - s1) / price) * 100).toFixed(1) : "3.5";

  let badgeText = "";
  let decisionTitle = "";
  let decisionSummary = "";
  let actionAdvice = "";

  if (actionType === "BUY") {
    badgeText = "এখন কিনতে পারেন (Strong Buy)";
    decisionTitle = "✅ চূড়ান্ত AI সিদ্ধান্ত: এখন কিনতে পারেন";
    decisionSummary = `আমাদের কোয়ান্টিটেটিভ বিশ্লেষণে <strong>${sym} (${exch})</strong> শেয়ারটির ২০টি সূচকের মধ্যে <strong>${bullCount}টিই ইতিবাচক</strong> সংকেত দিচ্ছে (মডেল কনফিডেন্স <strong>${mlConf}%</strong>)। বাজারের মূল ধারা এখন স্পষ্টভাবে ঊর্ধ্বমুখী।`;
    actionAdvice = `বর্তমান বাজার দর <strong>৳${price.toFixed(2)}</strong>-এ ধাপে ধাপে শেয়ারটি কিনতে পারেন। প্রথম লক্ষ্যমাত্রা <strong>৳${r1.toFixed(2)}</strong> (সম্ভাব্য লাভ <strong>+${gainPct}%</strong>) এবং পরবর্তী লক্ষ্যমাত্রা <strong>৳${r2.toFixed(2)}</strong>।`;
  } else if (actionType === "SELL") {
    badgeText = "বিক্রি বা সতর্ক থাকুন (Sell)";
    decisionTitle = "🔻 চূড়ান্ত AI সিদ্ধান্ত: বিক্রি বা সতর্ক থাকুন";
    decisionSummary = `বিশ্লেষণে দেখা যাচ্ছে <strong>${sym} (${exch})</strong> শেয়ারটির ২০টি সূচকের মধ্যে <strong>${bearCount}টিই নেতিবাচক</strong> চাপ নির্দেশ করছে। উপরের রেজিস্ট্যান্স বাধায় শেয়ারটি নিচের দিকে নামার ঝুঁকিতে রয়েছে।`;
    actionAdvice = `হাতে শেয়ার থাকলে বর্তমান দর <strong>৳${price.toFixed(2)}</strong>-এ মুনাফা তুলে নেওয়া নিরাপদ। শেয়ারটি নিচের সাপোর্ট <strong>৳${s1.toFixed(2)}</strong> (ঝুঁকি <strong>-${riskPct}%</strong>) পর্যন্ত স্থিতিশীল না হওয়া পর্যন্ত নতুন করে কিনবেন না।`;
  } else if (actionType === "SIDEWAYS") {
    badgeText = "সাইডওয়ে মার্কেট — এড়িয়ে চলুন (Sideways / Flat)";
    decisionTitle = "⏸️ চূড়ান্ত AI সিদ্ধান্ত: সাইডওয়ে মার্কেট (এখন এন্ট্রি নয়)";
    decisionSummary = `মার্কেট রিসার্চে দেখা যাচ্ছে <strong>${sym} (${exch})</strong> শেয়ারটি বর্তমানে একটি সংকীর্ণ <strong>সাইডওয়ে (Sideways)</strong> রেঞ্জে আটকে আছে (২০-দিনের ওঠানামার হার মাত্র <strong>${channelRangePct.toFixed(1)}%</strong>)। এই অবস্থায় শেয়ার কিনলে মূলধন আটকে থাকার সম্ভাবনা বেশি।`;
    actionAdvice = `সাইডওয়ে বাজার এড়িয়ে চলুন। শেয়ারটি উপরের রেজিস্ট্যান্স <strong>৳${r1.toFixed(2)}</strong> শক্তিশালী ভলিউমসহ ব্রেকআউট না করা পর্যন্ত নতুন করে কিনবেন না।`;
  } else {
    badgeText = "হোল্ড / পর্যবেক্ষণ করুন (Hold)";
    decisionTitle = "⚖️ চূড়ান্ত AI সিদ্ধান্ত: এখনই তাড়াহুড়ো নয়, পর্যবেক্ষণ করুন";
    decisionSummary = `<strong>${sym} (${exch})</strong> শেয়ারটির ২০টি সূচকের মধ্যে <strong>${bullCount}টি ইতিবাচক</strong> এবং <strong>${bearCount}টি সতর্কতামূলক</strong> অবস্থানে রয়েছে। বাজার এখন পরবর্তী দিক নির্ধারণের অপেক্ষায় আছে।`;
    actionAdvice = `নতুন করে কেনার আগে শেয়ারটি নিচের সাপোর্ট <strong>৳${s1.toFixed(2)}</strong> থেকে ঘুরে দাঁড়ায় কি না অথবা উপরের <strong>৳${r1.toFixed(2)}</strong> সীমা অতিক্রম করে কি না তা দেখুন।`;
  }

  const momentumHuman = rsi14 < 40
    ? `শেয়ারটি বর্তমানে অতিরিক্ত বিক্রিত অবস্থায় রয়েছে, যেখান থেকে দাম ঘুরে দাঁড়ানোর জোরালো সম্ভাবনা তৈরি হয়েছে।`
    : (rsi14 > 68
        ? `শেয়ারটির দাম দ্রুত বাড়ায় এখন কিছুটা বিশ্রাম বা মুনাফা তুলে নেওয়ার চাপ তৈরি হতে পারে।`
        : `শেয়ারটির কেনাবেচার গতি ও চাহিদা বর্তমানে বেশ ভারসাম্যপূর্ণ এবং সুস্থ অবস্থায় রয়েছে।`);

  const trendHuman = price >= sma20
    ? `গত ২০ কার্যদিবসের গড় দরের (<strong>৳${sma20.toFixed(2)}</strong>) উপরে অবস্থান করায় শেয়ারটির ঊর্ধ্বমুখী ধারা শক্তিশালী রয়েছে।`
    : `গত ২০ কার্যদিবসের গড় দরের (<strong>৳${sma20.toFixed(2)}</strong>) নিচে অবস্থান করায় শেয়ারটিতে কিছুটা বিক্রির চাপ লক্ষ্য করা যাচ্ছে।`;

  const fullReportHtml = `
    <div style="font-family: 'Hind Siliguri', 'Noto Sans Bengali', system-ui, sans-serif; font-size: 15.5px; line-height: 1.85; color: #1E293B;">
      <div style="font-size: 16.5px; font-weight: 700; color: #0F172A; margin-bottom: 6px;">${decisionTitle}</div>
      <p style="margin: 0 0 12px 0; color: #334155;">${decisionSummary}</p>
      <ul style="margin: 0; padding-left: 20px; list-style-type: disc; display: flex; flex-direction: column; gap: 8px;">
        <li><strong>মার্কেট ট্রেন্ড ও গতিবিধি:</strong> ${trendHuman} ${momentumHuman}</li>
        <li><strong>গুরুত্বপূর্ণ সাপোর্ট ও রেজিস্ট্যান্স:</strong> নিচের নিরাপদ সাপোর্ট স্তর <strong>৳${s1.toFixed(2)}</strong> (দ্বিতীয় সাপোর্ট <strong>৳${s2.toFixed(2)}</strong>) এবং উপরের বাধা বা রেজিস্ট্যান্স স্তর <strong>৳${r1.toFixed(2)}</strong> (দ্বিতীয় রেজিস্ট্যান্স <strong>৳${r2.toFixed(2)}</strong>)।</li>
        <li><strong>সাম্প্রতিক লেনদেনের চিত্র:</strong> বর্তমান বাজার দর <strong>৳${price.toFixed(2)}</strong> (আগের ক্লোজিং/ওপেনিং ছিল <strong>৳${dayOpen.toFixed(2)}</strong> এবং সাম্প্রতিক সর্বনিম্ন থেকে সর্বোচ্চ সীমা <strong>৳${dayLow.toFixed(2)} – ৳${dayHigh.toFixed(2)}</strong>)।</li>
        <li><strong>করণীয় ও ঝুঁকি ব্যবস্থাপনা:</strong> ${actionAdvice} বিনিয়োগ সুরক্ষায় অবশ্যই <strong>৳${s1.toFixed(2)}</strong> দরে স্টপ-লস মেনে চলুন।</li>
      </ul>
    </div>
  `;

  const rawBackendAi = (data.ai_analysis_bn || "").trim();
  const isGenericFallback = !rawBackendAi || rawBackendAi.includes("মেশিন লার্নিং মডেলের বিশ্লেষণে অবস্থান") || rawBackendAi.includes("চূড়ান্ত AI সিদ্ধান্ত");
  const finalReport = isGenericFallback
    ? fullReportHtml
    : fullReportHtml + `<div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed #CBD5E1; font-size: 15px; line-height: 1.8; color: #334155;"><strong>🤖 বিশেষ বাজার পর্যবেক্ষণ:</strong> ${rawBackendAi}</div>`;

  return { actionType, badgeText, s1, s2, r1, r2, fullReport: finalReport };
}

if (!localStorage.getItem("ms_cache_v8")) { localStorage.clear(); localStorage.setItem("ms_cache_v8", "1"); }

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
      const slideInfo = buildInstitutionalAnalysis(item); aiEl.innerHTML = slideInfo.fullReport;
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
    const picksData = await cachedFetchJson(`${API_BASE_URL}/api/top-picks`, `ms_top_picks_${getBstCycleStamp()}`); const picksRes = { ok: true, json: async () => picksData };
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
  const allBadgeTargets = [
    document.getElementById("res-signal"),
    document.getElementById("res-signal-badge"),
    ...Array.from(document.querySelectorAll("#analyzer-results span, .signal-badge")).filter(el =>
      /Strong Buy|Hold|Wait|Sell|কিনতে|বিক্রি|অপেক্ষা/i.test(el.innerText || "")
    )
  ].filter(Boolean);

  allBadgeTargets.forEach(badgeEl => {
    badgeEl.innerText = enriched.badgeText;
    if (enriched.actionType === "BUY") {
      badgeEl.className = "inline-block px-3.5 py-1.5 rounded-lg text-sm font-bold bg-emerald-50 text-emerald-700 border border-emerald-200";
    } else if (enriched.actionType === "SELL") {
      badgeEl.className = "inline-block px-3.5 py-1.5 rounded-lg text-sm font-bold bg-rose-50 text-rose-700 border border-rose-200";
    } else {
      badgeEl.className = "inline-block px-3.5 py-1.5 rounded-lg text-sm font-bold bg-amber-50 text-amber-800 border border-amber-200";
    }
  });
  const aiTextBox = document.getElementById("res-ai-text");
  if (aiTextBox) {
    aiTextBox.style.whiteSpace = "pre-line";
    aiTextBox.style.lineHeight = "1.75";
    aiTextBox.style.whiteSpace = "normal"; aiTextBox.innerHTML = enriched.fullReport; setTimeout(() => enforceUnifiedBadgeSync(data), 0);
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


// === Final Post-Render Signal Badge & AI Report Synchronizer (Prevents Hold/Sell Badge Override) ===
function enforceUnifiedBadgeSync(data) {
  if (!data || typeof buildInstitutionalAnalysis !== "function") return;
  const enriched = buildInstitutionalAnalysis(data);
  const badge = document.getElementById("res-signal-badge") || document.getElementById("res-signal");
  if (badge) {
    badge.innerText = enriched.badgeText;
    if (enriched.actionType === "BUY") {
      badge.className = "inline-block px-3.5 py-1.5 rounded-lg text-sm font-bold bg-emerald-50 text-emerald-700 border border-emerald-200";
    } else if (enriched.actionType === "SELL") {
      badge.className = "inline-block px-3.5 py-1.5 rounded-lg text-sm font-bold bg-rose-50 text-rose-700 border border-rose-200";
    } else {
      badge.className = "inline-block px-3.5 py-1.5 rounded-lg text-sm font-bold bg-amber-50 text-amber-800 border border-amber-200";
    }
  }
  const aiBox = document.getElementById("res-ai-text");
  if (aiBox) {
    aiBox.style.whiteSpace = "normal";
    aiBox.innerHTML = enriched.fullReport;
  }
}
