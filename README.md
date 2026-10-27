# silva-mentis

*The forest of your thinking.*

**Self-hosted, end-to-end encrypted notes for associative thinking.**

silva-mentis is an open-source note-taking app you run on your own web space or server. You write
in bullets, connect your thoughts with links and tags, and every page shows everything that points
to it. Your notes are encrypted in your browser before they leave your device.

## What is silva-mentis?

- **Outliner with markdown.** Every note is a list of bullets that can be nested, folded, moved
  and dragged. Bold, italic, highlights, tasks (`[ ]`), headings, quotes and code work as plain
  markdown.
- **Links and tags.** `[[Page]]`, `#Tag` and `#[[Multi Word Tag]]` connect a bullet to a page.
  Every page is a tag and every tag is a page. A page exists as soon as you link to it.
- **Linked references.** Below every page you see every bullet that points to it, editable in
  place, with a filter to narrow them down by the other pages they mention.
- **Unlinked references.** Plain-text mentions of a page's title, turned into links with one click.
- **Daily notes.** The app opens on today's page. Link a future date, and the bullet shows up on
  that day when it arrives.
- **Sidebar.** Shift+click any link to open a page next to the one you're working on.
- **Rename and merge.** Renaming a page updates every link to it. Renaming it to a title that
  already exists merges both pages.
- **Attributes and templates** (`Author:: [[Name]]`), a **graph** of all pages and links,
  **search** (Ctrl+K), light and dark themes, and a layout for phones.
- **Your data stays yours.** Export everything as markdown files at any time and import them
  again.

All features and keyboard shortcuts are described on the documentation site:
[silva-mentis.org](https://silva-mentis.org). What changed in each version is listed in
[CHANGELOG.md](CHANGELOG.md).

## How to install

silva-mentis has exactly one account and needs a domain (or subdomain) of its own with **HTTPS**:
browsers only allow the encryption functions on secure connections.

### Option A: Shared webhosting with PHP

Requirements: PHP 8.2 or newer with the `pdo_sqlite` extension (enabled on almost every host).
No database, no command line and no extra software are needed.

1. **Download** this repository (*Code → Download ZIP*), unpack it and rename the folder to
   `silva-mentis`.
2. **Upload** the whole `silva-mentis` folder to your web space, for example with FTP or your host's
   file manager.
3. In your hosting panel, **point your (sub)domain at the `public/` folder** inside it, e.g.
   `/silva-mentis/public/`. Only this folder must be reachable from the web.
4. Select **PHP 8.2 or newer** for the domain and **enable HTTPS** (most hosts offer free
   certificates).
5. **Open the domain in your browser** and continue with [First login](#first-login).

PHP needs write access to the `data/` folder only; on most shared hosts this works without
changing anything. If your host can't point a domain at a sub-folder, upload the folder into the
web root anyway: the included `.htaccess` files forward visitors to `public/` and block everything
else (Apache). The setup screen checks that `data/` is not reachable from the web and refuses to
continue if it is.

**Updating:** replace all files except the `data/` folder (and `config/config.php`, if you created
one). **Backup:** download `data/silva-mentis.sqlite`.

### Option B: Docker on a Linux server

Requirements: Docker with the Compose plugin, a domain whose DNS points at the server, and ports 80
and 443 open. The included setup runs silva-mentis (PHP + Apache) behind Caddy, which obtains and
renews the HTTPS certificate automatically.

```sh
git clone https://github.com/tilcordes/silva-mentis.git
cd silva-mentis
echo "DOMAIN=notes.example.com" > .env
docker compose up -d --build
```

Then open `https://notes.example.com` and continue with [First login](#first-login).

Your encrypted notes live in the Docker volume `silva-mentis-data`.

- **Updating:** `git pull && docker compose up -d --build`
- **Backup:** `docker compose cp silva-mentis:/var/www/silva-mentis/data ./silva-mentis-backup`

Already running a reverse proxy? Build and run only the app container and let your proxy forward
to it. Tell silva-mentis which addresses your proxy uses, so it can see the real client address and
HTTPS:

```sh
docker build -t silva-mentis .
docker run -d --name silva-mentis -p 127.0.0.1:8080:80 \
  -v silva-mentis-data:/var/www/silva-mentis/data \
  -e SILVA_MENTIS_TRUSTED_PROXIES=127.0.0.1,172.16.0.0/12 \
  silva-mentis
```

Optional server settings (session lifetime, size limits, trusted proxies) are described in
`config/config.example.php`. Copy it to `config/config.php` to change them.

## First login

On a fresh installation nobody has an account yet. So that only you can claim it, the first visit
asks for a **setup token**, a one-time code that only someone with access to the server's files
can read:

1. Open silva-mentis. The server creates a file `setup-token-xxxxxxxx.txt` in the `data/` folder.
   - **Shared webhosting:** download or open it with FTP or your host's file manager.
   - **Docker:** `docker compose exec silva-mentis sh -c 'cat data/setup-token-*.txt'`
2. Enter the 32-character token, choose a username and a password of at least 12 characters. A
   few unrelated words make a strong, memorable passphrase.
3. silva-mentis shows your **recovery key** once. Copy or download it and keep it somewhere safe and
   offline. It is the only way back in if you forget your password. Nobody can reset your
   password for you, not even the server's administrator, because the server can't read your
   notes.
4. Click *Open my notes*. The token file is deleted and registration is closed for good.

From now on you log in with username and password. On a device you trust, you can tick *Keep
unlocked on this device*, so reloading doesn't ask for the password again.

## Encryption

Everything is encrypted and decrypted **in your browser** with the Web Crypto API. The server only
stores ciphertext; it never sees your password, your keys, your page titles or your text.

- **Your password** is stretched with PBKDF2-SHA256 (600,000 iterations, random salt) into a
  master secret. From it, HKDF derives two independent keys: an *authentication key*, which is
  sent to the server to log in (the server keeps only a bcrypt hash of it), and a
  *key-encryption key*, which never leaves the browser.
- **Your notes** are encrypted with a random 256-bit *data key* (AES-256-GCM), created in the
  browser at registration. The server stores this data key only in wrapped (encrypted) form: once
  wrapped with your password's key, once with your recovery key.
- **Every page** is encrypted separately with a fresh random IV. Each ciphertext is bound to its
  page id, so the server can't swap pages around, and its size is padded to blur how long your
  notes are.
- **Changing your password** re-wraps the data key; your notes don't have to be re-encrypted. The
  **recovery key** (128 random bits) can set a new password and is then replaced by a new one.

What the server can see: how many pages exist, their approximate sizes, and when they change.
What silva-mentis can't protect against: someone who can change the code your server delivers (for
example through a compromised hosting account), or a compromised device. Choose a long passphrase:
a stolen database can only be attacked by guessing it, and every guess is deliberately slow.
