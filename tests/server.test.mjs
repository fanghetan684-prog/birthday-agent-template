import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('API authorization, validation, idempotency, capacity, restart persistence and static safety', async () => {
  const temp=await mkdtemp(path.join(tmpdir(),'birthday-test-'));
  const staticDirectory=path.join(temp,'public');
  await mkdir(path.join(staticDirectory,'birthday'),{recursive:true});
  await writeFile(path.join(staticDirectory,'birthday','index.html'),'<!doctype html><title>Test</title>');
  await writeFile(path.join(staticDirectory,'birthday','audio.mp3'),'0123456789');
  await writeFile(path.join(temp,'outside.txt'),'PRIVATE');
  const token=randomUUID();
  const config={databasePath:path.join(temp,'data','test.sqlite'),inviteToken:token,staticDirectory};
  let server;let origin;
  const start=async (options=config) => {
    server=createApp(options);
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    origin=`http://127.0.0.1:${server.address().port}`;
  };
  const stop=async()=>{ server.closeAllConnections();await new Promise(resolve=>server.close(resolve));server=null; };
  const post=(data,headers={})=>fetch(`${origin}/api/signatures`,{method:'POST',headers:{'Content-Type':'application/json','Origin':origin,'X-Invite-Token':token,...headers},body:JSON.stringify(data)});
  const input={requestId:randomUUID(),name:'测试好友😀',message:'生日快乐',color:'#bb6688'};
  try {
    await start();
    assert.deepEqual(await (await fetch(`${origin}/healthz`)).json(),{ok:true});
    assert.equal((await post(input,{'Origin':'https://foreign.invalid'})).status,403);
    assert.equal((await post(input,{'X-Invite-Token':'wrong'})).status,401);
    assert.equal((await post({...input,message:''})).status,400);
    assert.equal((await post({...input,strokes:[[[2,0]]]})).status,400);
    const response=await post(input);assert.equal(response.status,200);
    const first=(await response.json()).item;assert.ok(first.id);
    assert.equal((await (await post(input)).json()).item.id,first.id);
    assert.equal((await post({...input,message:'不同内容'})).status,409);
    assert.equal((await post('a'.repeat(150001))).status,413);
    assert.deepEqual(Object.keys(first).sort(),['id','name','message','color','strokes','createdAt'].sort());
    const redirect=await fetch(`${origin}/?invite=test&x=1`,{redirect:'manual'});
    assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),'/birthday/?invite=test&x=1');
    const partial=await fetch(`${origin}/birthday/audio.mp3`,{headers:{Range:'bytes=2-5'}});
    assert.equal(partial.status,206);assert.equal(partial.headers.get('content-range'),'bytes 2-5/10');assert.equal(await partial.text(),'2345');
    assert.equal(await (await fetch(`${origin}/birthday/audio.mp3`,{headers:{Range:'bytes=-3'}})).text(),'789');
    assert.equal((await fetch(`${origin}/birthday/audio.mp3`,{headers:{Range:'bytes=30-'}})).status,416);
    assert.equal((await fetch(`${origin}/%2e%2e%2foutside.txt`)).status,404);
    assert.equal((await fetch(`${origin}/.env`)).status,404);
    assert.equal((await fetch(`${origin}/birthday/`)).status,200);
    await stop();await start();
    const stored=await (await fetch(`${origin}/api/signatures`)).json();
    assert.equal(stored.count,1);assert.equal(stored.items[0].id,first.id);
    for(let i=1;i<200;i++) assert.equal((await post({...input,requestId:randomUUID()})).status,200);
    assert.equal((await post({...input,requestId:randomUUID()})).status,409);
    assert.equal((await post(input)).status,200);
    assert.equal((await (await fetch(`${origin}/api/signatures`)).json()).count,200);
    await stop();await start({...config,inviteToken:''});
    assert.equal((await post({...input,requestId:randomUUID()})).status,503);
    await stop();await start({...config,publicOrigin:'https://birthday.example.com'});
    assert.equal((await post(input)).status,403);
    assert.equal((await post(input,{Origin:'https://birthday.example.com'})).status,200);
  } finally {if(server) await stop();await rm(temp,{recursive:true,force:true});}
});

test('SQLite survives a complete Node process restart', async () => {
  const temp=await mkdtemp(path.join(tmpdir(),'birthday-process-test-'));
  const token=randomUUID();
  let child;
  const launch=async()=>{
    child=spawn(process.execPath,['--input-type=module','-e',`import {createApp} from './server.mjs';const s=createApp();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`],{
      cwd:new URL('..',import.meta.url),env:{...process.env,DATABASE_PATH:path.join(temp,'signatures.sqlite'),SIGNATURE_INVITE_TOKEN:token,PUBLIC_ORIGIN:''},stdio:['ignore','pipe','pipe']
    });
    const port=await new Promise((resolve,reject)=>{child.stdout.once('data',chunk=>resolve(Number(String(chunk).trim())));child.once('error',reject);child.once('exit',code=>reject(new Error(`启动失败 ${code}`)));});
    return `http://127.0.0.1:${port}`;
  };
  const stop=async()=>{const exited=once(child,'exit');child.kill();await exited;child=null;};
  try {
    let origin=await launch();
    const response=await fetch(`${origin}/api/signatures`,{method:'POST',headers:{Origin:origin,'X-Invite-Token':token,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),name:'重启测试',message:'保存成功',color:'#bb6688'})});
    assert.equal(response.status,200);const item=(await response.json()).item;
    await stop();origin=await launch();
    const stored=await (await fetch(`${origin}/api/signatures`)).json();
    assert.equal(stored.count,1);assert.equal(stored.items[0].id,item.id);
  } finally {if(child) await stop();await rm(temp,{recursive:true,force:true});}
});
