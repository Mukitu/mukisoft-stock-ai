<?php
/**
 * MukiSoft Stock AI — BDApps (Robi & Cirkle) OTP Request Endpoint
 * Upload to: https://stock.skillproof.top/send_otp.php
 *
 * Accepts $_POST['user_mobile'], normalizes to tel:8801XXXXXXXXX,
 * POSTs JSON to https://developer.bdapps.com/subscription/otp/request (applicationHash: 'Stock AI').
 * Returns immediate active unlock payload when BDApps responds with statusCode === 'E1351'.
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
    echo json_encode(['success' => false, 'error' => 'Method Not Allowed']);
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
        'error' => 'অনুগ্রহ করে সঠিক ১০ ডিজিটের Robi & Cirkle নম্বর দিন।',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$subscriberId = 'tel:' . $digits;
$payload = json_encode([
    'applicationId' => $appid,
    'password' => $apppassword,
    'subscriberId' => $subscriberId,
    'applicationHash' => 'Stock AI',
    'applicationMetaData' => [
        'client' => 'WEBAPP',
        'device' => 'Browser',
        'os' => 'Web',
        'appCode' => 'https://stock.mukisoft.tech',
    ],
], JSON_UNESCAPED_SLASHES);

$ch = curl_init('https://developer.bdapps.com/subscription/otp/request');
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
        'error' => $curlErr !== '' ? 'BDApps OTP gateway unreachable.' : 'BDApps upstream error.',
    ]);
    exit;
}

$bd = json_decode($response, true);
if (!is_array($bd)) {
    http_response_code(502);
    echo json_encode([
        'success' => false,
        'error' => 'Invalid JSON returned from BDApps OTP gateway.',
    ]);
    exit;
}

$statusCode = strtoupper(trim((string) ($bd['statusCode'] ?? '')));
$statusDetail = (string) ($bd['statusDetail'] ?? '');
$referenceNo = trim((string) ($bd['referenceNo'] ?? ''));

// E1351: Already registered subscriber -> skip OTP and unlock /dashboard directly
if ($statusCode === 'E1351') {
    echo json_encode([
        'success' => true,
        'isSubscribed' => true,
        'subscriptionStatus' => 'REGISTERED',
        'statusCode' => 'E1351',
        'statusDetail' => $statusDetail !== '' ? $statusDetail : 'User already registered',
        'subscriberId' => $subscriberId,
        'message' => 'আপনার Robi & Cirkle নম্বরটি ইতিমধ্যেই সক্রিয় রয়েছে।',
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($statusCode === 'S1000' && $referenceNo !== '') {
    echo json_encode([
        'success' => true,
        'isSubscribed' => false,
        'statusCode' => $statusCode,
        'statusDetail' => $statusDetail,
        'referenceNo' => $referenceNo,
        'subscriberId' => $subscriberId,
        'message' => 'আপনার Robi & Cirkle নম্বরে ৬ ডিজিটের OTP পাঠানো হয়েছে।',
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

echo json_encode([
    'success' => false,
    'isSubscribed' => false,
    'statusCode' => $statusCode,
    'statusDetail' => $statusDetail,
    'message' => $statusDetail !== '' ? $statusDetail : 'OTP পাঠানো সম্ভব হয়নি। অনুগ্রহ করে Robi & Cirkle নম্বরটি যাচাই করুন।',
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
