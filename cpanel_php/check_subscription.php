<?php
/**
 * MukiSoft Stock AI — BDApps (Robi & Cirkle) Subscription Status Endpoint
 * Upload to: public_html/stock/check_subscription.php
 *
 * Accepts $_POST['user_mobile'] or $_POST['subscriberId'], normalizes to tel:8801XXXXXXXXX,
 * queries https://developer.bdapps.com/subscription/getStatus, and returns isSubscribed: true
 * for REGISTERED, INITIAL CHARGING PENDING, INITIAL_CHARGING_PENDING, PENDING, or E1351.
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

if (file_exists(__DIR__ . '/config.php')) {
    require_once __DIR__ . '/config.php';
}

$appid = (string) (getenv('BDAPPS_APP_ID') ?: (defined('BDAPPS_APP_ID') ? BDAPPS_APP_ID : ''));
$apppassword = (string) (getenv('BDAPPS_APP_PASSWORD') ?: (defined('BDAPPS_APP_PASSWORD') ? BDAPPS_APP_PASSWORD : ''));

if ($appid === '' || $apppassword === '' || $apppassword === 'PASTE_YOUR_BDAPPS_APP_PASSWORD_HERE') {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'isSubscribed' => false,
        'error' => 'BDApps server credentials are not configured in config.php or environment.',
    ]);
    exit;
}

$rawBody = file_get_contents('php://input');
$jsonBody = json_decode($rawBody ?: '', true);
$input = is_array($jsonBody) ? array_merge($_POST, $jsonBody) : $_POST;

$rawMobile = trim((string) ($input['user_mobile'] ?? $input['subscriberId'] ?? ''));
if (stripos($rawMobile, 'tel:') === 0) {
    $rawMobile = substr($rawMobile, 4);
}
$digits = preg_replace('/\D+/', '', $rawMobile) ?? '';
if (strlen($digits) === 11 && strpos($digits, '01') === 0) {
    $digits = '88' . $digits;
} elseif (strlen($digits) === 10 && strpos($digits, '1') === 0) {
    $digits = '880' . $digits;
}

if (!preg_match('/^8801[3-9][0-9]{8}$/', $digits)) {
    http_response_code(422);
    echo json_encode([
        'success' => false,
        'isSubscribed' => false,
        'error' => 'অনুগ্রহ করে সঠিক ১০ ডিজিটের Robi & Cirkle নম্বর দিন।',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$subscriberId = 'tel:' . $digits;
$payload = json_encode([
    'applicationId' => $appid,
    'password' => $apppassword,
    'subscriberId' => $subscriberId,
], JSON_UNESCAPED_SLASHES);

$ch = curl_init('https://developer.bdapps.com/subscription/getStatus');
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

$activeStatuses = ['REGISTERED', 'INITIAL CHARGING PENDING', 'PENDING'];
$isSubscribed = in_array($normalizedStatus, $activeStatuses, true)
    || $statusCode === 'E1351';

$outStatus = $rawStatus !== '' ? $rawStatus : ($isSubscribed ? 'REGISTERED' : 'UNREGISTERED');

echo json_encode([
    'success' => $isSubscribed,
    'isSubscribed' => $isSubscribed,
    'subscriptionStatus' => $outStatus,
    'statusCode' => $statusCode !== '' ? $statusCode : ($isSubscribed ? 'S1000' : ''),
    'statusDetail' => $statusDetail,
    'subscriberId' => $subscriberId,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
