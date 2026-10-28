# Production deployment

The app runs in Docker on the Ubuntu VM at `192.168.1.135`. Nginx runs in a
separate Proxmox LXC at `192.168.1.82`. Run the deployment script on the Docker
VM; install the Nginx configuration inside the Nginx LXC.

Requests follow this route:

```text
bloodbank.proida.dev -> Nginx LXC 192.168.1.82:443
                    -> Docker VM 192.168.1.135:3001 -> app container port 3001
```

The Docker VM address comes from the existing published ports on this server.
Verify it with `hostname -I` on that VM if its network settings have changed.
Nginx manages the public domain, HTTPS and ports 80/443. Docker publishes the
application on the VM's private address; PostgreSQL stays on its private Docker
network. A shared Docker network between Nginx and the app is not required.

| File                                     | Purpose                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `deploy-prod.sh`                         | Validates settings, deploys containers and waits for health checks.         |
| `compose.production.yaml`                | Production stack with persistent storage and a private host port for Nginx. |
| `.env.production`                        | Your server settings and credentials, excluded from Git.                    |
| `.env.production.example`                | Template for the production settings.                                       |
| `deploy/nginx/bloodbank.proida.dev.conf` | Virtual host to add to the existing Nginx configuration.                    |

Production does not merge the local `compose.yaml` or load the local `.env`.
It sets `DEMO_MODE=false` and starts with the administrator you configure.
It does not create the default demo accounts or automatically seed sample stock.

## First deployment

Use a Docker Compose version supporting `up --wait --wait-timeout`. The script
uses the installed `docker compose` command; if your server requires elevated
Docker access, invoke it as `sudo bash ./deploy-prod.sh`.

1. In the repository root, create the server configuration:

   ```sh
   cp .env.production.example .env.production
   chmod 600 .env.production
   ```

2. Edit `.env.production`. Fill in `POSTGRES_PASSWORD`, `JWT_SECRET` and
   `ADMIN_PASSWORD`; use a secret of at least 32 characters for `JWT_SECRET`
   and at least eight for the initial administrator password. Generate separate
   random secrets, for example with `openssl rand -hex 32`. Values containing
   `$` or `#` should be single-quoted so Compose treats them literally.

3. Set the published address and port in `.env.production`:

   ```dotenv
   APP_BIND_IP=192.168.1.135
   APP_PORT=3001
   ```

   `APP_BIND_IP` must belong to the VM running Docker. Nginx's address
   (`192.168.1.82`) belongs to the separate LXC. A loopback binding such as
   `127.0.0.1` is reachable only within the Docker VM. Remove the obsolete
   `PROXY_NETWORK` setting if you used the earlier deployment template.
   If the Proxmox/network firewall filters this traffic, allow TCP connections
   from `192.168.1.82` to `192.168.1.135:3001`. Binding the private address selects
   the listening interface; use the firewall to restrict which LAN hosts can
   connect. PostgreSQL has no published port in this production stack.

4. Keep the existing project and volume settings when upgrading the running
   `bloodbank-app-1` / `bloodbank-db-1` stack:

   ```dotenv
   COMPOSE_PROJECT_NAME=bloodbank
   APP_IMAGE=bloodbank-app
   POSTGRES_VOLUME_NAME=bloodbank_bloodbank_data
   ```

   Verify the volume before deploying:

   ```sh
   docker inspect bloodbank-db-1 --format '{{json .Mounts}}'
   ```

   Use the actual named volume mounted at `/var/lib/postgresql/data` and reuse
   the existing database password. Read the existing-data section below if the
   storage or database setup differs. For an entirely new installation, choose
   a new stable volume name and retain it on subsequent deployments.

5. Deploy from the repository root:

   ```sh
   bash ./deploy-prod.sh
   ```

   This builds the production image, waits for PostgreSQL, applies pending
   migrations through the image's existing startup command, creates the
   administrator if missing, and waits for both containers to be healthy.
   Pending migrations run on app startup; there is no separate `--migrate`
   option. Health checks call `/api/health`, which also records audit events.

6. Follow [the Nginx instructions](nginx/README.md) inside the LXC at
   `192.168.1.82`. Its upstream is `http://192.168.1.135:3001`. Use the same public
   DNS/router entry point as the other domains served by this Nginx LXC.
   Once DNS and HTTPS are configured, verify:

   ```sh
   curl --fail --show-error https://bloodbank.proida.dev/api/health
   ```

   Expect `{"status":"ok"}`. Open `https://bloodbank.proida.dev` and sign in
   with the administrator credentials in `.env.production`. Use the administrator
   account to create the other application roles.

## Existing data

The example matches the existing regular Compose project (`bloodbank`), service
names (`app` and `db`), image (`bloodbank-app`) and default volume
(`bloodbank_bloodbank_data`). With those settings, the production Compose file
updates the existing services and retains their database storage. Running the
regular Compose command originally was valid; its localhost-only binding is
what prevented the separate Nginx LXC from reaching the app.

Keep the project and volume names unchanged when switching configurations.
Creating a different project with a different volume creates another database;
it does not transfer the existing data. A separately started `docker run`
container also requires an explicit storage migration.

To reuse data, first identify the existing PostgreSQL version, storage mount,
database/user names and credentials, and take a database backup. This file
expects PostgreSQL 17 with database and user named `bloodbank`. Set
`POSTGRES_VOLUME_NAME` to the actual existing named volume only if those settings
match. If you intentionally move the volume to a different Compose project,
stop the old application and database before starting the new database service;
two PostgreSQL containers must never use the same data directory simultaneously.
Bind mounts or another database layout need an explicit storage change or
backup/restore first.

`POSTGRES_PASSWORD` must match the database's existing password. Changing the
variable does not change an initialized database's credentials. Likewise,
`ADMIN_PASSWORD` only initializes a missing username; it does not change an
existing account's password. Turning demo mode off does not remove accounts
that were already created. Review those accounts when reusing a demo database.

Normal deployment uses `compose up` and preserves the named volume. Keep backups
before upgrades and do not remove the volume when stopping or replacing the app.

## Subsequent deployments and existing images

```sh
# Build the checked-out source and deploy.
bash ./deploy-prod.sh

# Use an image already available on this server (set APP_IMAGE to its tag).
bash ./deploy-prod.sh --no-build

# Pull APP_IMAGE from its registry and deploy it without a local build.
bash ./deploy-prod.sh --pull

# Use another env file, or allow more time for startup on a slower server.
bash ./deploy-prod.sh --env-file /srv/bloodbank/production.env --timeout 300
```

For registry images, set `APP_IMAGE` to the full image reference and authenticate
with its registry if needed. Use a specific release tag to choose the deployed
version. With `--no-build`, Compose may pull the configured image if it is absent
locally; it will not rebuild it. All image modes use the same database volume.

Nginx targets the VM's stable published address, so app container replacement
does not require an Nginx reload. Updates can briefly interrupt requests. The
script prints the published address and reports container health separately
from public DNS, certificates and connectivity from the Nginx LXC.

Inspect the production services with the same file and env configuration:

```sh
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs --tail 100 app db
```

Compose gives exported shell variables precedence over the env file. Check for
old exported values if the resolved settings differ from `.env.production`.
The script validates configuration without printing credentials.

References: [Compose deployment and health waiting](https://docs.docker.com/reference/cli/docker/compose/up/),
[environment settings](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/),
[persistent volumes](https://docs.docker.com/reference/compose-file/volumes/),
[private address port publishing](https://docs.docker.com/engine/network/port-publishing/).
