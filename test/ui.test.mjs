
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerInteractiveUi } from '../src/ui.ts';

function setup() {
 const commands=new Map(), callbacks=[], replies=[], writes=[];
 const bot={
   command(name,fn){commands.set(name,fn);},
   callbackQuery(re,fn){callbacks.push({re,fn});},
   on(){}
 };
 const account={alias:'personal',profile:'testing',regions:['eu-central-1']};
 const c={account,region:'eu-central-1'};
 const aws={
   instances:async()=>[{name:'DE01',state:{name:'running'},publicIpAddress:'198.51.100.9'}],
   getInstance:async()=>({name:'DE01',state:{name:'running'},publicIpAddress:'198.51.100.9',privateIpAddress:'172.26.2.214',ipv6Addresses:['2001:db8::1'],isStaticIp:true,hardware:{cpuCount:2,ramSizeInGb:4,disks:[{sizeInGb:80}]},blueprintId:'ubuntu_24_04',bundleId:'small',location:{availabilityZone:'eu-central-1a'}}),
   bundles:async()=>[{bundleId:'small',price:20,cpuCount:2,ramSizeInGb:4}],
   snapshots:async()=>[],staticIps:async()=>[]
 };
 const ctx={
   from:{id:123},chat:{id:123,type:'private'},match:'',
   reply:async(body,opts)=>{replies.push({body,opts});return {message_id:replies.length};},
   answerCallbackQuery:async()=>{}
 };
 registerInteractiveUi({
   bot,aws,config:{accounts:[account]},
   choice:()=>c,select:(_id,x)=>Object.assign(c,x),
   guarded:async(_ctx,fn)=>{await fn();},
   ask:async(_ctx,summary,fn)=>{writes.push({summary,fn});}
 });
 async function click(data){
   const match=/^ui:([A-Za-z0-9_-]{16})$/.exec(data);
   assert.ok(match);
   const handler=callbacks.find(x=>x.re.test(data));
   assert.ok(handler);
   await handler.fn({...ctx,match});
 }
 return {ctx,c,replies,writes,commands,click};
}
test('home dashboard and server cards show copyable public/private IPv4 and IPv6',async()=>{
 const s=setup();
 await s.commands.get('start')(s.ctx);
 assert.match(s.replies.at(-1).body,/LIGHTSAIL MANAGEMENT/);
 const menu=s.replies.at(-1).opts.reply_markup.inline_keyboard;
 const servers=menu.flat().find(x=>x.text.includes('Servers'));
 await s.click(servers.callback_data);
 assert.match(s.replies.at(-1).body,/DE01/);
 const serverButton=s.replies.at(-1).opts.reply_markup.inline_keyboard.flat().find(x=>x.text.includes('DE01'));
 await s.click(serverButton.callback_data);
 const card=s.replies.at(-1);
 assert.match(card.body,/172\.26\.2\.214/);
 assert.match(card.body,/198\.51\.100\.9/);
 assert.match(card.body,/2001:db8::1/);
 const buttons=card.opts.reply_markup.inline_keyboard.flat();
 const copy=buttons.filter(x=>x.copy_text).map(x=>x.copy_text.text);
 assert.deepEqual(copy,['198.51.100.9','172.26.2.214','2001:db8::1']);
 assert.equal(s.writes.length,0);
});
test('server mutations require the separate timed confirmation action',async()=>{
 const s=setup();
 await s.commands.get('server')({...s.ctx,match:'DE01'});
 const k=s.replies.at(-1).opts.reply_markup.inline_keyboard.flat();
 const deleteButton=k.find(x=>x.text.includes('Delete Server'));
 await s.click(deleteButton.callback_data);
 assert.equal(s.writes.length,1);
 assert.match(s.writes[0].summary,/IRREVERSIBLE/);
});
test('old callback cannot be applied to a different account/region context',async()=>{
 const s=setup();
 await s.commands.get('start')(s.ctx);
 const button=s.replies.at(-1).opts.reply_markup.inline_keyboard.flat().find(x=>x.text.includes('Servers'));
 s.c.region='eu-west-1';
 await s.click(button.callback_data);
 assert.equal(s.replies.length,1);
});
