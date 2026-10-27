<?php

declare(strict_types=1);

// Serves the app shell (one HTML page that loads the JavaScript app) with the security headers.

use SilvaMentis\App;
use SilvaMentis\Config;
use SilvaMentis\Http\Request;

require __DIR__ . '/../src/bootstrap.php';
SilvaMentis\installErrorHandling();

// Under `php -S`, files that exist (scripts, styles, fonts) are served directly; everything
// else lands here and gets the shell, like on Apache with DirectoryIndex.
$config = Config::load(SilvaMentis\PROJECT_ROOT);
App::shell($config, Request::fromGlobals(0))->send();
