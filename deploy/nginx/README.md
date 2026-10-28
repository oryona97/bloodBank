# bloodbank.proida.dev behind the existing Nginx container

First complete [the production deployment setup](../README.md). Its Compose file
attaches the app to Nginx's existing user-defined Docker network with the alias
`bloodbank`. The upstream is `http://bloodbank:3001`.

The production image serves both the frontend and `/api` on this port. Forward
every path to the app, preserving the original URI. No frontend rebuild or
separate API domain is needed. `localhost` inside the Nginx container refers to
Nginx itself, so use the app's Docker alias.

## DNS and HTTPS

Point the DNS `A` record for `bloodbank.proida.dev` at the server's public IPv4
address. If an `AAAA` record exists, its IPv6 address must reach the same proxy.
Publish Nginx's ports `80` and `443` on the server and allow them through the
firewall, as with your other hosted domains.

Browsers require HTTPS for `.dev` domains. Before enabling this configuration,
issue a certificate covering `bloodbank.proida.dev`, or use an existing
`*.proida.dev` wildcard certificate. Use the certificate tooling already used
by your Nginx deployment, and mount its certificate and private key into the
Nginx container. The certificate paths in `bloodbank.proida.dev.conf` are
examples; replace them with your actual paths inside the Nginx container.

Retain your existing certificate renewal setup. If it uses the HTTP-01 webroot
challenge, preserve its `/.well-known/acme-challenge/` location and put the HTTP
redirect in a separate `location /` instead of at server level. Reload Nginx
after renewing certificates.

## Install and verify

Add `bloodbank.proida.dev.conf` to the existing host directory mounted into
Nginx's included configuration directory (commonly `/etc/nginx/conf.d`),
alongside your other domains. Make sure Nginx shares the `PROXY_NETWORK` selected
in `.env.production`. Replace `YOUR_NGINX_CONTAINER` with its actual name.

Test the complete configuration:

```sh
docker exec YOUR_NGINX_CONTAINER nginx -t
```

Only after that succeeds, reload and check the application:

```sh
docker exec YOUR_NGINX_CONTAINER nginx -s reload
curl --fail --show-error https://bloodbank.proida.dev/api/health
```

The health endpoint should return `{"status":"ok"}`. It also verifies database
access and records a health-check audit event. Open
`https://bloodbank.proida.dev` to check the frontend and sign-in flow.

The configuration uses Docker's DNS server at `127.0.0.11` with a ten-second
cache to refresh the app container's address after replacement. Ordinary app
deployments do not require an Nginx reload; requests may briefly fail while
the app restarts or the cached address expires. Configuration or certificate
changes still require a reload.

References: [Nginx reverse proxy](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/),
[Docker DNS](https://docs.docker.com/engine/network/#dns-services),
[Nginx resolver](https://nginx.org/en/docs/http/ngx_http_core_module.html#resolver),
[HTTPS requirement for .dev](https://www.registry.google/domains/dev/).
