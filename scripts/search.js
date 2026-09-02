import axios from 'axios';
import { getWbiKeys, signParams } from './wbi.js';

const MID = process.env.BILI_MID;
const N8N_URL = process.env.N8N_WEBHOOK_URL;
const COOKIE = process.env.BILI_COOKIE;

if (!MID || !N8N_URL || !COOKIE) {
  console.error('缺少环境变量，请检查 Secrets');
  process.exit(1);
}

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Referer': `https://space.bilibili.com/${MID}/`,
  'Cookie': COOKIE,
};

// 模拟人类的小延迟
await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));

const { imgKey, subKey } = await getWbiKeys(axios, headers);

const params = signParams(
  { mid: MID, ps: 30, pn: 1, order: 'pubdate' },
  imgKey,
  subKey
);

const { data } = await axios.get(
  'https://api.bilibili.com/x/space/wbi/arc/search',
  { params, headers }
);

if (data.code !== 0) {
  console.error('API 错误:', data.code, data.message);
  process.exit(1);
}

const videos = data.data.list.vlist.map(v => ({
  bvid: v.bvid,
  title: v.title,
  created: v.created,
}));

await axios.post(N8N_URL, { mid: MID, videos }, { timeout: 10000 });

console.log(`成功：已发送 ${videos.length} 条视频到 n8n`);
