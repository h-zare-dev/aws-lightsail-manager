
import { randomBytes } from 'node:crypto';
import { Bot, InlineKeyboard, type Context } from 'grammy';
import type { Account, Config } from './config.js';
import { checkName, checkZone, makePortInfo } from './policy.mjs';
import { LightsailService } from './aws.js';

type Chosen = { account: Account; region: string };
type Deps = {
 bot: Bot<Context>; aws: LightsailService; config: Config;
 choice: (ctx: Context)=>Chosen;
 select: (id:number,c:Chosen)=>void;
 guarded: (ctx:Context,fn:()=>Promise<unknown>)=>Promise<void>;
 ask: (ctx:Context,summary:string,fn:()=>Promise<unknown>)=>Promise<void>;
};
type Draft = { kind:'create'|'restore'|'ip'|'rule'; step:'name'|'rule'; source?:string; name?:string; zone?:string; blueprint?:string; bundle?:string; expires:number; account:Account; region:string };
const esc=(s:unknown)=>String(s??'—').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const cp=(s:unknown)=>'<code>'+esc(s)+'</code>';
const state=(s?:string)=>s==='running'?'🟢':s==='stopped'?'🔴':'🟡';
const chunk=<T>(a:T[],p:number,n=7)=>({list:a.slice(p*n,(p+1)*n),pages:Math.max(1,Math.ceil(a.length/n))});

export function registerInteractiveUi({bot,aws,config,choice,select,guarded,ask}:Deps) {
 const clicks=new Map<string,{who:number;account:string;region:string;until:number;go:(ctx:Context)=>Promise<unknown>}>();
 const forms=new Map<number,Draft>();
 const current=(ctx:Context)=>choice(ctx);
 const scope=(c:Chosen)=>c.account.alias+' / '+c.region;
 const add=(kb:InlineKeyboard,ctx:Context,c:Chosen,title:string,go:(ctx:Context)=>Promise<unknown>)=>{
   for(const [id,e] of clicks)if(e.until<Date.now())clicks.delete(id);
   if(clicks.size>2000){const first=clicks.keys().next().value;if(first)clicks.delete(first);}
   const id=randomBytes(12).toString('base64url');
   clicks.set(id,{who:ctx.from!.id,account:c.account.alias,region:c.region,until:Date.now()+900_000,go});
   return kb.text(title,'ui:'+id);
 };
 const send=(ctx:Context,text:string,kb:InlineKeyboard)=>ctx.reply(text.slice(0,4000),{parse_mode:'HTML',reply_markup:kb,link_preview_options:{is_disabled:true}});
 const begin=(ctx:Context,kind:Draft['kind'],step:Draft['step'],source?:string)=>{
   const c=current(ctx);
   forms.set(ctx.from!.id,{kind,step,source,account:c.account,region:c.region,expires:Date.now()+300_000});
 };
 const form=(ctx:Context)=>{
   const f=forms.get(ctx.from!.id),c=current(ctx);
   if(!f||f.expires<Date.now()||f.account.alias!==c.account.alias||f.region!==c.region){forms.delete(ctx.from!.id);return undefined;}
   return f;
 };
 async function home(ctx:Context){
   forms.delete(ctx.from!.id);
   const c=current(ctx),k=new InlineKeyboard();
   add(k,ctx,c,'🖥 Servers',x=>servers(x));add(k,ctx,c,'📸 Snapshots',x=>snapshots(x));k.row();
   add(k,ctx,c,'🌐 Static IPs',x=>ips(x));add(k,ctx,c,'➕ New Server',x=>newServer(x));k.row();
   add(k,ctx,c,'👤 Accounts',x=>accounts(x));add(k,ctx,c,'📍 Regions',x=>regions(x));k.row();
   add(k,ctx,c,'❔ Help',x=>help(x));
   await send(ctx,'🛰 <b>LIGHTSAIL MANAGEMENT</b>\n\n👤 Account: <b>'+esc(c.account.alias)+'</b>\n📍 Region: <b>'+esc(c.region)+'</b>\n\nSelect a section:',k);
 }
 async function help(ctx:Context){
   const c=current(ctx),k=new InlineKeyboard();add(k,ctx,c,'⬅️ Menu',x=>home(x));
   await send(ctx,'❔ <b>Control panel</b>\n\nTap a server for status, hardware, all IPv4/IPv6 addresses and management buttons. IP Copy buttons copy the exact address.\n\nEvery AWS change requires a separate confirmation expiring after two minutes.\n\nAdvanced commands such as /create_script and /clone_rules are still supported. Type /cancel to exit a form.',k);
 }
 async function accounts(ctx:Context){
   const c=current(ctx),k=new InlineKeyboard();
   for(const a of config.accounts){
     add(k,ctx,c,(a.alias===c.account.alias?'✅ ':'👤 ')+a.alias,async x=>{select(x.from!.id,{account:a,region:a.regions[0]!});await regions(x);}).row();
   }
   add(k,ctx,c,'⬅️ Menu',x=>home(x));
   await send(ctx,'👤 <b>Choose AWS account</b>\nCurrent: '+esc(c.account.alias),k);
 }
 async function regions(ctx:Context){
   const c=current(ctx),k=new InlineKeyboard();
   for(const region of c.account.regions){
     add(k,ctx,c,(region===c.region?'✅ ':'📍 ')+region,async x=>{select(x.from!.id,{account:c.account,region});await home(x);}).row();
   }
   add(k,ctx,c,'👤 Accounts',x=>accounts(x));add(k,ctx,c,'⬅️ Menu',x=>home(x));
   await send(ctx,'📍 <b>Choose region</b>\nAccount: '+esc(c.account.alias),k);
 }
 async function servers(ctx:Context,p=0){
   const c=current(ctx),all=await aws.instances(c.account,c.region),part=chunk(all,p),k=new InlineKeyboard();
   for(const i of part.list)if(i.name)add(k,ctx,c,state(i.state?.name)+' '+i.name,x=>server(x,i.name!)).row();
   if(p>0)add(k,ctx,c,'◀️ Prev',x=>servers(x,p-1));
   if(p+1<part.pages)add(k,ctx,c,'Next ▶️',x=>servers(x,p+1));
   if(part.pages>1)k.row();
   add(k,ctx,c,'➕ Create',x=>newServer(x));add(k,ctx,c,'🔄 Refresh',x=>servers(x,p));k.row();
   add(k,ctx,c,'⬅️ Menu',x=>home(x));
   await send(ctx,'🖥 <b>SERVER LIST</b>\n'+esc(scope(c))+'\nTotal: '+all.length+' | Page '+(p+1)+'/'+part.pages+'\n\n'+(part.list.map(i=>state(i.state?.name)+' '+esc(i.name)+' · '+esc(i.publicIpAddress)).join('\n')||'No servers in this region.'),k);
 }
 async function server(ctx:Context,name:string){
   const c=current(ctx),i=await aws.getInstance(c.account,c.region,name);
   if(!i)throw new Error('Server not found.');
   const v6=i.ipv6Addresses??[];
   const disk=i.hardware?.disks?.reduce((sum,d)=>sum+(d.sizeInGb??0),0)??0;
   let price='';
   try{const b=(await aws.bundles(c.account,c.region)).find(b=>b.bundleId===i.bundleId);
      if(b)price='\n💰 Bundle: $'+esc(b.price)+'/month (plus other charges)';
   }catch{/*price metadata is optional*/}
   const k=new InlineKeyboard();
   if(i.publicIpAddress)k.copyText('📋 Copy Public IPv4',i.publicIpAddress);
   if(i.privateIpAddress)k.copyText('📋 Copy Private IPv4',i.privateIpAddress);
   if(i.publicIpAddress||i.privateIpAddress)k.row();
   for(const ip of v6.slice(0,3))k.copyText('📋 Copy IPv6',ip).row();
   if(i.state?.name==='running'){
      add(k,ctx,c,'🔄 Reboot',x=>power(x,name,'reboot'));add(k,ctx,c,'🔴 Power OFF',x=>power(x,name,'stop'));k.row();
   }else if(i.state?.name==='stopped'){add(k,ctx,c,'🟢 Power ON',x=>power(x,name,'start')).row();}
   add(k,ctx,c,'📸 Snapshot',x=>newSnapshot(x,name));
   add(k,ctx,c,'🗂 Snapshots',x=>snapshots(x,0,name));k.row();
   add(k,ctx,c,'🔥 Firewall',x=>firewall(x,name));
   add(k,ctx,c,'🌐 Static IPs',x=>ips(x,name));k.row();
   add(k,ctx,c,'🗑 Delete Server',x=>power(x,name,'delete')).row();
   add(k,ctx,c,'🔄 Refresh',x=>server(x,name));add(k,ctx,c,'⬅️ Server List',x=>servers(x));
   const body='🖥 <b>'+esc(i.name)+'</b>\n'+state(i.state?.name)+' Status: <b>'+esc(i.state?.name)+'</b>'+
   '\n📍 Zone: '+esc(i.location?.availabilityZone)+
   '\n🧰 Image: '+esc(i.blueprintId)+'\n📦 Plan: '+esc(i.bundleId)+
   '\n💻 '+esc(i.hardware?.cpuCount)+' CPU | '+esc(i.hardware?.ramSizeInGb)+' GB RAM | '+(disk||'?')+' GB Disk'+price+
   '\n\n🌍 Public IPv4 '+(i.isStaticIp?'(static)':'(dynamic)')+': '+cp(i.publicIpAddress)+
   '\n🔐 Private IPv4: '+cp(i.privateIpAddress)+
   '\n🌐 IPv6:\n'+(v6.map(cp).join('\n')||'—')+'\n\n👤 '+esc(scope(c));
   await send(ctx,body,k);
 }
 async function power(ctx:Context,name:string,action:'start'|'stop'|'reboot'|'delete'){
   const c=current(ctx);
   await ask(ctx,action.toUpperCase()+' '+name+' ('+scope(c)+')'+(action==='delete'?' — IRREVERSIBLE. Check backups!':''),()=>aws.power(c.account,c.region,name,action));
 }
 async function newSnapshot(ctx:Context,name:string){
   const c=current(ctx),snap=checkName(name.slice(0,180)+'-snap-'+new Date().toISOString().replace(/[-:]/g,'').replace(/T/,'-').slice(0,15));
   await ask(ctx,'CREATE SNAPSHOT '+snap+' of '+name+' ('+scope(c)+') — snapshot charges may apply.',()=>aws.snapshotCreate(c.account,c.region,name,snap));
 }
 async function snapshots(ctx:Context,p=0,filter?:string){
   const c=current(ctx),all=(await aws.snapshots(c.account,c.region)).filter(s=>!filter||s.fromInstanceName===filter),part=chunk(all,p),k=new InlineKeyboard();
   for(const s of part.list)if(s.name)add(k,ctx,c,'📸 '+s.name.slice(0,35),x=>snapshot(x,s.name!)).row();
   if(p>0)add(k,ctx,c,'◀️ Prev',x=>snapshots(x,p-1,filter));
   if(p+1<part.pages)add(k,ctx,c,'Next ▶️',x=>snapshots(x,p+1,filter));
   if(part.pages>1)k.row();
   if(filter)add(k,ctx,c,'➕ New Snapshot',x=>newSnapshot(x,filter));
   add(k,ctx,c,'🔄 Refresh',x=>snapshots(x,p,filter)).row();
   add(k,ctx,c,'⬅️ Back',x=>filter?server(x,filter):home(x));
   await send(ctx,'📸 <b>SNAPSHOTS</b>\n'+esc(scope(c))+(filter?'\nSource: '+esc(filter):'')+'\nTotal: '+all.length+'\n\n'+(part.list.map(s=>'📸 '+esc(s.name)+'\n    '+esc(s.state)+' · from '+esc(s.fromInstanceName)).join('\n')||'No snapshots.'),k);
 }
 async function snapshot(ctx:Context,name:string){
   const c=current(ctx),s=(await aws.snapshots(c.account,c.region)).find(s=>s.name===name);
   if(!s)throw new Error('Snapshot no longer exists.');
   const k=new InlineKeyboard();
   add(k,ctx,c,'🚀 Restore as new server',async x=>{begin(x,'restore','name',name);await send(x,'🚀 Snapshot: '+cp(name)+'\n\nSend a <b>NEW instance name</b> as text.',new InlineKeyboard());}).row();
   add(k,ctx,c,'🗑 Delete Snapshot',x=>ask(x,'PERMANENTLY DELETE snapshot '+name+' ('+scope(c)+')',()=>aws.snapshotDelete(c.account,c.region,name))).row();
   add(k,ctx,c,'⬅️ Snapshots',x=>snapshots(x));
   await send(ctx,'📸 <b>'+esc(name)+'</b>\nState: '+esc(s.state)+'\nOriginal instance: '+esc(s.fromInstanceName)+'\nPlan: '+esc(s.fromBundleId)+'\n\n⚠️ Custom firewall rules are not copied on restore.',k);
 }
 async function firewall(ctx:Context,name:string,p=0){
   const c=current(ctx),all=await aws.firewall(c.account,c.region,name),part=chunk(all,p,5),k=new InlineKeyboard();
   for(const [idx,rule] of part.list.entries()){
     const num=p*5+idx+1;
     const sources=[...(rule.cidrs??[]),...(rule.ipv6Cidrs??[]),...(rule.cidrListAliases??[])];
     if(sources.length)add(k,ctx,c,'🗑 Remove rule #'+num,x=>ask(x,'CLOSE '+rule.protocol+' '+rule.fromPort+'-'+rule.toPort+' on '+name+' ('+scope(c)+'). May block SSH or services.',()=>aws.firewallChange(c.account,c.region,name,'close',{
       protocol:rule.protocol,fromPort:rule.fromPort,toPort:rule.toPort,
       cidrs:rule.cidrs,ipv6Cidrs:rule.ipv6Cidrs,cidrListAliases:rule.cidrListAliases
     }))).row();
   }
   if(p>0)add(k,ctx,c,'◀️ Prev',x=>firewall(x,name,p-1));
   if(p+1<part.pages)add(k,ctx,c,'Next ▶️',x=>firewall(x,name,p+1));
   if(part.pages>1)k.row();
   for(const [text,port] of [['🔐 SSH 22',22],['🌍 HTTP 80',80],['🔒 HTTPS 443',443]] as const)
     add(k,ctx,c,text,x=>ask(x,'OPEN TCP '+port+' from ALL IPv4 on '+name+' ('+scope(c)+')',()=>aws.firewallChange(c.account,c.region,name,'open',makePortInfo('tcp',String(port),String(port),'0.0.0.0/0'))));
   k.row();
   add(k,ctx,c,'➕ Custom Rule',async x=>{begin(x,'rule','rule',name);await send(x,'🔥 Add Firewall Rule for '+cp(name)+'\nSend: '+cp('tcp 443 443 0.0.0.0/0')+'\nOr IPv6: '+cp('tcp 443 443 ::/0'),new InlineKeyboard());}).row();
   add(k,ctx,c,'🔄 Refresh',x=>firewall(x,name,p));add(k,ctx,c,'⬅️ Server',x=>server(x,name));
   await send(ctx,'🔥 <b>FIREWALL: '+esc(name)+'</b>\n'+esc(scope(c))+'\n\n'+(part.list.map((r,j)=>'#'+(p*5+j+1)+' '+esc(r.protocol)+' '+r.fromPort+'–'+r.toPort+'\n   '+esc([...(r.cidrs??[]),...(r.ipv6Cidrs??[]),...(r.cidrListAliases??[])].join(', ')||'no explicit source')).join('\n\n')||'No rules.'),k);
 }
 async function ips(ctx:Context,name?:string,p=0){
   const c=current(ctx),all=await aws.staticIps(c.account,c.region),part=chunk(all,p),k=new InlineKeyboard();
   for(const ip of part.list)if(ip.name)add(k,ctx,c,'🌐 '+ip.name,x=>ipDetails(x,ip.name!)).row();
   if(p>0)add(k,ctx,c,'◀️ Prev',x=>ips(x,name,p-1));
   if(p+1<part.pages)add(k,ctx,c,'Next ▶️',x=>ips(x,name,p+1));
   if(part.pages>1)k.row();
   if(name)add(k,ctx,c,'🔗 Attach IP',x=>chooseIp(x,name));
   add(k,ctx,c,'➕ Reserve IP',async x=>{begin(x,'ip','name');await send(x,'🌐 Send a name for a new static IPv4. Unattached addresses may incur charges.',new InlineKeyboard());}).row();
   add(k,ctx,c,'🔄 Refresh',x=>ips(x,name));add(k,ctx,c,'⬅️ Back',x=>name?server(x,name):home(x));
   await send(ctx,'🌐 <b>STATIC IPv4</b>\n'+esc(scope(c))+'\n\n'+(part.list.map(i=>esc(i.name)+' '+cp(i.ipAddress)+'\n🔗 '+esc(i.attachedTo||'Unattached')).join('\n\n')||'No reserved IPs.'),k);
 }
 async function ipDetails(ctx:Context,name:string){
   const c=current(ctx),ip=(await aws.staticIps(c.account,c.region)).find(x=>x.name===name);
   if(!ip)throw new Error('Static IP not found.');
   const k=new InlineKeyboard();if(ip.ipAddress)k.copyText('📋 Copy IP',ip.ipAddress).row();
   if(ip.attachedTo){
     add(k,ctx,c,'🖥 Open Server',x=>server(x,ip.attachedTo!)).row();
     add(k,ctx,c,'🔌 Detach',x=>ask(x,'DETACH '+name+' from '+ip.attachedTo+' ('+scope(c)+') — live connections may break.',()=>aws.detachIp(c.account,c.region,name))).row();
   }else{
     add(k,ctx,c,'🔗 Attach to Server',x=>chooseServer(x,name)).row();
     add(k,ctx,c,'🗑 Release IP',x=>ask(x,'PERMANENTLY RELEASE '+name+' ('+scope(c)+')',()=>aws.releaseIp(c.account,c.region,name))).row();
   }
   add(k,ctx,c,'⬅️ IP list',x=>ips(x));
   await send(ctx,'🌐 <b>'+esc(name)+'</b>\nIP: '+cp(ip.ipAddress)+'\nConnected to: '+esc(ip.attachedTo||'Unattached'),k);
 }
 async function chooseIp(ctx:Context,serverName:string){
   const c=current(ctx),all=(await aws.staticIps(c.account,c.region)).filter(i=>!i.attachedTo),k=new InlineKeyboard();
   for(const ip of all.slice(0,20))if(ip.name)add(k,ctx,c,'🌐 '+ip.name,x=>ask(x,'ATTACH '+ip.name+' to '+serverName+' ('+scope(c)+')',()=>aws.attachIp(c.account,c.region,ip.name!,serverName))).row();
   add(k,ctx,c,'⬅️ Server',x=>server(x,serverName));
   await send(ctx,'🔗 <b>Attach Static IPv4 to '+esc(serverName)+'</b>\n'+(all.length?'Select an unassigned IP:':'No unassigned IPs.'),k);
 }
 async function chooseServer(ctx:Context,ipName:string){
   const c=current(ctx),all=await aws.instances(c.account,c.region),k=new InlineKeyboard();
   for(const i of all.slice(0,30))if(i.name)add(k,ctx,c,'🖥 '+i.name,x=>ask(x,'ATTACH IP '+ipName+' to '+i.name+' ('+scope(c)+')',()=>aws.attachIp(c.account,c.region,ipName,i.name!))).row();
   add(k,ctx,c,'⬅️ IP',x=>ipDetails(x,ipName));
   await send(ctx,'🔗 Choose destination for '+cp(ipName)+':',k);
 }
 async function newServer(ctx:Context){
   begin(ctx,'create','name');
   const c=current(ctx),k=new InlineKeyboard();add(k,ctx,c,'✖ Cancel',x=>home(x));
   await send(ctx,'➕ <b>Create Lightsail server</b>\n\nStep 1: Send new server name (example '+cp('DE02')+').\nRegion: '+esc(c.region),k);
 }
 async function chooseZone(ctx:Context){
   const f=form(ctx);if(!f?.name)throw new Error('Form expired. Restart from Menu.');
   const c=current(ctx),r=await aws.regions(c.account,c.region),all=r.find(r=>r.name===c.region)?.availabilityZones??[],k=new InlineKeyboard();
   for(const z of all)if(z.zoneName)add(k,ctx,c,'📍 '+z.zoneName,async x=>{const d=form(x);if(!d)throw new Error('Form expired.');d.zone=checkZone(z.zoneName!,c.region);await (d.kind==='restore'?chooseBundle(x):chooseImage(x));}).row();
   add(k,ctx,c,'✖ Cancel',x=>home(x));
   await send(ctx,'📍 <b>Choose availability zone</b>\nName: '+cp(f.name)+'\n'+(all.length?'Select:':'No availability zones found.'),k);
 }
 async function chooseImage(ctx:Context,p=0){
   const f=form(ctx);if(!f)throw new Error('Form expired.');
   const c=current(ctx),all=await aws.blueprints(c.account,c.region),part=chunk(all,p),k=new InlineKeyboard();
   for(const b of part.list)if(b.blueprintId)add(k,ctx,c,'💿 '+String(b.name||b.blueprintId).slice(0,40),async x=>{const d=form(x);if(!d)throw new Error('Form expired.');d.blueprint=b.blueprintId;await chooseBundle(x);}).row();
   if(p>0)add(k,ctx,c,'◀️ Prev',x=>chooseImage(x,p-1));
   if(p+1<part.pages)add(k,ctx,c,'Next ▶️',x=>chooseImage(x,p+1));
   if(part.pages>1)k.row();
   add(k,ctx,c,'✖ Cancel',x=>home(x));
   await send(ctx,'💿 <b>Choose Operating System</b>\nPage '+(p+1)+'/'+part.pages,k);
 }
 async function chooseBundle(ctx:Context,p=0){
   const f=form(ctx);if(!f)throw new Error('Form expired.');
   const c=current(ctx),all=(await aws.bundles(c.account,c.region)).filter(b=>b.isActive!==false),part=chunk(all,p),k=new InlineKeyboard();
   for(const b of part.list)if(b.bundleId)add(k,ctx,c,'💰 '+b.cpuCount+' CPU · '+b.ramSizeInGb+' GB · $'+b.price,async x=>{const d=form(x);if(!d)throw new Error('Form expired.');d.bundle=b.bundleId;await preview(x);}).row();
   if(p>0)add(k,ctx,c,'◀️ Prev',x=>chooseBundle(x,p-1));
   if(p+1<part.pages)add(k,ctx,c,'Next ▶️',x=>chooseBundle(x,p+1));
   if(part.pages>1)k.row();
   add(k,ctx,c,'✖ Cancel',x=>home(x));
   await send(ctx,'💰 <b>Choose plan</b>\nPage '+(p+1)+'/'+part.pages+'\nPrices exclude extra charges.',k);
 }
 async function preview(ctx:Context){
   const f=form(ctx);if(!f||!f.name||!f.zone||!f.bundle)throw new Error('Incomplete or expired form.');
   if(f.kind==='create'&&!f.blueprint)throw new Error('No blueprint selected.');
   const c=current(ctx),k=new InlineKeyboard();
   add(k,ctx,c,'✅ Confirm next',async x=>{
     const d=form(x);if(!d?.name||!d.zone||!d.bundle)throw new Error('Form expired.');
     const data={...d};forms.delete(x.from!.id);
     if(data.kind==='restore'){
       if(!data.source)throw new Error('Missing snapshot name.');
       await ask(x,'CREATE '+data.name+' FROM SNAPSHOT '+data.source+' ('+scope(c)+'). Custom firewall rules are NOT copied. Charges apply.',()=>aws.restore(c.account,c.region,data.source!,data.name!,data.zone!,data.bundle!));
     }else{
       await ask(x,'CREATE '+data.name+' ('+scope(c)+', '+data.zone+', '+data.blueprint+', '+data.bundle+'). Charges apply.',()=>aws.create(c.account,c.region,data.name!,data.zone!,data.blueprint!,data.bundle!));
     }
   }).row();
   add(k,ctx,c,'◀️ Change Plan',x=>chooseBundle(x));add(k,ctx,c,'✖ Cancel',x=>home(x));
   await send(ctx,'✅ <b>Review new server</b>\nName: '+cp(f.name)+'\nZone: '+cp(f.zone)+'\n'+(f.kind==='restore'?'Snapshot: '+cp(f.source):'Image: '+cp(f.blueprint))+'\nBundle: '+cp(f.bundle)+'\n\n⚠️ Requires a separate timed confirmation. AWS charges may apply.',k);
 }
 bot.command('start',ctx=>guarded(ctx,()=>home(ctx)));
 bot.command('menu',ctx=>guarded(ctx,()=>home(ctx)));
 bot.command('help',ctx=>guarded(ctx,()=>help(ctx)));
 bot.command('servers',ctx=>guarded(ctx,()=>servers(ctx)));
 bot.command('server',ctx=>guarded(ctx,async()=>{const name=typeof ctx.match==='string'?ctx.match.trim():'';return name?server(ctx,checkName(name)):servers(ctx);}));
 bot.command('snapshots',ctx=>guarded(ctx,()=>snapshots(ctx)));
 bot.command('firewall',ctx=>guarded(ctx,async()=>{const name=typeof ctx.match==='string'?ctx.match.trim():'';return name?firewall(ctx,checkName(name)):servers(ctx);}));
 bot.command('static_ips',ctx=>guarded(ctx,()=>ips(ctx)));
 bot.command('accounts',ctx=>guarded(ctx,()=>accounts(ctx)));
 bot.command('regions',ctx=>guarded(ctx,()=>regions(ctx)));
 bot.command('cancel',ctx=>guarded(ctx,()=>home(ctx)));
 bot.callbackQuery(/^ui:([A-Za-z0-9_-]{16})$/,async ctx=>{
   const c=current(ctx),item=clicks.get(ctx.match[1]!);
   if(!item||item.until<Date.now()||item.who!==ctx.from.id||item.account!==c.account.alias||item.region!==c.region){
      await ctx.answerCallbackQuery({text:'Button expired or account/region changed. Send /menu.'});return;
   }
   await ctx.answerCallbackQuery();
   await guarded(ctx,()=>item.go(ctx));
 });
 bot.on('message:text',async(ctx,next)=>{
   if(ctx.message.text.startsWith('/'))return next();
   const f=form(ctx);if(!f)return next();
   await guarded(ctx,async()=>{
     const input=ctx.message.text.trim();
     if(f.step==='name'){
       const name=checkName(input);
       if(f.kind==='ip'){forms.delete(ctx.from!.id);await ask(ctx,'RESERVE STATIC IP '+name+' ('+f.account.alias+'/'+f.region+'). Charges may apply.',()=>aws.reserveIp(f.account,f.region,name));return;}
       f.name=name;await chooseZone(ctx);return;
     }
     if(f.kind==='rule'&&f.step==='rule'){
       const values=input.split(/\s+/);
       if(values.length!==4)throw new Error('Expected: tcp 443 443 0.0.0.0/0');
       const [protocol,from,to,cidr]=values as [string,string,string,string];
       const info=makePortInfo(protocol,from,to,cidr);
       if(!f.source)throw new Error('Missing instance.');
       forms.delete(ctx.from!.id);
       await ask(ctx,'OPEN '+protocol+' '+from+'-'+to+' '+cidr+' on '+f.source+' ('+f.account.alias+'/'+f.region+'). Check public exposure.',()=>aws.firewallChange(f.account,f.region,f.source!,'open',info));
     }
   });
 });
}
