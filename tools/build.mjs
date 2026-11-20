import fs from 'node:fs';
import path from 'node:path';
const input=fs.existsSync('config.local.json')?'config.local.json':'config.json';
const c=JSON.parse(fs.readFileSync(input,'utf8'));
for(const key of ['name','nickname','intro','finalWish','sender']) if(typeof c[key]!=='string'||!c[key].trim())throw Error(`缺少配置：${key}`);
if(!Number.isInteger(c.age)||c.age<1||c.age>150)throw Error('age应为1至150之间的整数');
if(!Array.isArray(c.photos)||!c.photos.length)throw Error('至少需要一张照片');
if(!Array.isArray(c.cakeWishes)||c.cakeWishes.length!==6)throw Error('纸条蛋糕需要6句祝福');
if(!Array.isArray(c.childMessages)||!c.childMessages.length)throw Error('至少需要一句童年对话');
const media=[...c.photos.map(p=>p.src),c.childPhoto,c.giftImage,c.music?.src].filter(Boolean);
for(const src of media){if(typeof src!=='string'||!src.startsWith('assets/')||src.includes('..')||src.includes('\\'))throw Error('素材必须为assets目录内的相对路径');if(!fs.existsSync(path.join('public/birthday',src)))throw Error(`素材不存在：${src}`);}
if(c.privateCard?.enabled&&!fs.existsSync('public/birthday/card-sealed.js'))throw Error('先运行npm run seal生成加密贺卡');
fs.writeFileSync('public/birthday/config.js','window.BIRTHDAY_CONFIG='+JSON.stringify(c).replaceAll('<','\\u003c')+';\n');
console.log('配置已生成。npm start后打开 http://localhost:3000');
