import axios from 'axios';
import { getWbiKeys, signParams } from './wbi.js';

// BILI_MID 配置成逗号分隔多个 UID：316183842,13416784,...
const MIDS = (process.env.BILI_MID || '').split(',').map(s => s.trim()).filter(Boolean);
const N8N_URL = process.env.N8N_WEBHOOK_URL;
const COOKIE = process.env.BILI_COOKIE;

// ---------- 启动前 Cookie 校验 ----------
function validateCookie(cookie) {
  const required = ['buvid3', 'buvid4', 'SESSDATA', 'bili_jct', 'DedeUserID'];
  const missing = required.filter(k => !cookie.includes(`${k}=`));
  if (missing.length > 0) {
    console.error('===== Cookie 缺少关键字段 =====');
    console.error('缺少:', missing.join(', '));
    console.error('请在浏览器登录 B 站后，F12 → Application → Cookies 中完整复制以下字段：');
    console.error('  buvid3, buvid4, SESSDATA, bili_jct, DedeUserID');
    process.exit(1);
  }
}

// 请求头（Referer 与 space 接口匹配是关键）
function buildHeaders(mid) {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Referer': `https://space.bilibili.com/${mid}/`,
    'Origin': 'https://space.bilibili.com',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Cookie': COOKIE,
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const randomDelay = () => 20000 + Math.floor(Math.random() * 20000);

// 单次带重试的请求
async function fetchVideos(mid, imgKey, subKey, maxRetry = 2) {
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    try {
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
      const { data } = await axios.get(url, { headers: buildHeaders(mid), timeout: 15000 });
      if (data.code === 0) {
        return data.data?.list?.vlist || [];
      }
      if ([-352, -412, -799].includes(data.code)) {
        console.error(`  UID ${mid} 风控/限流 (${data.code})，第 ${attempt}/${maxRetry} 次尝试`);
        if (attempt < maxRetry) {
          const wait = randomDelay() + 10000;
          console.log(`  等待 ${(wait / 1000).toFixed(0)} 秒后重试...`);
          await sleep(wait);
          continue;
        }
        return null;
      }
      console.error(`  UID ${mid} API错误: ${data.code} ${data.message}`);
      return [];
    } catch (err) {
      console.error(`  UID ${mid} 网络异常: ${err.message}`);
      if (attempt < maxRetry) {
        await sleep(randomDelay());
        continue;
      }
      return null;
    }
  }
  return null;
}

// ---------- 主流程 ----------
const allVideos = [];
const failedMids = [];

try {
  if (MIDS.length === 0 || !N8N_URL || !COOKIE) {
    console.error('缺少环境变量：BILI_MID / N8N_WEBHOOK_URL / BILI_COOKIE');
    process.exit(1);
  }
  validateCookie(COOKIE);
  console.log(`环境变量检查通过，共 ${MIDS.length} 个 UP 主`);
  await sleep(2000 + Math.random() * 2000);
  const { imgKey, subKey } = await getWbiKeys(axios, buildHeaders(MIDS[0]));
  console.log('wbi keys 获取成功');

  // 第一轮：主循环
  for (let i = 0; i < MIDS.length; i++) {
    const mid = MIDS[i];
    console.log(`\n[${i + 1}/${MIDS.length}] 处理 UID: ${mid}`);
    const vlist = await fetchVideos(mid, imgKey, subKey);
    if (vlist === null) {
      console.log(`  UID ${mid} 加入重试队列`);
      failedMids.push(mid);
    } else if (vlist.length > 0) {
      const author = vlist[0].author;
      console.log(`  获取到 ${vlist.length} 个视频，UP主: ${author}`);
      console.log(`  最新: ${vlist[0].bvid} - ${vlist[0].title}`);
      for (const v of vlist) {
        allVideos.push({ bvid: v.bvid, title: v.title, created: v.created, mid, author });
      }
    }
    if (i < MIDS.length - 1) {
      const wait = randomDelay();
      console.log(`  等待 ${(wait / 1000).toFixed(0)} 秒切换下一个UP主...`);
      await sleep(wait);
    }
  }

  // 第二轮：重试 -352 的 UID
  if (failedMids.length > 0) {
    console.log(`\n===== 开始重试 ${failedMids.length} 个失败 UID =====`);
    for (const mid of failedMids) {
      console.log(`重试 UID: ${mid}`);
      await sleep(randomDelay() + 5000);
      const vlist = await fetchVideos(mid, imgKey, subKey, 1);
      if (vlist && vlist.length > 0) {
        const author = vlist[0].author;
        console.log(`  重试成功，获取到 ${vlist.length} 个视频`);
        for (const v of vlist) {
          allVideos.push({ bvid: v.bvid, title: v.title, created: v.created, mid, author });
        }
      } else {
        console.log(`  重试仍失败，跳过`);
      }
    }
  }

  console.log(`\n===== 汇总 =====`);
  console.log(`共 ${allVideos.length} 个视频，失败 ${failedMids.length} 个 UID`);
  await axios.post(N8N_URL, { videos: allVideos }, { timeout: 30000 });
  console.log(`成功：已发送 ${allVideos.length} 条视频到 n8n`);
} catch (err) {
  console.error('===== 执行失败 =====');
  console.error('错误信息:', err.message);
  process.exit(1);
}
