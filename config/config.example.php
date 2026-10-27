<?php

// silva-mentis settings. Copy this file to config/config.php and change what you need.
// Environment variables SILVA_MENTIS_MODE, SILVA_MENTIS_DATA_DIR and SILVA_MENTIS_TRUSTED_PROXIES
// (comma-separated) override the values here.
// All keys are optional; the values below are the defaults.

return [
    // 'normal' = login + encryption. 'test' = the test version without login and encryption,
    // which only answers requests from this computer. Never use 'test' for real notes.
    'mode' => 'normal',

    // Where the SQLite database and the setup token live. Must be writable by PHP and must
    // NOT be reachable from the web.
    // 'data_dir' => '/var/lib/silva-mentis',

    // A session ends after this many days without use, or this many days after login.
    'session_idle_days' => 30,
    'session_max_days' => 90,

    // Largest encrypted page the server accepts, in bytes.
    'max_document_bytes' => 4000000,

    // Addresses or networks of reverse proxies (e.g. '10.0.0.5' or '172.16.0.0/12') whose
    // X-Forwarded-For and X-Forwarded-Proto headers may be believed. Leave empty when PHP faces
    // the internet directly (typical shared webhosting).
    'trusted_proxies' => [],

    // Test version only: answer requests from other machines too, and accept these Host names.
    'test_mode_allow_remote' => false,
    'allowed_hosts' => [],
];
