// ——————————————————————————————————————————————————————————
// 0) Suppress ImageMagick ‘colors.xml’ warnings
// ——————————————————————————————————————————————————————————
window.Module = window.Module || {};
Module.printErr = msg => {
  if (!msg.includes("UnableToOpenConfigureFile")) {
    console.error(msg);
  }
};

// ——————————————————————————————————————————————————————————
// 1) Global state
// ——————————————————————————————————————————————————————————

let video = null;
let isWaitingForData = false;

const images = [];
const imageHashes = [];
let captureIntervalId = null;
let captureVideoElement = null; // ← user-selected override

// Global canvases for video frame, cropped area, and thumbnail
const sharedCanvas = document.createElement('canvas');
const sharedCtx = sharedCanvas.getContext('2d');

// 2) compute proportional crop: bottom-right ~75% width, ~75% height
const cropWidthPct = 0.75; // 75% of width
const cropHeightPct = 0.75; // 75% of height


const cropCanvas = document.createElement('canvas');
cropCanvas.width = 962;
cropCanvas.height = 543;
const cropCtx = cropCanvas.getContext('2d');

const thumbCanvas = document.createElement('canvas');
thumbCanvas.width = thumbCanvas.height = 64;
const thumbCtx = thumbCanvas.getContext('2d');

// Previous thumbnail to compare frames
let previousThumbData = null;



// ——————————————————————————————————————————————————————————
// 2) Helpers
// ——————————————————————————————————————————————————————————
function selectDefaultVideo() {
  const videos = document.querySelectorAll('video');
  if (videos.length === 0) {
    console.warn('⚠️ No <video> elements found on page.');
    video = null;
  } else {
    video = videos[0];
    console.log('🎬 Selected default video:', video);
  }

  // once `video` is set we add listener to change flag when video is buffering
  video.addEventListener("waiting", () => {
    isWaitingForData = true;
  });
  video.addEventListener("playing", () => {
    isWaitingForData = false;
  });
}

async function ensurePHash() {
  if (typeof pHash === 'undefined') {
    await new Promise(resolve => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/phash-js/dist/phash.js';
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }
}

async function ensureJSZip() {
  if (typeof JSZip === 'undefined') {
    await new Promise(resolve => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.0/jszip.min.js';
      s.onload = resolve;
      document.head.appendChild(s);
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
// 3) Frame capture
// ——————————————————————————————————————————————————————————
async function captureFrame() {
  if (!video) {
    console.warn('⚠️ No video selected; stopping capture.');
    clearInterval(captureIntervalId);
    captureIntervalId = null;
    return;
  }

  // skip processing if video buffering
  if (isWaitingForData) {
    // console.log("⏭️ Skipped frame because video is waiting for data");
    return;
  }

  if (video.paused || video.ended) {
    console.log('⏹ Video paused/ended; stopping capture.');
    clearInterval(captureIntervalId);
    captureIntervalId = null;
    return;
  }

  // 1) draw full frame into sharedCanvas
  sharedCanvas.width = video.videoWidth;
  sharedCanvas.height = video.videoHeight;
  sharedCtx.drawImage(video, 0, 0, sharedCanvas.width, sharedCanvas.height);

  // 2) now crop: bottom-right 962×543 from 1280×720
  const cropWidth = Math.floor(sharedCanvas.width * cropWidthPct);
  const cropHeight = Math.floor(sharedCanvas.height * cropHeightPct);
  const cropX = sharedCanvas.width - cropWidth;
  const cropY = sharedCanvas.height - cropHeight;

  // Update the cropCanvas size dynamically (optional, if input changes)
  if (cropCanvas.width !== cropWidth || cropCanvas.height !== cropHeight) {
    cropCanvas.width = cropWidth;
    cropCanvas.height = cropHeight;
  }

  // draw the cropped portion
  cropCtx.clearRect(0, 0, cropWidth, cropHeight);
  cropCtx.drawImage(
    sharedCanvas,
    cropX, cropY, cropWidth, cropHeight, // source rectangle
    0, 0, cropWidth, cropHeight          // destination rectangle
  );


  // 3) draw scaled 64x64 thumbnail from cropped canvas
  thumbCtx.clearRect(0, 0, 64, 64);
  thumbCtx.drawImage(
    cropCanvas,
    0, 0, cropCanvas.width, cropCanvas.height,
    0, 0, 64, 64
  );

  // 4) get thumbnail pixel data
  const thumbData = thumbCtx.getImageData(0, 0, 64, 64).data;

  // 5) compare to previous; skip if identical
  if (previousThumbData) {
    let identical = true;
    for (let i = 0; i < thumbData.length; i++) {
      if (thumbData[i] !== previousThumbData[i]) {
        identical = false;
        break;
      }
    }
    if (identical) {
      // console.log('⚪ Thumbnail unchanged; skipping pHash');
      return;
    }
  }
  // update for next frame
  previousThumbData = thumbData;

  // 6) encode and run pHash only when content changed
  const croppedWebpDataURL = cropCanvas.toDataURL('image/webp', 0.9);
  const croppedPNGDataURL = cropCanvas.toDataURL('image/png');
  const file = dataURLtoFile(croppedPNGDataURL, `frame-${Date.now()}.png`);

  // compute pHash
  try {
    const hashObj = await pHash.hash(file);
    const currentHash = hashObj.toBinary();
    const previousHash = imageHashes[imageHashes.length - 1] || null;
    const similarity = calcSimilarity(currentHash, previousHash);

    if (!previousHash || similarity < 95) {
      imageHashes.push(currentHash);
      images.push(croppedWebpDataURL);
      console.log(`✅ Captured #${images.length} (sim=${similarity.toFixed(1)}%)`);
    } else {
      // console.log(`⚪ Skipped duplicate frame (sim=${similarity.toFixed(1)}%)`);
    }
  } catch (err) {
    console.error('pHash error:', err);
  }
}

// ——————————————————————————————————————————————————————————
// 4) startCapture() / endCapture()
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

async function endCapture() {
  if (captureIntervalId !== null) {
    clearInterval(captureIntervalId);
    captureIntervalId = null;
  }

  console.log(`📥 Zipping ${images.length} frames…`);
  await ensureJSZip();

  const zip = new JSZip();
  const imgFolder = zip.folder('images');

  images.forEach((dataURL, idx) => {
    const base64 = dataURL.split(',')[1];
    imgFolder.file(`frame-${idx + 1}.webp`, base64, { base64: true });
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);

  // trigger a single download
  const a = document.createElement('a');
  a.href = url;
  a.download = 'frames.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // clean up
  URL.revokeObjectURL(url);
  console.log('✅ All frames zipped and download started');
}
