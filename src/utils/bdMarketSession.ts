import type { MarketSessionInfo } from '../types/market';

export function getBstDate(baseDate: Date = new Date()): Date {
  const utcMs = baseDate.getTime() + baseDate.getTimezoneOffset() * 60_000;
  return new Date(utcMs + 6 * 3_600_000);
}

export function formatBstTimestamp(baseDate: Date = new Date()): string {
  const bst = getBstDate(baseDate);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(bst.getDate()).padStart(2, '0');
  const month = months[bst.getMonth()];
  const year = bst.getFullYear();
  let hours = bst.getHours();
  const minutes = String(bst.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day} ${month} ${year}, ${String(hours).padStart(2, '0')}:${minutes} ${ampm} BST`;
}

export function getBstCycleStamp(baseDate: Date = new Date()): string {
  const bst = getBstDate(baseDate);
  if (bst.getHours() < 15) {
    bst.setDate(bst.getDate() - 1);
  }
  const yyyy = bst.getFullYear();
  const mm = String(bst.getMonth() + 1).padStart(2, '0');
  const dd = String(bst.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}_1500BST`;
}

export function getBDMarketSession(baseDate: Date = new Date()): MarketSessionInfo {
  const bst = getBstDate(baseDate);
  const day = bst.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const mins = bst.getHours() * 60 + bst.getMinutes();
  const isTradingDay = day >= 0 && day <= 4;
  const bdTime = formatBstTimestamp(baseDate);

  if (isTradingDay && mins >= 600 && mins <= 870) {
    return {
      is_live: true,
      mode: 'LIVE',
      cardTiming: 'রিয়েল-টাইম টেকনিক্যাল পর্যবেক্ষণ (Live)',
      badge: 'লাইভ মার্কেট সেশন চলছে (১০:০০ AM – ২:৩০ PM BST)',
      headline: 'লাইভ AI টেকনিক্যাল র‍্যাডার: Strong Bullish Setup পর্যবেক্ষণ',
      subtext: 'রিয়েল-টাইম বাজার দর, ১৭-ফিচার XGBoost ML ও ২০-ইন্ডিকেটর ভিত্তিক রিয়েল-টাইম AI মার্কেট সিগন্যাল ও প্রযুক্তিগত বিশ্লেষণ',
      bd_time: bdTime,
    };
  }

  if (isTradingDay && mins < 600) {
    return {
      is_live: false,
      mode: 'PRE_MARKET',
      cardTiming: 'প্রি-মার্কেট ডেটা পর্যবেক্ষণ',
      badge: 'প্রি-মার্কেট প্রস্তুতি · আজ সকাল ১০:০০টায় লেনদেন শুরু',
      headline: 'প্রি-মার্কেট AI র‍্যাডার: Strong Bullish Setup পর্যবেক্ষণ',
      subtext: 'সর্বশেষ ৩:০০ PM BST ক্লোজিং ডেটা ও ২০-ইন্ডিকেটর ভিত্তিক গবেষণামূলক টেকনিক্যাল তালিকা',
      bd_time: bdTime,
    };
  }

  if (day === 5 || day === 6 || (day === 4 && mins > 870)) {
    return {
      is_live: false,
      mode: 'WEEKEND',
      cardTiming: 'সাপ্তাহিক ক্লোজিং ডেটা পর্যবেক্ষণ',
      badge: 'সাপ্তাহিক মার্কেট বন্ধ - সর্বশেষ ক্লোজিং ডেটা · পরবর্তী সেশন রবিবার সকাল ১০:০০টা',
      headline: 'সাপ্তাহিক AI র‍্যাডার: Strong Bullish Setup পর্যবেক্ষণ',
      subtext: 'সাপ্তাহিক ক্লোজিং ডেটা ও ২০-ইন্ডিকেটর বিশ্লেষণে চিহ্নিত রিয়েল-টাইম AI মার্কেট সিগন্যাল ও প্রযুক্তিগত বিশ্লেষণ তালিকা',
      bd_time: bdTime,
    };
  }

  return {
    is_live: false,
    mode: 'DAILY_LOCK',
    cardTiming: 'সর্বশেষ ৩:০০ PM BST ক্লোজিং বিশ্লেষণ',
    badge: 'মার্কেট বন্ধ - সর্বশেষ ক্লোজিং ডেটা · পরবর্তী সেশন সকাল ১০:০০টা BST',
    headline: 'ডেইলি AI র‍্যাডার: Strong Bullish Setup পর্যবেক্ষণ',
    subtext: 'আজকের ক্লোজিং ডেটা ও ২০-ইন্ডিকেটর কনসেনসাস ভিত্তিক গবেষণামূলক টেকনিক্যাল তালিকা',
    bd_time: bdTime,
  };
}
