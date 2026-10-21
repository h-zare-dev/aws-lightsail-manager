# AWS Lightsail Manager — Telegram Bot

A self-hosted, **private-admin** Telegram bot to manage multiple AWS Lightsail accounts and regions. Built with Node.js 22, TypeScript, [grammY](https://grammy.dev/) and the AWS SDK for JavaScript v3.

> **Safety status:** Development MVP. No AWS resources are touched by installation or tests. Live operations run **only** after the administrator requests them and confirms the 2-minute button. Verify using a disposable AWS account before production use. AWS calls can incur charges. Never send access keys to the bot/chat or commit them to GitHub.

## Interactive Telegram dashboard (new)

Use `/start` or `/menu` for a button-based management dashboard modeled on a server-control panel, with zero shell commands needed for routine operations. Choose the AWS **account** and **region** in the menu, then tap a server to view its status, location, blueprint, vCPU, RAM, disk capacity, estimated monthly bundle price, public IPv4 (static/dynamic), private IPv4 and IPv6. The `Copy` inline buttons copy addresses to the device clipboard (requires a Telegram client supporting copy-text buttons).

The server card offers **Power ON/OFF, reboot, delete, manual snapshots, firewall and static IP management**. Snapshot lists support restoring to a **new** instance and deleting individual snapshots; the provisioning flow guides you through a server name, zone, OS image and bundle using buttons. Firewall controls display IPv4/IPv6 rules, expose common-port presets and a custom-rule form; static IP screens offer copy, attach, detach, allocate and release. Lists are paginated so long accounts remain usable.

**Safety:** All resource-mutating actions still use the existing 2-minute separate confirmation gate; just opening a screen does not call any mutation API. Callback tokens are opaque, short, scoped to the admin and selected account/region, and expire. No AWS keys are sent through Telegram. Existing advanced slash commands such as `/create_script`, `/clone_rules` and `/close` remain available. For form input, send ordinary text; `/cancel` returns to the menu.

**Lightsail limitations:** There is no general traffic-counter reset or in-place change of an instance's private IPv4; restoring a snapshot does not copy custom Lightsail firewall rules. The interface does not implement a web SSH console, in-place OS rebuild or replacement of a running server's boot image. These require separately reviewed workflows. The menu offers only the operations supported and implemented by this bot.

## What works

- Multiple AWS account aliases backed by locally stored AWS credential **profiles**; independent permitted region lists; `/account`, `/region` selection.
- List instances and details (including public/private IP), AWS regions/zones, available bundles and blueprints.
- Create, start, stop, reboot and delete instances.
- Launch with reviewed startup shell script (Lightsail `userData` from an approved local `scripts/` directory).
- Create/list/delete manual instance snapshots and launch a **new** instance from a snapshot.
- Show/open/close instance firewall ports, and copy the **entire** set of open firewall rules to a new instance.
- Reserve/list/attach/detach/release static IPv4 addresses.
- Private Telegram-only; exact numeric Telegram admin IDs; 2-minute, per-admin, one-time confirmations on **every** write, including creation, deletions and firewall updates.

Out of scope for the MVP: disks, networking peering, DNS, load balancers, container services, relational databases, bucket management, automatic snapshot lifecycle, backups of AWS rules, analytics, and cross-account firewall replication. It does **not** modify an existing instance's AWS private IP.

## Production deployment: prebuilt Docker image (no Node.js on server)

**On every push/merge to `main`**, GitHub Actions runs unit tests, TypeScript typecheck, builds a Linux amd64/arm64 Docker image, and publishes it to the [GitHub Container Registry](https://github.com/h-zare-dev?tab=packages) as:

```text
ghcr.io/h-zare-dev/aws-lightsail-manager:latest
```

Tags `v*` publish their own versioned images. Pull requests only build and test the image; they do not publish it. The image includes Node.js and all application dependencies, so the deployment server needs **only Docker Engine, Docker Compose plugin, and curl**. The root `compose.yaml` remains for **local development only**; the deployment manifest is `deploy/compose.yaml` and uses `image:`, not `build:`.

### First-time setup (server)

1. Create a Telegram bot with [@BotFather](https://t.me/BotFather) and find your **numeric** Telegram ID. Create narrowly scoped IAM credentials for each AWS account (not root credentials). Do not send any secrets to Telegram or commit them to GitHub.
2. On your Docker server run this command once (review the installer first if desired):

```bash
curl -fsSL https://raw.githubusercontent.com/h-zare-dev/aws-lightsail-manager/main/deploy/install.sh -o /tmp/lightsail-install.sh && sudo bash /tmp/lightsail-install.sh
```

The installer creates `/opt/aws-lightsail-manager/`, downloads the Compose and example config files, and **does not start** the container. It preserves existing credentials/configuration on subsequent runs. The container runs as UID 1000; the installer sets `config/accounts.json` and `aws/credentials` ownership to UID 1000 with permissions `0600`. On shared hosts, ensure UID 1000 is trusted or choose a more isolated deployment host.

3. Edit the following **local files on the server** (never push to GitHub):

- `/opt/aws-lightsail-manager/.env`: set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_IDS` (numeric, comma-separated); optionally set `IMAGE_TAG=latest`.
- `/opt/aws-lightsail-manager/config/accounts.json`: give each AWS account an alias, corresponding local credential profile name and permitted regions.
- `/opt/aws-lightsail-manager/aws/credentials`: standard AWS shared credentials file containing each corresponding profile.
- `/opt/aws-lightsail-manager/scripts/`: approved `.sh` user-data scripts. These are mounted read-only and run **on a new AWS instance as root**, only when requested with `/create_script`.

Example AWS credential file (fictitious placeholders):

```ini
[lightsail-personal]
aws_access_key_id = YOUR_ACCESS_KEY_ID
aws_secret_access_key = YOUR_SECRET_ACCESS_KEY

[lightsail-business]
aws_access_key_id = OTHER_ACCESS_KEY_ID
aws_secret_access_key = OTHER_SECRET_ACCESS_KEY
```

Ensure `config/accounts.json` profile names match these sections. **Do not use the AWS account's root access keys.** The image is configured to read this mounted file, not an AWS CLI installation.

4. Start the container by pulling the published image:

```bash
cd /opt/aws-lightsail-manager
sudo docker compose pull && sudo docker compose up -d --force-recreate
sudo docker compose ps
```

### Upgrade after any new successful main-branch image release

```bash
cd /opt/aws-lightsail-manager && sudo docker compose pull && sudo docker compose up -d --force-recreate
```

The image is downloaded and the bot container is replaced. Your AWS credentials and config **remain on the host**. No Node.js, npm or `git pull` is required. To inspect logs, run `sudo docker compose logs --tail=100 -f lightsail-bot`. To pin a release use `IMAGE_TAG=v1.2.3` in the server-side `.env` once that tag has been published. `latest` changes whenever `main` is pushed and the image-publishing workflow succeeds.

**First publication may be private:** GitHub's container registry defaults new packages to private, even for a public repository. To pull anonymously, change the package visibility to Public in GitHub's Packages settings **after** the first successful release; this is a manual choice and exposes the image contents, not the runtime credentials. Otherwise authenticate once on the server using a GitHub PAT (classic) with `read:packages`:

```bash
# Run the interactive login and paste a read:packages token when prompted.
sudo docker login ghcr.io -u YOUR_GITHUB_USERNAME
```

Avoid placing the token in shell history or plaintext scripts. The GitHub Actions publisher uses `GITHUB_TOKEN` automatically; no publishing PAT is needed. If `docker compose pull` returns `unauthorized`, verify package visibility or your registry login. The app needs outbound HTTPS access to the Telegram Bot API and AWS; **no inbound ports** need to be published by Docker.

## Local development (optional)

Install Node.js 22+ on a development machine (never required on the deployment host), configure `config/accounts.json` and `~/.aws/credentials`, and then run:

```bash
npm install
npm run check
npm run build
npm start
```

For a **local Docker build only**, the root `compose.yaml` accepts `docker compose up -d --build`. This is intentionally different from the production prebuilt-image deployment.

## Commands

Send `/start` or `/help` for the complete live command list. Examples:

```text
/account personal
/region eu-central-1
/servers
/server DE01
/plans
/images
/regions
/snapshot DE01 DE01-backup-2026
/restore DE01-backup-2026 DE01-New eu-central-1a small_3_0
/firewall DE01
/open DE01 tcp 1000 60000 0.0.0.0/0
/clone_rules DE01 DE01-New
/create DE02 eu-central-1a ubuntu_24_04 small_3_0
/create_script DE03 eu-central-1a ubuntu_24_04 small_3_0 bootstrap-example.sh
/delete DE03 DELETE
```

`/create` and `/restore` require valid AWS blueprint, bundle and zone identifiers. Query `/plans`, `/images` and `/regions` first; the above values are illustrative and may be unavailable. Actions are scoped to the current account and region **at the time you request confirmation**. To modify IPv6 rules, pass e.g. `::/0` to `/open` or `/close`. Do **not** open a range such as 1000–60000 to the entire Internet unless absolutely necessary.

**Critical snapshot detail:** Creating a new Lightsail instance from a snapshot does **not** restore the instance's customized Lightsail firewall rules. `/clone_rules SOURCE TARGET` calls `PutInstancePublicPorts`, replacing **all** the target rules with the source's open rules. Review both firewalls first; the operation may cut off SSH. Also reassign any static public IP explicitly.

**Cloud-init warning:** `/create_script` runs the selected trusted script as root on the new instance (usually only at first boot). Only place reviewed scripts in `scripts/`, and secure that directory against untrusted modifications. The sample script installs basic packages; adjust before real use.

## Security and limits

- Only `TELEGRAM_ADMIN_IDS` and **private-chat** interactions are accepted; usernames are never authorization factors.
- Pending confirmations are stored in memory, single-use, expire after 2 minutes, and disappear on restart. All writes ask for confirmation, but Telegram messages are not end-to-end encrypted. Do not put secrets into commands or `userData`.
- AWS credentials remain on the host and are not logged or sent to Telegram. Use IAM least privilege; use a separate AWS identity for each account; rotate credentials periodically.
- The account configuration is a local static allowlist, not an in-chat key vault. Accounts are added by editing `accounts.json` and restarting.
- State such as selected account/region is kept in memory; it resets to the configured first account/region after restart.
- Some AWS requests are asynchronous: an accepted API response is **not** a successful completed deployment; verify status in `/servers`, `/snapshots` or AWS console.
- Copy rules only within the selected AWS account and region. Creating or deleting infrastructure may affect billing, backups and live users.

## Development

```bash
npm test       # pure validation tests
npm run check  # tests plus TS typecheck
npm run build  # compiled runtime
npm run dev    # watch mode
```

CI (GitHub Actions) runs tests, typecheck and Docker image build on PRs; on main pushes it also publishes the multi-architecture image to GHCR. Unit tests do not call AWS. Integration tests are not included in the MVP and must be run only against expendable Lightsail instances with explicit approval.

## AWS documentation

- [Lightsail API/CLI commands](https://docs.aws.amazon.com/cli/latest/reference/lightsail/)
- [Lightsail IAM users](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-managing-access-for-an-iam-user.html)
- [Launch from instance snapshot](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-how-to-create-instance-from-snapshot.html)