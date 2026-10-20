import { Bot, InlineKeyboard, type Context } from 'grammy';
import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig, type Account } from './config.js';
import { LightsailService } from './aws.js';
import { Confirmations } from './confirm.js';
import { checkAlias, checkRegion, checkName, checkZone, makePortInfo, checkScriptName } from './policy.mjs';

const config = loadConfig();
const bot = new Bot(config.token);
const aws = new LightsailService();
const confirms = new Confirmations();
type Choice = { account: Account; region: string };
const selections = new Map<number, Choice>();

// The bot does NOT support group chats; membership and access are checked on all updates.
bot.use(async (ctx, next) => {
  if (!ctx.from || !config.admins.has(ctx.from.id) || ctx.chat?.type !== 'private') {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({text:'Access denied'}).catch(() => {});
    return;
  }
  await next();
});

function choice(ctx: Context): Choice {
  const id = ctx.from!.id;
  let found = selections.get(id);
  if (!found) {
    const account = config.accounts[0]!;
    found = { account, region: account.regions[0]! };
    selections.set(id, found);
  }
  return found;
}
function args(ctx: Context, count: number, usage: string): string[] {
  const vals = (typeof ctx.match === 'string' ? ctx.match : '').trim().split(/\s+/).filter(Boolean);
  if (vals.length !== count) throw new Error(`Usage: ${usage}`);
  return vals;
}
function replySafe(ctx: Context, message: string) {
  // Telegram's text cap is 4096 UTF-16 code units; remain below the cap.
  const lines = message.split('\n');
  const chunks: string[] = [];
  let chunk = '';
  for (const line of lines) {
    if ((chunk + line).length > 3300) {
      if (chunk) chunks.push(chunk);
      chunk = '';
    }
    if (line.length > 3300) {
      for (let i = 0; i < line.length; i += 3300) chunks.push(line.slice(i, i + 3300));
    } else chunk += line + '\n';
  }
  if (chunk) chunks.push(chunk);
  return (async () => { for (const text of (chunks.length ? chunks : ['(empty)'])) await ctx.reply(text); })();
}
function details(choice: Choice) { return `${choice.account.alias} / ${choice.region}`; }
function fmtError(error: unknown) {
  const err = error as {name?: string; code?: string};
  if (err?.name && /^\w+(Exception|Error)$/.test(err.name)) return `AWS/operation error: ${err.name}. Check IAM permissions, region and resource names.`;
  return error instanceof Error ? error.message.slice(0, 500) : 'Unknown error.';
}
async function guarded(ctx: Context, fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) { await ctx.reply(`⚠️ ${fmtError(e)}`); }
}
async function ask(ctx: Context, summary: string, action: () => Promise<unknown>) {
  const key = confirms.create({
    userId: ctx.from!.id, chatId: ctx.chat!.id, summary,
    action: async () => {
      await action();
      return `✅ AWS accepted request: ${summary}\nCheck the AWS console for completion; operations can be asynchronous.`;
    }
  });
  const kb = new InlineKeyboard().text('✅ Confirm', `confirm:${key}`).text('✖ Cancel', `cancel:${key}`);
  await ctx.reply(`⚠️ Confirm operation (expires in 2 minutes):\n${summary}\n\nThis may incur costs or change live connectivity.`, { reply_markup: kb });
}

bot.callbackQuery(/^confirm:([a-f0-9]{36})$/, async ctx => {
  const token = ctx.match[1]!;
  const item = confirms.take(token, ctx.from.id, ctx.chat!.id);
  await ctx.answerCallbackQuery();
  if (!item) { await ctx.reply('Expired, already used, or unauthorized. Run the command again.'); return; }
  await guarded(ctx, async () => ctx.reply(await item.action()));
});
bot.callbackQuery(/^cancel:([a-f0-9]{36})$/, async ctx => {
  const ok = confirms.cancel(ctx.match[1]!, ctx.from.id, ctx.chat!.id);
  await ctx.answerCallbackQuery({text: ok ? 'Cancelled' : 'Already expired'});
});

const help = `🔧 AWS Lightsail Telegram Bot
All actions use the selected AWS account and region. No AWS secrets travel through Telegram.

Navigation:
/accounts  /account ALIAS  /region REGION  /regions
/servers  /server NAME  /plans  /images

Servers:
/create NAME ZONE BLUEPRINT BUNDLE
/create_script NAME ZONE BLUEPRINT BUNDLE FILE.sh
/start NAME  /stop NAME  /reboot NAME
/delete NAME DELETE

Snapshots:
/snapshots
/snapshot INSTANCE SNAPSHOT_NAME
/restore SNAPSHOT NEW_NAME ZONE BUNDLE
/snapshot_delete SNAPSHOT_NAME DELETE

Firewall:
/firewall INSTANCE
/open INSTANCE tcp|udp FROM_PORT TO_PORT CIDR
/close INSTANCE tcp|udp FROM_PORT TO_PORT CIDR
/clone_rules SOURCE_INSTANCE TARGET_INSTANCE

Static IPv4:
/static_ips  /reserve_ip NAME
/attach_ip STATIC_IP_NAME INSTANCE
/detach_ip STATIC_IP_NAME
/release_ip NAME RELEASE

/help  /menu

Every write requires a timed confirmation button. Names must contain no spaces. IPv4/IPv6 CIDR is supported. User-data scripts must be on the host in scripts/ (never Telegram uploads).

Note: a new instance restored from a snapshot has DEFAULT firewall rules, not custom ones. Run /clone_rules after restoration, reviewing the source first.`;

bot.command(['start','help'], ctx => guarded(ctx, async () => {
  const selected = choice(ctx);
  await replySafe(ctx, `Current: ${details(selected)}\n\n${help}`);
}));
bot.command('menu', ctx => guarded(ctx, async () => {
  const kb = new InlineKeyboard()
    .text('🖥 Servers','menu:servers').text('📸 Snapshots','menu:snapshots').row()
    .text('🔥 Firewall help','menu:firewall').text('🌐 Static IPs','menu:staticips').row()
    .text('👤 Accounts','menu:accounts').text('❔ Help','menu:help');
  await ctx.reply(`Lightsail: ${details(choice(ctx))}`, {reply_markup:kb});
}));
bot.callbackQuery(/^menu:(servers|snapshots|firewall|staticips|accounts|help)$/, ctx => guarded(ctx, async () => {
  await ctx.answerCallbackQuery();
  const mode = ctx.match[1];
  const sel = choice(ctx);
  if (mode === 'help') return replySafe(ctx, help);
  if (mode === 'firewall') return ctx.reply('/firewall INSTANCE\n/open INSTANCE tcp 1000 60000 0.0.0.0/0\n/clone_rules SOURCE TARGET');
  if (mode === 'accounts') return ctx.reply(config.accounts.map(a => `${a.alias}: ${a.regions.join(', ')}`).join('\n'));
  if (mode === 'servers') return replySafe(ctx, (await aws.instances(sel.account,sel.region)).map(x => `${x.name} | ${x.state?.name} | Public ${x.publicIpAddress || '-'} | Private ${x.privateIpAddress || '-'}`).join('\n') || 'No instances.');
  if (mode === 'snapshots') return replySafe(ctx, (await aws.snapshots(sel.account,sel.region)).map(s => `${s.name} | ${s.state} | ${s.fromInstanceName}`).join('\n') || 'No snapshots.');
  return replySafe(ctx, (await aws.staticIps(sel.account,sel.region)).map(x => `${x.name}: ${x.ipAddress} → ${x.attachedTo || 'unattached'}`).join('\n') || 'No static IPs.');
}));

bot.command('accounts', ctx => guarded(ctx, async () => {
  const selected = choice(ctx);
  await ctx.reply(config.accounts.map(a => `${a.alias === selected.account.alias ? '✓ ' : ''}${a.alias}: ${a.regions.join(', ')}`).join('\n') + '\nSelect: /account ALIAS');
}));
bot.command('account', ctx => guarded(ctx, async () => {
  const [rawAlias] = args(ctx,1,'/account ALIAS');
  const alias = checkAlias(rawAlias);
  const account = config.accounts.find(x => x.alias === alias);
  if (!account) throw new Error('Unknown account alias. See /accounts.');
  selections.set(ctx.from!.id,{account, region:account.regions[0]!});
  await ctx.reply(`Selected: ${details(choice(ctx))}`);
}));
bot.command('region', ctx => guarded(ctx, async () => {
  const [rawRegion] = args(ctx,1,'/region eu-central-1');
  const region = checkRegion(rawRegion);
  const c = choice(ctx);
  if (!c.account.regions.includes(region)) throw new Error(`Not in allowlisted regions: ${c.account.regions.join(', ')}`);
  selections.set(ctx.from!.id, {account:c.account,region});
  await ctx.reply(`Selected: ${details(choice(ctx))}`);
}));
bot.command('regions', ctx => guarded(ctx, async () => {
  const c = choice(ctx);
  const list = await aws.regions(c.account,c.region);
  await replySafe(ctx, `Allowed regions: ${c.account.regions.join(', ')}\n\nAWS regions:\n` + list.map(x => `${x.name}: ${(x.availabilityZones??[]).map(z=>z.zoneName).join(', ')}`).join('\n'));
}));
bot.command('servers', ctx => guarded(ctx, async () => {
  const c=choice(ctx);
  const all=await aws.instances(c.account,c.region);
  await replySafe(ctx, `${details(c)}\n` + (all.map(x=>`${x.name} [${x.state?.name ?? '?'}]\n  Public: ${x.publicIpAddress ?? '-'} | Private: ${x.privateIpAddress ?? '-'}\n  ${x.blueprintId ?? '?'} / ${x.bundleId ?? '?'}`).join('\n') || 'No servers.'));
}));
bot.command('server', ctx => guarded(ctx, async () => {
  const [name] = args(ctx,1,'/server INSTANCE'); checkName(name);
  const c=choice(ctx); const x=await aws.getInstance(c.account,c.region,name);
  if (!x) throw new Error('Instance not found.');
  await ctx.reply(`${details(c)}\n${x.name}\nStatus: ${x.state?.name}\nPublic IPv4: ${x.publicIpAddress || '-'}\nPrivate IPv4: ${x.privateIpAddress || '-'}\nZone: ${x.location?.availabilityZone || '-'}\nImage: ${x.blueprintId}\nBundle: ${x.bundleId}`);
}));
bot.command('plans', ctx => guarded(ctx, async () => {
  const c=choice(ctx); const arr=await aws.bundles(c.account,c.region);
  await replySafe(ctx, arr.map(x=>`${x.bundleId} | RAM ${x.ramSizeInGb}GB | ${x.cpuCount} CPUs | $${x.price}/mo`).join('\n') || 'No bundles.');
}));
bot.command('images', ctx => guarded(ctx, async () => {
  const c=choice(ctx); const arr=await aws.blueprints(c.account,c.region);
  await replySafe(ctx, arr.map(x=>`${x.blueprintId} | ${x.name}`).join('\n') || 'No blueprints.');
}));

bot.command('create', ctx => guarded(ctx, async () => {
  const [rawName,rawZone,rawImage,rawBundle] = args(ctx,4,'/create NAME eu-central-1a IMAGE_ID BUNDLE_ID');
  const c=choice(ctx); const name=checkName(rawName); const zone=checkZone(rawZone,c.region);
  const image=checkName(rawImage), bundle=checkName(rawBundle);
  await ask(ctx,`CREATE ${name} on ${details(c)} (${zone}, ${image}, ${bundle})`,()=>aws.create(c.account,c.region,name,zone,image,bundle));
}));
bot.command('create_script', ctx => guarded(ctx, async () => {
  const [rawName,rawZone,rawImage,rawBundle,rawScript] = args(ctx,5,'/create_script NAME eu-central-1a IMAGE_ID BUNDLE_ID FILE.sh');
  const c=choice(ctx), name=checkName(rawName), zone=checkZone(rawZone,c.region);
  const image=checkName(rawImage),bundle=checkName(rawBundle),scriptName=checkScriptName(rawScript);
  const path=join(config.scriptsDir,scriptName);
  const stat=await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw new Error('Script must be a real regular file <=16 KiB, not a symlink.');
  const script=await readFile(path,'utf8');
  if (!script.trim()) throw new Error('Script is empty.');
  await ask(ctx,`CREATE ${name} with user-data ${scriptName} on ${details(c)} (${zone}, ${image}, ${bundle}). Script will run as root during first boot.`,()=>aws.create(c.account,c.region,name,zone,image,bundle,script));
}));
for (const action of ['start','stop','reboot','delete'] as const) {
  bot.command(action, ctx => guarded(ctx, async () => {
    const values = args(ctx, action==='delete'?2:1,action==='delete'?'/delete NAME DELETE':`/${action} NAME`);
    const name = checkName(values[0]);
    if (action==='delete' && values[1]!=='DELETE') throw new Error('To delete: /delete NAME DELETE');
    const c=choice(ctx);
    await ask(ctx,`${action.toUpperCase()} instance ${name} (${details(c)})${action==='delete'?' — IRREVERSIBLE. Make manual backups first!':''}`,()=>aws.power(c.account,c.region,name,action));
  }));
}

bot.command('snapshots', ctx => guarded(ctx, async () => {
  const c=choice(ctx), list=await aws.snapshots(c.account,c.region);
  await replySafe(ctx, `${details(c)}\n`+(list.map(s=>`${s.name} | ${s.state} | source: ${s.fromInstanceName} | original bundle: ${s.fromBundleId}`).join('\n') || 'No manual snapshots.'));
}));
bot.command('snapshot', ctx => guarded(ctx, async () => {
  const [rawInstance,rawSnapshot]=args(ctx,2,'/snapshot INSTANCE SNAPSHOT_NAME');
  const instance=checkName(rawInstance),snapshot=checkName(rawSnapshot),c=choice(ctx);
  await ask(ctx,`CREATE SNAPSHOT ${snapshot} of ${instance} (${details(c)})`,()=>aws.snapshotCreate(c.account,c.region,instance,snapshot));
}));
bot.command('restore', ctx => guarded(ctx, async () => {
  const [rawSnapshot,rawName,rawZone,rawBundle]=args(ctx,4,'/restore SNAPSHOT NEW_NAME eu-central-1a BUNDLE_ID');
  const c=choice(ctx), snapshot=checkName(rawSnapshot),name=checkName(rawName),zone=checkZone(rawZone,c.region),bundle=checkName(rawBundle);
  await ask(ctx,`RESTORE snapshot ${snapshot} into NEW instance ${name} (${details(c)}, ${zone}, ${bundle}). Custom firewall rules WILL NOT be copied.`,()=>aws.restore(c.account,c.region,snapshot,name,zone,bundle));
}));
bot.command('snapshot_delete', ctx => guarded(ctx, async () => {
  const [rawName,verify]=args(ctx,2,'/snapshot_delete NAME DELETE');
  if (verify!=='DELETE') throw new Error('Explicit DELETE is required.');
  const name=checkName(rawName),c=choice(ctx);
  await ask(ctx,`PERMANENTLY DELETE snapshot ${name} (${details(c)})`,()=>aws.snapshotDelete(c.account,c.region,name));
}));

bot.command('firewall', ctx => guarded(ctx, async () => {
  const [rawInstance]=args(ctx,1,'/firewall INSTANCE'); const instance=checkName(rawInstance),c=choice(ctx);
  const list=await aws.firewall(c.account,c.region,instance);
  await replySafe(ctx, `${details(c)} / ${instance}\n`+(list.map(x=>`${x.protocol} ${x.fromPort}-${x.toPort} | IPv4: ${(x.cidrs??[]).join(',')||'-'} | IPv6: ${(x.ipv6Cidrs??[]).join(',')||'-'} | Aliases: ${(x.cidrListAliases??[]).join(',')||'-'} | ${x.state??''}`).join('\n')||'No rules.'));
}));
for (const change of ['open','close'] as const) {
  bot.command(change, ctx => guarded(ctx, async () => {
    const [rawInstance,protocol,from,to,cidr]=args(ctx,5,`/${change} INSTANCE tcp|udp FROM TO CIDR`);
    const instance=checkName(rawInstance),rule=makePortInfo(protocol,from,to,cidr),c=choice(ctx);
    const broad = cidr === '0.0.0.0/0' || cidr === '::/0' ? ' — EXPOSES PORT(S) TO THE WHOLE INTERNET' : '';
    await ask(ctx,`${change.toUpperCase()} ${protocol} ${from}-${to} source ${cidr} on ${instance} (${details(c)})${change==='open'?broad:''}`,()=>aws.firewallChange(c.account,c.region,instance,change,rule));
  }));
}
bot.command('clone_rules', ctx => guarded(ctx, async () => {
  const [rawSource,rawTarget]=args(ctx,2,'/clone_rules SOURCE_INSTANCE TARGET_INSTANCE');
  const source=checkName(rawSource),target=checkName(rawTarget),c=choice(ctx);
  if (source===target) throw new Error('Source and target must be different.');
  const rules=await aws.firewall(c.account,c.region,source);
  if (!rules.length) throw new Error('No source firewall rules; operation blocked.');
  await ask(ctx,`REPLACE ALL FIREWALL RULES on ${target} with ${rules.length} rule(s) from ${source} (${details(c)}). Warning: could block SSH if source rules are wrong!`,()=>aws.cloneFirewall(c.account,c.region,source,target));
}));

bot.command('static_ips', ctx => guarded(ctx, async () => {
  const c=choice(ctx),ips=await aws.staticIps(c.account,c.region);
  await replySafe(ctx, `${details(c)}\n`+(ips.map(x=>`${x.name} | ${x.ipAddress} | attached to: ${x.attachedTo??'(none)'}`).join('\n')||'No reserved static IPs.'));
}));
bot.command('reserve_ip', ctx => guarded(ctx, async () => {
  const [rawName]=args(ctx,1,'/reserve_ip NAME'); const name=checkName(rawName),c=choice(ctx);
  await ask(ctx,`RESERVE static IPv4 ${name} (${details(c)}) — unattached addresses may incur charges`,()=>aws.reserveIp(c.account,c.region,name));
}));
bot.command('attach_ip', ctx => guarded(ctx, async () => {
  const [rawIp,rawInstance]=args(ctx,2,'/attach_ip STATIC_IP_NAME INSTANCE'); const ip=checkName(rawIp),name=checkName(rawInstance),c=choice(ctx);
  await ask(ctx,`ATTACH ${ip} to instance ${name} (${details(c)}) — changes public IP routing`,()=>aws.attachIp(c.account,c.region,ip,name));
}));
bot.command('detach_ip', ctx => guarded(ctx, async () => {
  const [rawIp]=args(ctx,1,'/detach_ip STATIC_IP_NAME'); const ip=checkName(rawIp),c=choice(ctx);
  await ask(ctx,`DETACH ${ip} (${details(c)}) — live connections may break`,()=>aws.detachIp(c.account,c.region,ip));
}));
bot.command('release_ip', ctx => guarded(ctx, async () => {
  const [rawIp,confirm]=args(ctx,2,'/release_ip NAME RELEASE');
  if (confirm!=='RELEASE') throw new Error('Explicit RELEASE required.');
  const ip=checkName(rawIp),c=choice(ctx);
  await ask(ctx,`PERMANENTLY RELEASE static IPv4 ${ip} (${details(c)})`,()=>aws.releaseIp(c.account,c.region,ip));
}));

bot.catch(({error,ctx}) => {
  // Avoid printing user messages or the AWS SDK config, since they may contain sensitive data.
  console.error(`[bot] update=${ctx.update.update_id}, error=${error instanceof Error?error.name:'unknown'}`);
});

await bot.api.setMyCommands([
  {command:'menu',description:'Show management menu'},
  {command:'help',description:'All commands and safety notes'},
  {command:'accounts',description:'List configured AWS accounts'},
  {command:'servers',description:'List instances in selected region'},
  {command:'snapshots',description:'List manual snapshots'},
  {command:'static_ips',description:'List static IPv4 addresses'},
]);
console.info('Lightsail bot launching with long polling.');
process.once('SIGINT',()=>bot.stop());
process.once('SIGTERM',()=>bot.stop());
await bot.start({ drop_pending_updates: true });
