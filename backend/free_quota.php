<?php
/**
 * MukiSoft AI — Optional Standalone PHP 24-Hour Free Quota Endpoint (free_quota.php)
 * Can be deployed alongside send_otp.php & verify_otp.php on skillproof.top/stock.
 * Tracks sha256(client_ip . ":" . deviceHash) in an atomic file-locked JSON store.
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
header('Access-Control-Allow-Headers: Content-Type, Accept, X-Device-Hash, X-Subscriber-Id, X-Subscriber-Mobile');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405);
    echo json_encode(['allowed' => false, 'error' => 'Method Not Allowed']);
    exit;
}

const FREE_QUOTA_LIMIT = 2;
const QUOTA_WINDOW_SECONDS = 86400;
const STORE_PATH = __DIR__ . '/free_quota_store.json';

function extractClientIp(): string {
    $candidates = [];
    if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
        $candidates[] = trim((string) $_SERVER['HTTP_CF_CONNECTING_IP']);
    }
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        foreach (explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR']) as $part) {
            $candidates[] = trim($part);
        }
    }
    if (!empty($_SERVER['REMOTE_ADDR'])) {
        $candidates[] = trim((string) $_SERVER['REMOTE_ADDR']);
    }

    foreach ($candidates as $ip) {
        if (filter_var($ip, FILTER_VALIDATE_IP)) {
            return $ip;
        }
    }
    return '0.0.0.0';
}

function normalizeDeviceHash(string $raw): string {
    $clean = strtolower(trim($raw));
    if (preg_match('/^[a-f0-9]{16,128}$/', $clean)) {
        return $clean;
    }
    return $clean === '' ? 'anonymous-device' : hash('sha256', substr($clean, 0, 256));
}

function normalizeSymbol(string $raw): string {
    $sym = strtoupper(trim($raw));
    if (!preg_match('/^[A-Z0-9&().-]{1,20}$/', $sym)) {
        return '';
    }
    return $sym;
}

$rawBody = file_get_contents('php://input');
$input = json_decode($rawBody ?: '', true);
if (!is_array($input)) {
    $input = $_POST;
}

$action = strtolower(trim((string) ($input['action'] ?? 'status')));
$rawDeviceHash = (string) ($input['deviceHash'] ?? ($_SERVER['HTTP_X_DEVICE_HASH'] ?? ''));
$symbol = normalizeSymbol((string) ($input['symbol'] ?? ''));

$ip = extractClientIp();
$deviceHash = normalizeDeviceHash($rawDeviceHash);
$quotaKey = hash('sha256', $ip . ':' . $deviceHash);
$now = time();

$fp = fopen(STORE_PATH, 'c+');
if ($fp === false) {
    http_response_code(500);
    echo json_encode(['allowed' => false, 'error' => 'Quota store unavailable']);
    exit;
}

flock($fp, LOCK_EX);
$contents = stream_get_contents($fp);
$store = json_decode($contents ?: '{}', true);
if (!is_array($store)) {
    $store = [];
}

// Garbage collect expired records (> 48h old) to keep JSON store compact
foreach ($store as $k => $rec) {
    if (!is_array($rec) || ($now - (int) ($rec['windowStart'] ?? 0)) >= (QUOTA_WINDOW_SECONDS * 2)) {
        unset($store[$k]);
    }
}

$record = $store[$quotaKey] ?? null;
$windowStart = is_array($record) ? (int) ($record['windowStart'] ?? 0) : 0;
$symbols = (is_array($record) && is_array($record['symbols'] ?? null)) ? array_values($record['symbols']) : [];

if ($windowStart <= 0 || ($now - $windowStart) >= QUOTA_WINDOW_SECONDS) {
    $windowStart = 0;
    $symbols = [];
    unset($store[$quotaKey]);
}

$allowed = true;
$httpCode = 200;

if ($action === 'consume' && $symbol !== '') {
    if (!in_array($symbol, $symbols, true)) {
        if (count($symbols) >= FREE_QUOTA_LIMIT) {
            $allowed = false;
            $httpCode = 429;
        } else {
            if ($windowStart <= 0) {
                $windowStart = $now;
            }
            $symbols[] = $symbol;
            $store[$quotaKey] = [
                'windowStart' => $windowStart,
                'symbols' => $symbols,
                'updatedAt' => $now,
            ];
        }
    }
} else {
    $allowed = count($symbols) < FREE_QUOTA_LIMIT;
}

ftruncate($fp, 0);
rewind($fp);
fwrite($fp, json_encode($store, JSON_UNESCAPED_SLASHES));
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);

$remaining = max(0, FREE_QUOTA_LIMIT - count($symbols));
$resetInSeconds = ($windowStart > 0 && count($symbols) > 0)
    ? max(0, QUOTA_WINDOW_SECONDS - max(0, $now - $windowStart))
    : 0;

http_response_code($httpCode);
echo json_encode([
    'allowed' => $allowed,
    'isSubscribed' => false,
    'unlimited' => false,
    'limit' => FREE_QUOTA_LIMIT,
    'windowStart' => count($symbols) > 0 ? $windowStart : 0,
    'symbols' => $symbols,
    'remaining' => $remaining,
    'resetInSeconds' => $resetInSeconds,
]);
