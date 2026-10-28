# Production deployment

Run these commands on the Linux server hosting Docker and the existing Nginx
container. This setup deploys the app and PostgreSQL. Nginx continues to manage
the public domain, HTTPS and the server's ports 80/443.

| File                                     | Purpose                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `deploy-prod.sh`                         | Validates settings, deploys containers and waits for health checks.        |
| `compose.production.yaml`                | Standalone production stack with persistent storage and the Nginx network. |
| `.env.production`                        | Your server settings and credentials, excluded from Git.                   |
| `.env.production.example`                | Template for the production settings.                                      |
| `deploy/nginx/bloodbank.proida.dev.conf` | Virtual host to add to the existing Nginx configuration.                   |

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

3. Set `PROXY_NETWORK` to the existing user-defined network attached to Nginx.
   Find its name with:

   ```sh
   docker inspect YOUR_NGINX_CONTAINER --format '{{json .NetworkSettings.Networks}}'
   ```

   If Nginx has no user-defined network, create one and connect it once:

   ```sh
   docker network create proxy
   docker network connect proxy YOUR_NGINX_CONTAINER
   ```

   Then set `PROXY_NETWORK=proxy`. Also record this network attachment in the
   existing Nginx deployment settings so it survives Nginx container replacement.
   The app's network membership and `bloodbank` alias are managed by the
   production Compose file on every deployment. PostgreSQL joins only the
   private database network. Neither app nor database publishes a host port.

4. Choose a stable `POSTGRES_VOLUME_NAME` and keep it unchanged on later
   deployments. The example creates `bloodbank-prod-data` for a new database.
   If the server already contains application data, read the next section
   before starting the stack.

5. Deploy from the repository root:

   ```sh
   bash ./deploy-prod.sh
   ```

   This builds the production image, waits for PostgreSQL, applies pending
   migrations through the image's existing startup command, creates the
   administrator if missing, and waits for both containers to be healthy.
   Pending migrations run on app startup; there is no separate `--migrate`
   option. Health checks call `/api/health`, which also records audit events.

6. Follow [the Nginx instructions](nginx/README.md) to add the domain, certificate
   paths and configuration to the existing Nginx container. Point the DNS record
   for `bloodbank.proida.dev` to this server. The upstream is
   `http://bloodbank:3001`. Once DNS and HTTPS are configured, verify:

   ```sh
   curl --fail --show-error https://bloodbank.proida.dev/api/health
   ```

   Expect `{"status":"ok"}`. Open `https://bloodbank.proida.dev` and sign in
   with the administrator credentials in `.env.production`. Use the administrator
   account to create the other application roles.

## Existing data

This production stack uses a separate project name (`bloodbank-prod` by default)
and a new database volume by default. It does not adopt a previously started
`docker run` container or automatically transfer its data.

To reuse data, first identify the existing PostgreSQL version, storage mount,
database/user names and credentials, and take a database backup. This file
expects PostgreSQL 17 with database and user named `bloodbank`. Set
`POSTGRES_VOLUME_NAME` to the actual existing named volume only if those settings
match. Stop the old application and database before attaching that storage to
the new database service; two PostgreSQL containers must never use the same data
directory simultaneously. Bind mounts or another database layout need an
explicit storage change or backup/restore first.

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

The Nginx template uses Docker DNS to refresh the app container's address after
replacement. Updates can briefly interrupt requests; the script reports container
health separately from public DNS, certificates and Nginx routing.

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
[persistent volumes](https://docs.docker.com/reference/compose-file/volumes/).
