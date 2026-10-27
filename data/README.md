# Data folder

silva-mentis keeps its SQLite database and the one-time setup token here.
PHP needs write access to this folder; the web server must never serve it.
To reset an installation, delete the `.sqlite` files in this folder.
