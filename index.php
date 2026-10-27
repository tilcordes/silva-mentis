<?php
// Fallback entry when the whole project folder was uploaded into the web root and the web server
// cannot rewrite requests (see .htaccess). The app itself lives in public/.
header('Location: public/', true, 302);
