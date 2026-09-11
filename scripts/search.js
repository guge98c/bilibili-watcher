import axios from 'axios';
import { getWbiKeys, signParams } from './wbi.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

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

const N8N_URL = 'https://ai.oobb.qzz.io/webhook/bilibili-watcher';

const COOKIE = 'buvid3=D3E23961-BFD5-5C64-DAF8-1371CDB8261780071infoc; buvid4=CE4467CA-4F93-3CEA-004A-9970DA36659082394-026060615-r4x7EIZOgb6tURYIJfBODg%3D%3D; SESSDATA=ceb9dce4%2C1804498821%2Cb3071%2A91CjBmJbvtk5CZel0x_HKzjIAdoism430ksv-wyQ59IiCx_rWZ-nLwf89QF7E28Oxh_twSVkVPeDYxSjhzMU9ocVExZ3ZXWl8yekgwcGdWdXdWOURJc1M2X2plRmcxeURLTzZDUWZlM2ZweGNEZE4xaG1kRlpaVFN0MlFlV3c4NkItdFBZOUd3QThBIIEC; bili_jct=59f22b08b79804f520aab06c8c1577df; DedeUserID=3706993527228838; DedeUserID__ckMd5=a2669e4df0efa26f';
// =================================================================

// ---------- 路径 ----------
const STATE_DIR = path.join(process.cwd(), 'state');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

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

// ---------- 状态读写 ----------
function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  console.log(`状态已写入 state/state.json (${Object.keys(state).length} 个 UP 主)`);
}

// ---------- 请求头 ----------
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

// ---------- 单次带重试的请求 ----------
async function fetchVideos(mid, imgKey, subKey, maxRetry = 2) {
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    try {
      const params = signParams(
        { mid, ps: 25, pn: 1, order: 'pubdate' },
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

// ---------- 增量过滤 ----------
// 列表按发布时间倒序（最新的在前），逐条与水位置对比：
//   - created > watermark.created       → 新视频，收下
//   - created === watermark.created && bvid !== watermark.bvid → 同一秒不同视频，收下
//   - 其他                              → 停止扫描（后面全是旧视频）
function filterNewVideos(vlist, stateEntry) {
  const newVideos = [];
  for (const v of vlist) {
    const created = Number(v.created) || 0;
    if (!stateEntry) {
      // 首次运行，无水位线 → 全部收录
      newVideos.push(v);
      continue;
    }
    const stateCreated = Number(stateEntry.created) || 0;
    if (created > stateCreated) {
      // 时间比水位线新 → 新视频
      newVideos.push(v);
    } else if (created === stateCreated && v.bvid !== stateEntry.bvid) {
      // 时间相同但 bvid 不同 → 新视频（同一秒发的另一条）
      newVideos.push(v);
    } else {
      // 时间等于或早于水位线 → 停止
      break;
    }
  }
  return newVideos;
}

// ---------- 提交状态到 Git ----------
// 4 个前提条件：
//   1. workflow 有 permissions: contents: write（否则 git push 403）
//   2. Actions runner 上需要 git 身份配置
//   3. "nothing to commit" 不会抛异常（用 || 短路）
//   4. git push origin HEAD 推当前分支，不写死 main
function commitState() {
  try {
    // 条件2：配置 git 身份
    execSync('git config user.name "github-actions[bot]"', { stdio: 'pipe' });
    execSync('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"', { stdio: 'pipe' });
    execSync('git add state/', { stdio: 'pipe' });
    // 条件3：没有变化时 diff 返回 0，|| 短路跳过 commit，整体退出码为 0
    execSync('git diff --cached --quiet || git commit -m "chore: update state" --no-verify', { stdio: 'pipe' });
    // 条件4：推当前分支，不写死 main
    const token = process.env.GITHUB_TOKEN || '';
    if (!token) {
      console.error('状态提交失败：未找到 GITHUB_TOKEN');
      return;
    }
    execSync(`git push https://x-access-token:${token}@github.com/guge98c/bilibili-watcher.git HEAD`, { stdio: 'pipe' });
    console.log('状态已提交回仓库');
  } catch (e) {
    // 提交失败不致命：下次运行会重发同样的视频，n8n 的 processedBvids 会去重
    console.error('状态提交失败（不影响本次数据）:', e.message.slice(0, 200));
  }
}


// ========== 主流程 ==========
const allVideos = [];
const failedMids = [];

try {
  validateCookie(COOKIE);
  console.log(`共 ${MIDS.length} 个 UP 主`);
  await sleep(2000 + Math.random() * 2000);

  const { imgKey, subKey } = await getWbiKeys(axios, buildHeaders(MIDS[0]));
  console.log('wbi keys 获取成功');

  const state = loadState();

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

      // 增量过滤
      const stateEntry = state[mid] || null;
      const newVideos = filterNewVideos(vlist, stateEntry);

      if (newVideos.length > 0) {
        console.log(`  其中 ${newVideos.length} 条是新视频`);
        for (const v of newVideos) {
          allVideos.push({ bvid: v.bvid, title: v.title, created: v.created, mid, author });
        }
      } else {
        console.log(`  无新视频`);
      }

      // 更新水位线（无论是否新视频，都用当前最新一条记录水位）
      state[mid] = {
        bvid: vlist[0].bvid,
        title: vlist[0].title,
        created: vlist[0].created,
        author: author,
        updatedAt: new Date().toISOString(),
      };
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

        const stateEntry = state[mid] || null;
        const newVideos = filterNewVideos(vlist, stateEntry);
        if (newVideos.length > 0) {
          console.log(`  其中 ${newVideos.length} 条是新视频`);
          for (const v of newVideos) {
            allVideos.push({ bvid: v.bvid, title: v.title, created: v.created, mid, author });
          }
        }
        // 重试成功也更新水位线
        state[mid] = {
          bvid: vlist[0].bvid,
          title: vlist[0].title,
          created: vlist[0].created,
          author: author,
          updatedAt: new Date().toISOString(),
        };
      } else {
        console.log(`  重试仍失败，跳过`);
      }
    }
  }

  // 保存状态
  saveState(state);

  console.log(`\n===== 汇总 =====`);
  console.log(`共 ${allVideos.length} 条新视频，${failedMids.length} 个 UID 失败`);

  // ★ 先发消息，再提交状态（顺序关键！）
  // 先发 n8n → 后 commit：如果 commit 失败，水位线没推进，下次运行重发同样的视频
  //   → n8n 的 processedBvids 拦住，不丢数据 ✅
  // 先 commit → 后发 n8n：如果 n8n 挂了，水位线已推进，这批视频永远不会再发 → 数据丢失 ❌
  if (allVideos.length > 0) {
    await axios.post(N8N_URL, { videos: allVideos }, { timeout: 30000 });
    console.log(`已发送 ${allVideos.length} 条视频到 n8n`);
  } else {
    console.log('无新视频，跳过 n8n 发送');
  }

  // 提交状态到仓库（Git 记忆闭环）
  commitState();

} catch (err) {
  console.error('===== 执行失败 =====');
  console.error('错误信息:', err.message);
  process.exit(1);
}
