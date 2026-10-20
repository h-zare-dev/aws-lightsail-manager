# AWS Lightsail Manager — Telegram Bot

A self-hosted, **private-admin** Telegram bot to manage multiple AWS Lightsail accounts and regions. Built with Node.js 22, TypeScript, [grammY](https://grammy.dev/) and the AWS SDK for JavaScript v3.

> **Safety status:** Development MVP. No AWS resources are touched by installation or tests. Live operations run **only** after the administrator requests them and confirms the 2-minute button. Verify using a disposable AWS account before production use. AWS calls can incur charges. Never send access keys to the bot/chat or commit them to GitHub.

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

## Setup (Linux)

1. Create a new Telegram bot using [@BotFather](https://t.me/BotFather), then get your numeric Telegram user ID from a trusted local method. Keep the bot **private**.
2. Set up an IAM identity **per AWS account** with appropriately restricted Lightsail permissions. For basic instances you can start with a scoped IAM policy. **Never use root access keys.** Consider roles/short-lived credentials if your environment supports them. See [AWS IAM for Lightsail](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-managing-access-for-an-iam-user.html).
3. Install Node.js 22+ and configure AWS profiles locally using the AWS CLI (`aws configure --profile lightsail-personal`) for each account. The bot reads the standard `~/.aws/credentials` file from the **machine hosting the bot**. You must provide **Access Key ID + Secret Access Key** for an IAM user when creating a static-credential profile; a single standalone API key is not enough.
4. Configure and launch:

```bash
git clone https://github.com/h-zare-dev/aws-lightsail-manager.git
cd aws-lightsail-manager
cp .env.example .env
cp config/accounts.example.json config/accounts.json
# Edit .env with bot token and your numeric Telegram admin IDs.
# Edit config/accounts.json with AWS profile names and allowed regions.
npm install
npm run check
npm run build
npm start
```

> Until this feature branch is merged, clone then `git checkout feature/telegram-multi-account-mvp` before step 4.

Example `~/.aws/credentials` (not part of the repository):

```ini
[lightsail-personal]
aws_access_key_id = YOUR_ACCESS_KEY_ID
aws_secret_access_key = YOUR_SECRET_ACCESS_KEY

[lightsail-business]
aws_access_key_id = OTHER_ACCESS_KEY_ID
aws_secret_access_key = OTHER_SECRET_ACCESS_KEY
```

Use file permissions `chmod 600 ~/.aws/credentials .env config/accounts.json` where appropriate; keep these out of all repository commits. The bot never accepts credentials over Telegram.

## Docker Compose alternative

After creating `.env`, `config/accounts.json`, and AWS credential profiles as above, run:

```bash
docker compose up -d --build
docker compose logs -f lightsail-bot
```

Your host's `~/.aws/` directory is mounted **read-only**. Ensure the account running Docker has the credentials configured and the files are readable by the container's Node user (UID 1000). The container itself runs as a non-root user with a read-only filesystem. Do not expose the Telegram bot token via public logs.

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

CI (GitHub Actions) runs tests, typecheck and build. Unit tests do not call AWS. Integration tests are not included in the MVP and must be run only against expendable Lightsail instances with explicit approval.

## AWS documentation

- [Lightsail API/CLI commands](https://docs.aws.amazon.com/cli/latest/reference/lightsail/)
- [Lightsail IAM users](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-managing-access-for-an-iam-user.html)
- [Launch from instance snapshot](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-how-to-create-instance-from-snapshot.html)
