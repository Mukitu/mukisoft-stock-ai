<?php
/**
 * MukiSoft Stock AI — Hardened BDApps (Robi & Cirkle) OTP Verification Endpoint
 * Deploy to: https://skillproof.top/stock/verify_otp.php
 *
 * Security & Compatibility Guarantees:
 * - Reads BDAPPS_APP_ID / BDAPPS_APP_PASSWORD from server environment variables or config.php (never hardcoded).
 * - Strict CORS origin allowlist (no wildcard *).
 * - Accepts exact `Otp` (capital O) + `referenceNo`, forwards BDApps' raw `subscriptionStatus`,
 *   and treats 'REGISTERED', 'INITIAL CHARGING PENDING' (plus underscore/pending variants),
 *   'E1351', and 'S1000' verification success as `isSubscribed => true`.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=UTF-8');

$allowedOrigins = [
    'https://stock.mukisoft.tech',
    'http://localhost:3000',
    'http://localhost:5173',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Accept');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'isSubscribed' => false, 'error' => 'Method Not Allowed']);
    exit;
}

// Optional server-side config file (outside webroot or protected via .htaccess)
if (file_exists(__DIR__ . '/config.php')) {
    require_once __DIR__ . '/config.php';
}

$appId = (string) (getenv('BDAPPS_APP_ID') ?: (defined('BDAPPS_APP_ID') ? BDAPPS_APP_ID : ''));
$password = (string) (getenv('BDAPPS_APP_PASSWORD') ?: (defined('BDAPPS_APP_PASSWORD') ? BDAPPS_APP_PASSWORD : ''));

if ($appId === '' || $password === '') {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'isSubscribed' => false,
        'error' => 'BDApps server credentials are not configured.',
    ]);
    exit;
}

$rawBody = file_get_contents('php://input');
$jsonBody = json_decode($rawBody ?: '', true);
$input = is_array($jsonBody) ? array_merge($_POST, $jsonBody) : $_POST;

// Support exact capital 'Otp' sent by React frontend (and lowercase fallback)
$otp = preg_replace('/\D+/', '', (string) ($input['Otp'] ?? $input['otp'] ?? '')) ?? '';
$referenceNo = trim((string) ($input['referenceNo'] ?? ''));

if (!preg_match('/^[0-9]{4,8}$/', $otp)) {
    http_response_code(422);
    echo json_encode([
        'success' => false,
        'isSubscribed' => false,
        'error' => 'অনুগ্রহ করে সঠিক ৬ ডিজিটের OTP কোড প্রদান করুন।',
    ]);
    exit;
}

if (!preg_match('/^[A-Za-z0-9._-]{4,128}$/', $referenceNo)) {
    http_response_code(422);
    echo json_encode([
        'success' => false,
        'isSubscribed' => false,
        'error' => 'সঠিক OTP রেফারেন্স নম্বর পাওয়া যায়নি। অনুগ্রহ করে পুনরায় OTP চান।',
    ]);
    exit;
}

$payload = json_encode([
    'applicationId' => $appId,
    'password' => $password,
    'referenceNo' => $referenceNo,
    'otp' => $otp,
], JSON_UNESCAPED_SLASHES);

$ch = curl_init('https://developer.bdapps.com/subscription/otp/verify');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $payload,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json;charset=utf-8', 'Accept: application/json'],
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
]);

$response = curl_exec($ch);
$curlErr = curl_error($ch);
$httpStatus = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($response === false || $httpStatus < 200 || $httpStatus >= 500) {
    http_response_code(502);
    echo json_encode([
        'success' => false,
        'isSubscribed' => false,
        'error' => $curlErr !== '' ? 'BDApps gateway unreachable.' : 'BDApps upstream error.',
    ]);
    exit;
}

$bd = json_decode($response, true);
if (!is_array($bd)) {
    http_response_code(502);
    echo json_encode([
        'success' => false,
        'isSubscribed' => false,
        'error' => 'Invalid JSON returned from BDApps.',
    ]);
    exit;
}

$rawStatus = trim((string) ($bd['subscriptionStatus'] ?? ''));
$normalizedStatus = preg_replace('/\s+/', ' ', str_replace(['_', '-'], ' ', strtoupper($rawStatus))) ?? '';
$statusCode = strtoupper(trim((string) ($bd['statusCode'] ?? '')));
$statusDetail = (string) ($bd['statusDetail'] ?? '');
$subscriberId = trim((string) ($bd['subscriberId'] ?? ''));

$activeStatuses = ['REGISTERED', 'INITIAL CHARGING PENDING', 'PENDING'];
$inactiveStatuses = ['UNREGISTERED', 'DEREGISTERED', 'EXPIRED'];
$isSubscribed = in_array($normalizedStatus, $activeStatuses, true)
    || $statusCode === 'E1351'
    || ($statusCode === 'S1000' && !in_array($normalizedStatus, $inactiveStatuses, true));

// Preserve BDApps raw status verbatim when present; default cleanly when S1000 omits it
$outStatus = $rawStatus !== ''
    ? $rawStatus
    : ($isSubscribed ? 'REGISTERED' : 'UNREGISTERED');

echo json_encode([
    'success' => $isSubscribed,
    'isSubscribed' => $isSubscribed,
    'subscriptionStatus' => $outStatus,
    'statusCode' => $statusCode,
    'statusDetail' => $statusDetail,
    'subscriberId' => $subscriberId,
    'message' => $isSubscribed
        ? 'ভেরিফিকেশন সফল হয়েছে।'
        : ($statusDetail !== '' ? $statusDetail : 'OTP কোডটি সঠিক নয় বা মেয়াদ শেষ হয়েছে।'),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
