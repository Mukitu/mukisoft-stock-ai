export const DSE_CSE_SECTORS: Record<string, string[]> = {
  'Pharmaceuticals & Chemicals': [
    'SQURPHARMA', 'RENATA', 'BXPHARMA', 'ACI', 'ACIFORMULA', 'ACMEPL',
    'BEACONPHAR', 'ORIONPHARM', 'ORIONINFU', 'IBNSINA', 'MARICO', 'RECKITTBEN',
    'KOHINOOR', 'NAVANAPHAR', 'PHARMAID', 'JHRML', 'WATACHEM',
  ],
  Bank: [
    'BRACBANK', 'CITYBANK', 'DUTCHBANGL', 'EBL', 'PUBALIBANK', 'PRIMEBANK',
    'MTB', 'UCB', 'BANKASIA', 'DHAKABANK', 'IFIC', 'JAMUNABANK',
    'NCCBANK', 'TRUSTBANK', 'UTTARABANK', 'ISLAMIBANK',
  ],
  Telecommunication: ['GP', 'ROBI', 'BSCPLC'],
  Engineering: [
    'WALTONHIL', 'BSRMSTEEL', 'BSRMLTD', 'GPHISPAT', 'SINGERBD', 'RUNNERAUTO',
    'BBSCABLES', 'BDLAMPS', 'IFADAUTOS', 'KDSALTD', 'MIRAKHTER', 'NAHEEACP',
    'NPOLYMER', 'RENWICKJA', 'SSSTEEL',
  ],
  'Fuel & Power': [
    'UPGDCL', 'SUMITPOWER', 'MJLBD', 'JAMUNAOIL', 'MPETROLEUM', 'PADMAOIL',
    'LINDEBD', 'POWERGRID', 'DOREENPWR', 'INTRACO', 'DESCO', 'TITASGAS',
  ],
  'Food & Allied': [
    'BATBC', 'OLYMPIC', 'UNILEVERCL', 'AMCL(PRAN)', 'APEXFOODS',
    'FINEFOODS', 'FUWANGFOOD', 'LOVELLO', 'RDFOOD', 'GHAIL',
  ],
  'IT Sector': [
    'AAMRANET', 'AAMRATECH', 'AGNISYSL', 'BDCOM', 'DAFODILCOM',
    'EGEN', 'GENEXIL', 'ITC',
  ],
  'Financial Institutions (NBFI)': ['LANKABAFIN', 'IDLC', 'DBH', 'IPDC', 'ICB'],
  'Textile & Garments': [
    'SQUARETEXT', 'ENVOYTEX', 'MALEKSPIN', 'MATINSPINN', 'ARGONDENIM',
    'ACFL', 'ESQUIRENIT', 'HRTEX', 'SAIHAMTEX', 'SONARGAON',
  ],
  'Cement & Ceramics': [
    'LHB', 'HEIDELBCEM', 'CONFIDCEM', 'CROWNCEMNT', 'PREMIERCEM',
    'RAKCERAMIC', 'MONNOCERA', 'FUWANGCER',
  ],
  Insurance: [
    'DELTALIFE', 'GREENDELT', 'RELIANCINS', 'PRAGATIINS', 'PRAGATILIF',
    'PIONEERINS', 'EASTLAND', 'NITOLINS', 'SONALILIFE',
  ],
};

export const ALL_SYMBOLS: string[] = Array.from(
  new Set(Object.values(DSE_CSE_SECTORS).flat())
).sort();

export function findSectorBySymbol(symbol: string): string {
  const upper = symbol.trim().toUpperCase();
  for (const [sector, symbols] of Object.entries(DSE_CSE_SECTORS)) {
    if (symbols.includes(upper)) return sector;
  }
  return 'DSE / CSE Equity';
}
