import crypto from 'node:crypto';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52
];

function getMixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.map(n => orig[n]).join('').slice(0, 32);
}

export async function getWbiKeys(axios, headers) {
  const { data } = await axios.get(
    'https://api.bilibili.com/x/web-interface/nav',
    { headers }
  );
  return {
    imgKey: data.data.wbi_img.img_url.split('/').pop().split('.')[0],
    subKey: data.data.wbi_img.sub_url.split('/').pop().split('.')[0],
  };
}

export function signParams(params, imgKey, subKey) {
  const mixinKey = getMixinKey(imgKey + subKey);
  const wts = Math.floor(Date.now() / 1000);
  const merged = { ...params, wts };
  const query = Object.keys(merged)
    .sort()
    .map(k => {
      const v = String(merged[k]).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    })
    .join('&');
  const w_rid = crypto.createHash('md5').update(query + mixinKey).digest('hex');
  return { ...merged, w_rid };
}
