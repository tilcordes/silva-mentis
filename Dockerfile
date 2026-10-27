# silva-mentis on PHP + Apache. The container serves plain HTTP on port 80; HTTPS comes from a
# reverse proxy in front of it (docker-compose.yml uses Caddy, which gets certificates on its own).

FROM php:8.3-apache

# Only public/ is served. src/, config/ and data/ stay outside the web root.
ENV SILVA_MENTIS_DATA_DIR=/var/www/silva-mentis/data

RUN a2enmod headers \
 && cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
 && php -m | grep -qi pdo_sqlite

COPY docker/apache-site.conf /etc/apache2/sites-available/000-default.conf
COPY docker/apache-hardening.conf /etc/apache2/conf-enabled/zz-silva-mentis.conf
COPY docker/php.ini "$PHP_INI_DIR/conf.d/zz-silva-mentis.ini"

WORKDIR /var/www/silva-mentis
COPY --chown=www-data:www-data . .

# Notes (encrypted), sessions and the one-time setup token live here, in a volume.
VOLUME ["/var/www/silva-mentis/data"]
EXPOSE 80
