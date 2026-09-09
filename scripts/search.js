import axios from 'axios';
import { getWbiKeys, signParams } from './wbi.js';

// ==================== 硬编码配置（直接改这里）====================
const MIDS = [
  '3691012801169602',
  '316183842',
  '13416784',
  '3546884870244925',
  '3546830396721763',
  '28554995',
  '474921808',
  '28357052',
  '14848367',
  '67079745',
  '14739873',
  '1387592680',
  '14842663',
  '37663924',
  '520155988',
  '119801456',
  '598464467',
  '615957867',
  '356634017',
  '1815948385',
  '473168952',
].map(s => s.trim()).filter(Boolean);

const N8N_URL = 'http://ai.oobb.qzz.io:5678/webhook-test/bilibili-watcher';

const COOKIE = 'buvid3=D3E23961-BFD5-5C64-DAF8-1371CDB8261780071infoc; buvid4=CE4467CA-4F93-3CEA-004A-9970DA36659082394-026060615-r4x7EIZOgb6tURYIJfBODg%3D%3D; SESSDATA=ceb9dce4%2C1804498821%2Cb3071%2A91CjBmJbvtk5CZel0x_HKzjIAdoism430ksv-wyQ59IiCx_rWZ-nLwf89QF7E28Oxh_twSVkVPeDYxSjhzMU9ocVExZ3ZXWl8yekgwcGdWdXdWOURJc1M2X2plRmcxeURLTzZDUWZlM2ZweGNEZE4xaG1kRlpaVFN0MlFlV3c4NkItdFBZOUd3QThBIIEC; bili_jct=59f22b08b79804f520aab06c8c1577df; DedeUserID=3706993527228838; DedeUserID__ckMd5=a2669e4df0efa26f';
// =================================================================

// ---------- Cookie 校验 ----------
function validateCookie(cookie) {
  const required = ['buvid3', 'buvid4', 'SESSDATA', 'bili_jct', 'DedeUserID'];
  const missing = required.filter(k => !cookie.includes(`${k}=`));
  if (missing.length > 0) {
    console.error('===== Cookie 缺少关键字段 =====');
    console.error('缺少:', missing.join(', '));
    process.exit(1);
  }
}

// 请求头（Referer 指向 space 页面，与接口匹配）
function buildHeaders(mid) {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Referer': \,
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
        .map(k => \)
        .join('&');
      const url = \;
      const { data } = await axios.get(url, { headers: buildHeaders(mid), timeout: 15000 });
      if (data.code === 0) {
        return data.data?.list?.vlist || [];
      }
      if ([-352, -412, -799].includes(data.code)) {
        console.error(\);
        if (attempt < maxRetry) {
          const wait = randomDelay() + 10000;
          console.log(\);
          await sleep(wait);
          continue;
        }
        return null;
      }
      console.error(\);
      return [];
    } catch (err) {
      console.error(\);
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
  validateCookie(COOKIE);
  console.log(\);
  await sleep(2000 + Math.random() * 2000);
  const { imgKey, subKey } = await getWbiKeys(axios, buildHeaders(MIDS[0]));
  console.log('wbi keys 获取成功');

  // 第一轮：主循环
  for (let i = 0; i < MIDS.length; i++) {
    const mid = MIDS[i];
    console.log(\);
    const vlist = await fetchVideos(mid, imgKey, subKey);
    if (vlist === null) {
      console.log(\);
      failedMids.push(mid);
    } else if (vlist.length > 0) {
      const author = vlist[0].author;
      console.log(\);
      console.log(\);
      for (const v of vlist) {
        allVideos.push({ bvid: v.bvid, title: v.title, created: v.created, mid, author });
      }
    }
    if (i < MIDS.length - 1) {
      const wait = randomDelay();
      console.log(\);
      await sleep(wait);
    }
  }

  // 第二轮：重试 -352 的 UID
  if (failedMids.length > 0) {
    console.log(\);
    for (const mid of failedMids) {
      console.log(\);
      await sleep(randomDelay() + 5000);
      const vlist = await fetchVideos(mid, imgKey, subKey, 1);
      if (vlist && vlist.length > 0) {
        const author = vlist[0].author;
        console.log(\);
        for (const v of vlist) {
          allVideos.push({ bvid: v.bvid, title: v.title, created: v.created, mid, author });
        }
      } else {
        console.log(\);
      }
    }
  }

  console.log(\);
  console.log(\);
  await axios.post(N8N_URL, { videos: allVideos }, { timeout: 30000 });
  console.log(\);
} catch (err) {
  console.error('===== 执行失败 =====');
  console.error('错误信息:', err.message);
  process.exit(1);
}
