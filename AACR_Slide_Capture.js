// ——————————————————————————————————————————————————————————
// 0) Suppress those ImageMagick ‘colors.xml’ warnings
//    by feeding an empty printErr handler into the Module that
//    magick.js will attach to.
// ——————————————————————————————————————————————————————————
window.Module = window.Module || {};
Module.printErr = msg => {
  // swallow only the missing-colors.xml warning; re-throw others if you like
  if (!msg.includes("UnableToOpenConfigureFile")) {
    console.error(msg);
  }
};

// ——————————————————————————————————————————————————————————
// 1) Global state
// ——————————————————————————————————————————————————————————
const images = [];
const imageHashes = [];
let captureIntervalId = null;

// ——————————————————————————————————————————————————————————
// 2) Helpers
// ——————————————————————————————————————————————————————————
async function ensurePHash() {
  if (typeof pHash === 'undefined') {
    await new Promise(resolve => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/phash-js/dist/phash.js';
      script.onload = resolve;
      document.head.appendChild(script);
    });
  }
}

function dataURLtoFile(dataurl, filename) {
  const [hdr, b64] = dataurl.split(',');
  const mime = hdr.match(/:(.*?);/)[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], filename, { type: mime });
}

function calcSimilarity(h1, h2) {
  if (!h2 || h1.length !== h2.length) return 0;
  let same = 0;
  for (let i = 0; i < h1.length; i++) {
    if (h1[i] === h2[i]) same++;
  }
  return (same / h1.length) * 100;
}

function downloadDataURL(dataURL, filename) {
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ——————————————————————————————————————————————————————————
// 3) Capture one frame, hash it, and store only if it’s new
// ——————————————————————————————————————————————————————————
async function captureFrame() {
  const video = document.querySelector('video');
  if (!video) {
    console.warn('⚠️ No <video> element found; stopping capture.');
    clearInterval(captureIntervalId);
    captureIntervalId = null;
    return;
  }
  // if (video.paused || video.ended) {
  //   console.log('⏹ Video paused/ended; stopping capture.');
  //   clearInterval(captureIntervalId);
  //   captureIntervalId = null;
  //   return;
  // }

  // draw to canvas
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

  // extract PNG dataURL & wrap as File
  const dataURL = canvas.toDataURL('image/png');
  const file = dataURLtoFile(dataURL, `frame-${Date.now()}.png`);

  // compute pHash
  try {
    const hashObj = await pHash.hash(file);
    const currentHash = hashObj.toBinary();
    const previousHash = imageHashes[imageHashes.length - 1] || null;
    const similarity = calcSimilarity(currentHash, previousHash);

    if (!previousHash || similarity < 95) {
      imageHashes.push(currentHash);
      images.push(dataURL);
      console.log(`✅ Captured #${images.length} (sim=${similarity.toFixed(1)}%)`);
    } else {
      console.log(`⚪ Skipped duplicate (sim=${similarity.toFixed(1)}%)`);
    }
  } catch (err) {
    console.error('pHash error:', err);
  }
}

// ——————————————————————————————————————————————————————————
// 4) startCapture() and endCapture()
// ——————————————————————————————————————————————————————————
async function startCapture() {
  await ensurePHash();
  if (captureIntervalId !== null) {
    console.warn('⚠️ Capture already running');
    return;
  }
  images.length = 0;
  imageHashes.length = 0;
  captureIntervalId = setInterval(captureFrame, 1000);
  console.log('🟢 Started capturing unique frames every second');
}

function endCapture() {
  if (captureIntervalId !== null) {
    clearInterval(captureIntervalId);
    captureIntervalId = null;
  }
  console.log(`📥 Downloading ${images.length} frames…`);
  images.forEach((dataURL, idx) => {
    downloadDataURL(dataURL, `frame-${idx + 1}.png`);
  });
  console.log('✅ All frames downloaded');
}
