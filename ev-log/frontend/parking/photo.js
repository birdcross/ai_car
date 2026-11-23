// 사진을 업로드 전에 줄입니다. (지하 주차장은 데이터 신호도 약해서 용량이 중요)
// 12MP 원본(약 3~5MB) → 긴 변 1600px JPEG(약 200~400KB). 캔버스로 다시 그리면서 EXIF도 제거됩니다.

const MAX_SIDE = 1600;
const QUALITY = 0.82;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('사진을 열 수 없어요. 다른 사진으로 시도해주세요.')); };
    img.src = url;
  });
}

/** @returns {Promise<string>} data:image/jpeg;base64,... */
export async function compressImage(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('사진 파일만 올릴 수 있어요.');
  if (file.size > 30 * 1024 * 1024) throw new Error('사진 용량이 너무 커요. (최대 30MB)');
  const img = await loadImage(file); // 최신 브라우저는 EXIF 회전값을 자동 반영
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', QUALITY);
}
