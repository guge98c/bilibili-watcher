import axios from 'axios';
import { getWbiKeys, signParams } from './wbi.js';

const MID = process.env.BILI_MID;
const N8N_URL = process.env.N8N_WEBHOOK_URL;
const COOKIE = process.env.BILI_COOKIE;

if (!MID || !N8N_URL || !COOKIE) {
  console.error('缺少环境变量，请检查 Secrets');
  console.error('BILI_MID:', MID ? '已设置' : '未设置');
  console.error('N8N_WEBHOOK_URL:', N8N_URL ? '已设置' : '未设置');
  console.error('BILI_COOKIE:', COOKIE ? `已设置(长度${COOKIE.length})` : '未设置');
  process.exit(1);
}

console.log('环境变量检查通过');
console.log('BILI_MID:', MID);
console.log('COOKIE 长度:', COOKIE.length);
console.log('COOKIE 前30字符:', COOKIE.slice(0, 30));

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Referer': `https://space.bilibili.com/${MID}/`,
  'Cookie': COOKIE,
};

try {
  // 模拟人类的小延迟
  await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
  console.log('延迟完成，开始获取 wbi keys...');

  const { imgKey, subKey } = await getWbiKeys(axios, headers);
  console.log('wbi keys 获取成功');
  console.log('imgKey:', imgKey.slice(0, 8) + '...');
  console.log('subKey:', subKey.slice(0, 8) + '...');

  const params = signParams(
    { mid: MID, ps: 30, pn: 1, order: 'pubdate' },
    imgKey,
    subKey
  );
  console.log('签名完成');
  console.log('w_rid:', params.w_rid);
  console.log('wts:', params.wts);

  // 直接拼 URL，避免 axios params 二次 encode 导致和签名不一致
  const query = Object.keys(params)
    .sort()
    .map(k => `${k}=${encodeURIComponent(params[k])}`)
    .join('&');
  const url = `https://api.bilibili.com/x/space/wbi/arc/search?${query}`;
  console.log('请求URL前100字符:', url.slice(0, 100));

  const { data } = await axios.get(url, { headers, timeout: 15000 });
  console.log('B站返回 code:', data.code);
  console.log('B站返回 message:', data.message);

  if (data.code !== 0) {
    console.error('B站 API 错误:', data.code, data.message);
    process.exit(1);
  }

  const vlist = data.data?.list?.vlist || [];
  console.log(`获取到 ${vlist.length} 条视频`);

  if (vlist.length > 0) {
    console.log('前3条:');
    vlist.slice(0, 3).forEach(v => {
      console.log(`  ${v.bvid} - ${v.title}`);
    });
  }

  const videos = vlist.map(v => ({
    bvid: v.bvid,
    title: v.title,
    created: v.created,
  }));

  console.log('正在发送到 n8n:', N8N_URL);
  await axios.post(N8N_URL, { mid: MID, videos }, { timeout: 10000 });
  console.log(`成功：已发送 ${videos.length} 条视频到 n8n`);
} catch (err) {
  console.error('===== 执行失败 =====');
  console.error('错误信息:', err.message);
  if (err.response) {
    console.error('HTTP状态码:', err.response.status);
    console.error('响应数据:', JSON.stringify(err.response.data || {}).slice(0, 500));
  }
  if (err.code) {
    console.error('错误代码:', err.code);
  }
  process.exit(1);
}

