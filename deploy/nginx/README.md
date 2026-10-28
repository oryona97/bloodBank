# bloodbank.proida.dev behind Nginx in the Proxmox LXC

First complete [the production deployment setup](../README.md) on the Docker VM
at `192.168.1.135`. The production Compose file publishes port `3001` on that
VM's private address. Nginx is installed in a separate LXC at `192.168.1.82`.
Its upstream is `http://192.168.1.135:3001`.

The production image serves both the frontend and `/api` on this port. Forward
every path to the app, preserving the original URI. No frontend rebuild or
separate API domain is needed. `localhost` inside the Nginx LXC refers to that
LXC itself; connect to the Docker VM's address. Docker container names and its
embedded DNS resolver are not used by this Nginx installation.

## DNS and HTTPS

Use the same public DNS and router entry point as the other domains served by
this Nginx LXC. The public `A` record must reach that entry point, and inbound
HTTP/HTTPS traffic must reach `192.168.1.82` on ports `80` and `443`. If an `AAAA`
record exists, its IPv6 route must reach the same Nginx installation. The
private upstream `192.168.1.135:3001` is the route from Nginx to the app.

Browsers require HTTPS for `.dev` domains. Before enabling this configuration,
issue a certificate covering `bloodbank.proida.dev`, or use an existing
`*.proida.dev` wildcard certificate. Use the certificate tooling already used
by your Nginx deployment, with the certificate and private key available in
the LXC. The paths in `bloodbank.proida.dev.conf` are examples; replace them
with the actual paths inside that LXC.

Retain your existing certificate renewal setup. If it uses the HTTP-01 webroot
challenge, preserve its `/.well-known/acme-challenge/` location and put the HTTP
redirect in a separate `location /` instead of at server level. Reload Nginx
after renewing certificates.

## Install and verify

Open a shell inside the Nginx LXC (`192.168.1.82`), using the Proxmox console or
your existing SSH access. First verify that it can reach the app:

```sh
curl --fail --show-error http://192.168.1.135:3001/api/health
```

If this cannot connect, check the app's published port and the network/firewall
route between the LXC and the VM. Allow TCP from `192.168.1.82` to the Docker
VM's application port through any active Proxmox/network firewall.

Copy `bloodbank.proida.dev.conf` into Nginx's included configuration directory
inside the LXC (commonly `/etc/nginx/conf.d`), alongside your other domains.
If you change `APP_BIND_IP` or `APP_PORT` in the Docker deployment, update the
`proxy_pass` address in this configuration to match.

Test the complete configuration:

```sh
sudo nginx -t
```

Only after that succeeds, reload and check the application:

```sh
sudo nginx -s reload
curl --fail --show-error https://bloodbank.proida.dev/api/health
```

The health endpoint should return `{"status":"ok"}`. It also verifies database
access and records a health-check audit event. Open
`https://bloodbank.proida.dev` to check the frontend and sign-in flow.

The configuration targets the VM's stable LAN address and published port.
Ordinary app deployments do not require an Nginx reload; requests may briefly
fail while the app restarts. Configuration or certificate changes still require
a reload. Run the native Nginx commands above inside the LXC; this Nginx service
is managed separately from Docker.

References: [Nginx reverse proxy](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/),
[Docker port publishing](https://docs.docker.com/engine/network/port-publishing/),
[HTTPS requirement for .dev](https://www.registry.google/domains/dev/).
