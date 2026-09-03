import axios from 'axios';
import { getWbiKeys, signParams } from './wbi.js';

// BILI_MID 配置成逗号分隔多个 UID：316183842,13416784,...
const MIDS = (process.env.BILI_MID || '').split(',').map(s => s.trim()).filter(Boolean);
const N8N_URL = process.env.N8N_WEBHOOK_URL;
const COOKIE = process.env.BILI_COOKIE;

if (MIDS.length === 0 || !N8N_URL || !COOKIE) {
  console.error('===== 缺少环境变量 =====');
  console.error('BILI_MID:', MIDS.length > 0 ? `${MIDS.length}个UID` : '未设置');
  console.error('N8N_WEBHOOK_URL:', N8N_URL ? '已设置' : '未设置');
  console.error('BILI_COOKIE:', COOKIE ? `已设置(长度${COOKIE.length})` : '未设置');
  process.exit(1);
}

console.log(`环境变量检查通过，共 ${MIDS.length} 个 UP 主`);
console.log('UID 列表:', MIDS.join(', '));

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Referer': 'https://www.bilibili.com/',
  'Cookie': COOKIE,
};

const allVideos = [];

try {
  // wbi keys 只需拿一次（全局的，不是 per-UP）
  await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
  console.log('延迟完成，获取 wbi keys...');

  const { imgKey, subKey } = await getWbiKeys(axios, headers);
  console.log('wbi keys 获取成功');

  for (let i = 0; i < MIDS.length; i++) {
    const mid = MIDS[i];
    console.log(`\n[${i + 1}/${MIDS.length}] 处理 UID: ${mid}`);

    // 每个 UP 主前等 2-5 秒
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));

    const params = signParams(
      { mid, ps: 30, pn: 1, order: 'pubdate' },
      imgKey,
      subKey
    );

    const query = Object.keys(params)
      .sort()
      .map(k => `${k}=${encodeURIComponent(params[k])}`)
      .join('&');
    const url = `https://api.bilibili.com/x/space/wbi/arc/search?${query}`;

    const { data } = await axios.get(url, { headers, timeout: 15000 });

    if (data.code !== 0) {
      console.error(`  UID ${mid} API错误: ${data.code} ${data.message}`);
      if (i < MIDS.length - 1) {
        console.log('  等待15秒切换下一个UP主...');
        await new Promise(r => setTimeout(r, 15000));
      }
      continue;
    }

    const vlist = data.data?.list?.vlist || [];
    const author = vlist.length > 0 ? vlist[0].author : `未知UP主_${mid}`;
    console.log(`  获取到 ${vlist.length} 个视频，UP主: ${author}`);
    if (vlist.length > 0) {
      console.log(`  最新: ${vlist[0].bvid} - ${vlist[0].title}`);
    }

    for (const v of vlist) {
      allVideos.push({
        bvid: v.bvid,
        title: v.title,
        created: v.created,
        mid: mid,
        author: author,
      });
    }

    // 跨 UP 主切换等待 15 秒
    if (i < MIDS.length - 1) {
      console.log('  等待15秒切换下一个UP主...');
      await new Promise(r => setTimeout(r, 15000));
    }
  }

  console.log(`\n===== 汇总 =====`);
  console.log(`共 ${allVideos.length} 个视频，来自 ${MIDS.length} 个 UP 主`);

  const byAuthor = {};
  for (const v of allVideos) {
    byAuthor[v.author] = (byAuthor[v.author] || 0) + 1;
  }
  for (const [author, count] of Object.entries(byAuthor)) {
    console.log(`  ${author}: ${count} 个视频`);
  }

  console.log(`\n发送到 n8n: ${N8N_URL}`);
  await axios.post(N8N_URL, { videos: allVideos }, { timeout: 30000 });
  console.log(`成功：已发送 ${allVideos.length} 条视频到 n8n`);

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

