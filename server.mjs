import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateSignature } from './lib/signatures.ts';

const directory = path.dirname(fileURLToPath(import.meta.url));
const fields = 'id, name, message, color, strokes, created_at AS createdAt';
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.mp3':'audio/mpeg','.m4a':'audio/mp4','.ogg':'audio/ogg','.wav':'audio/wav','.mp4':'video/mp4','.ico':'image/x-icon','.woff2':'font/woff2'};
const visible = row => ({...row, strokes: JSON.parse(row.strokes)});
const digest = value => createHash('sha256').update(value).digest();

export function createApp(options = {}) {
  const databasePath = options.databasePath ?? process.env.DATABASE_PATH ?? path.join(directory, 'data', 'signatures.sqlite');
  const token = options.inviteToken ?? process.env.SIGNATURE_INVITE_TOKEN ?? '';
  const publicOrigin = (options.publicOrigin ?? process.env.PUBLIC_ORIGIN) || undefined;
  if (publicOrigin && new URL(publicOrigin).origin !== publicOrigin) throw new Error('PUBLIC_ORIGIN 必须是完整网址来源，不能包含路径。');
  const root = path.resolve(options.staticDirectory ?? path.join(directory,'public'));
  mkdirSync(root, {recursive:true});
  const realRoot = realpathSync(root);
  mkdirSync(path.dirname(path.resolve(databasePath)), {recursive:true});
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  // Standalone SQLite owns its startup schema; no schema mutations occur inside request handling.
  db.exec(`CREATE TABLE IF NOT EXISTS signatures (
    id TEXT PRIMARY KEY NOT NULL, request_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL, message TEXT NOT NULL, color TEXT NOT NULL,
    strokes TEXT NOT NULL, created_at TEXT NOT NULL
  )`);
  const list = db.prepare(`SELECT ${fields} FROM signatures ORDER BY created_at DESC, id DESC LIMIT 200`);
  const find = db.prepare(`SELECT ${fields} FROM signatures WHERE request_id = ?`);
  const insert = db.prepare('INSERT INTO signatures (id, request_id, name, message, color, strokes, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM signatures) < 200 ON CONFLICT(request_id) DO NOTHING');
  const json = (res, body, status=200) => {
    res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(JSON.stringify(body));
  };
  const server = http.createServer(async (req,res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/healthz') return json(res,{ok:true});
      if (url.pathname === '/api/signatures') {
        if (req.method === 'GET') { const items = list.all().map(visible); return json(res,{items,count:items.length}); }
        if (req.method !== 'POST') { res.setHeader('Allow','GET, POST'); return json(res,{error:'该请求方式不受支持。'},405); }
        const expectedOrigin = publicOrigin ?? `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
        if (req.headers.origin !== expectedOrigin) return json(res,{error:'请从生日页面提交签名。'},403);
        if (!token) return json(res,{error:'签名册暂未准备好，请稍后再试。'},503);
        const supplied = req.headers['x-invite-token'];
        if (typeof supplied !== 'string' || supplied.length > 512 || !timingSafeEqual(digest(supplied),digest(token))) return json(res,{error:'邀请口令不正确，请检查后重试。'},401);
        if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return json(res,{error:'请使用有效的签名格式。'},415);
        let size=0; const chunks=[];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 150000) return json(res,{error:'签名内容过大，请简化后重试。'},413);
          chunks.push(chunk);
        }
        let parsed;
        try { parsed=JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return json(res,{error:'签名格式无效，请重试。'},400); }
        let data;
        try { data=validateSignature(parsed); }
        catch(error) { return json(res,{error:error.message},400); }
        const strokes=JSON.stringify(data.strokes);
        insert.run(randomUUID(),data.requestId,data.name,data.message,data.color,strokes,new Date().toISOString());
        const row=find.get(data.requestId);
        if (!row) return json(res,{error:'签名册已收满200份祝福，谢谢你的心意。'},409);
        if (row.name!==data.name || row.message!==data.message || row.color!==data.color || row.strokes!==strokes) return json(res,{error:'该提交编号已使用，请重新提交。'},409);
        return json(res,{item:visible(row)});
      }
      if (!['GET','HEAD'].includes(req.method)) return json(res,{error:'该请求方式不受支持。'},405);
      if (url.pathname==='/') {res.writeHead(302,{'Location':`/birthday/${url.search}`,'Cache-Control':'no-store'}); return res.end();}
      let pathname;
      try { pathname=decodeURIComponent(url.pathname); } catch { return json(res,{error:'页面地址无效。'},400); }
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part=>part==='..' || part.startsWith('.'))) return json(res,{error:'页面不存在。'},404);
      let candidate=path.resolve(root,`.${pathname}`);
      if (!candidate.startsWith(root+path.sep)) return json(res,{error:'页面不存在。'},404);
      let stats;
      try {
        stats=statSync(candidate);
        if (stats.isDirectory()) {candidate=path.join(candidate,'index.html');stats=statSync(candidate);}
        const resolved=realpathSync(candidate);
        if (!resolved.startsWith(realRoot+path.sep) || !stats.isFile()) return json(res,{error:'页面不存在。'},404);
        candidate=resolved;
      } catch { return json(res,{error:'页面不存在。'},404); }
      let start=0,end=stats.size-1,status=200;
      const headers={'Content-Type':mime[path.extname(candidate).toLowerCase()] ?? 'application/octet-stream','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Cache-Control':'no-cache'};
      if (req.headers.range) {
        const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (match && (match[1] || match[2])) {
          if (!match[1]) { start=Math.max(0,stats.size-Number(match[2])); }
          else {start=Number(match[1]);if(match[2]) end=Math.min(end,Number(match[2]));}
        }
        if (!match || (!match[1]&&!match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start>end || start>=stats.size || (match[1]==='' && Number(match[2])===0)) {
          res.writeHead(416,{'Content-Range':`bytes */${stats.size}`}); return res.end();
        }
        status=206;headers['Content-Range']=`bytes ${start}-${end}/${stats.size}`;
      }
      headers['Content-Length']=String(Math.max(0,end-start+1));
      res.writeHead(status,headers);
      if(req.method==='HEAD' || stats.size===0) return res.end();
      const stream=createReadStream(candidate,{start,end});
      stream.on('error',()=>res.destroy());
      res.on('close',()=>stream.destroy());
      stream.pipe(res);
    } catch { if(!res.headersSent) json(res,{error:'暂时无法完成请求，请稍后再试。'},503); else res.destroy(); }
  });
  server.requestTimeout=30000;
  server.headersTimeout=15000;
  server.on('close',()=>db.close());
  return server;
}

if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const server=createApp();
  const port=Number(process.env.PORT ?? 3000);
  server.listen(port,'0.0.0.0',()=>console.log(`生日网站已启动，端口 ${port}`));
  for (const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>server.close(()=>process.exit(0)));
}
