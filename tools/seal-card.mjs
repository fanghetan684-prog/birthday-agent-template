import fs from 'node:fs';import crypto from 'node:crypto';
const c=JSON.parse(fs.readFileSync(process.argv[2]||'private/card.json','utf8'));
if(!Array.isArray(c.answers)||!c.answers.length||!c.answers.every(a=>typeof a==='string'&&a.normalize('NFKC').replace(/\s+/g,'').length>=2))throw Error('answers需要至少一个2字以上的答案');
if(!Array.isArray(c.paragraphs)||!c.paragraphs.every(p=>typeof p==='string')||typeof c.title!=='string'||typeof c.signature!=='string')throw Error('需要title、signature及paragraphs数组');
const salt=crypto.randomBytes(24),iterations=210000;const body={title:c.title,signature:c.signature,paragraphs:c.paragraphs};
const envelopes=c.answers.map(a=>{const answer=a.normalize('NFKC').replace(/\s+/g,'');const iv=crypto.randomBytes(12),key=crypto.pbkdf2Sync(answer,salt,iterations,32,'sha256');const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);return{length:Array.from(answer).length,check:crypto.createHash('sha256').update(salt).update(answer).digest('hex'),iv:iv.toString('base64'),ciphertext:Buffer.concat([cipher.update(JSON.stringify(body),'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64')};});
fs.writeFileSync('public/birthday/card-sealed.js','window.SEALED_CARD='+JSON.stringify({salt:salt.toString('base64'),iterations,envelopes})+';\n');console.log('加密贺卡已生成；明文与答案不得提交到公开仓库。');
