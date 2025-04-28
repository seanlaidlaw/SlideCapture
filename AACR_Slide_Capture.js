const similarity_threshold = 95;

// proportional crop of video element
let cropWidthPct = 0.75; // 75% of width
let cropHeightPct = 0.75; // 75% of height

// ——————————————————————————————————————————————————————————
// 1) Global state
// ——————————————————————————————————————————————————————————
// Create a Trusted Types policy (do this once, at the top of your script)
window.trustedTypesPolicy = window.trustedTypes?.createPolicy('default', {
  createScriptURL: (url) => url
});


let video = null;
let isWaitingForData = false;

const images = [];
const imageHashes = [];
let captureIntervalId = null;
let captureVideoElement = null; // ← user-selected override

// Global canvases for video frame, cropped area, and thumbnail
const sharedCanvas = document.createElement('canvas');
const sharedCtx = sharedCanvas.getContext('2d');


const cropCanvas = document.createElement('canvas');
cropCanvas.width = 962;
cropCanvas.height = 543;
const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });

const thumbCanvas = document.createElement('canvas');
thumbCanvas.width = thumbCanvas.height = 64;
const thumbCtx = thumbCanvas.getContext('2d', { willReadFrequently: true });

// Previous thumbnail to compare frames
let previousThumbData = null;

// ——————————————————————————————————————————————————————————
// 0) Video detection banner and polling
// ——————————————————————————————————————————————————————————
let videoDetectionIntervalId = null;
let videoBanner = null;
const MAX_POLL_TIME = 300000; // 5 minutes max polling
let pollStartTime = null;

function showNoVideoBanner() {
  if (videoBanner) return; // already shown
  videoBanner = document.createElement('div');
  videoBanner.innerHTML = '⚠️ Waiting for video content...<br><small>This banner will disappear when video is detected</small>';
  videoBanner.style.position = 'fixed';
  videoBanner.style.top = '0';
  videoBanner.style.left = '0';
  videoBanner.style.width = '100%';
  videoBanner.style.background = '#ffcc00';
  videoBanner.style.color = '#222';
  videoBanner.style.fontWeight = 'bold';
  videoBanner.style.fontSize = '18px';
  videoBanner.style.textAlign = 'center';
  videoBanner.style.padding = '12px 0';
  videoBanner.style.zIndex = '99999';
  document.body.appendChild(videoBanner);
}

function removeNoVideoBanner() {
  if (videoBanner) {
    videoBanner.remove();
    videoBanner = null;
  }
  if (videoDetectionIntervalId) {
    clearInterval(videoDetectionIntervalId);
    videoDetectionIntervalId = null;
  }
}

function pollForVideoAndStartCapture() {
  if (videoDetectionIntervalId !== null) {
    clearInterval(videoDetectionIntervalId); // Clear any existing interval
  }

  pollStartTime = Date.now();
  showNoVideoBanner(); // Show immediately

  videoDetectionIntervalId = setInterval(() => {
    // Check if we've exceeded max poll time
    if (Date.now() - pollStartTime > MAX_POLL_TIME) {
      clearInterval(videoDetectionIntervalId);
      videoDetectionIntervalId = null;
      if (videoBanner) {
        videoBanner.textContent = '⚠️ Video detection timed out after 5 minutes';
      }
      return;
    }

    const videos = document.querySelectorAll('video');
    if (videos.length > 0) {
      // Check if any video has actual content
      const hasContent = Array.from(videos).some(v =>
        v.readyState > 0 && v.videoWidth > 0 && v.videoHeight > 0
      );

      if (hasContent) {
        removeNoVideoBanner();
        selectDefaultVideo();
        startCapture();
      }
    } else {
      showNoVideoBanner();
    }
  }, 1000);
}

// ——————————————————————————————————————————————————————————
// 2) Helpers
// ——————————————————————————————————————————————————————————
function selectDefaultVideo() {
  const videos = document.querySelectorAll('video');
  if (videos.length === 0) {
    console.warn('⚠️ No <video> elements found on page.');
    video = null;
    return; // don't add listeners if not found
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
      const url = 'https://cdn.jsdelivr.net/npm/phash-js/dist/phash.js';
      if (window.trustedTypesPolicy) {
        s.src = window.trustedTypesPolicy.createScriptURL(url);
      } else {
        s.src = url;
      }
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }
}

async function ensureJSZip() {
  if (typeof JSZip === 'undefined') {
    await new Promise(resolve => {
      const s = document.createElement('script');
      const url = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.0/jszip.min.js';
      if (window.trustedTypesPolicy) {
        s.src = window.trustedTypesPolicy.createScriptURL(url);
      } else {
        s.src = url;
      }
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
    endCapture()
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

    if (!previousHash || similarity < similarity_threshold) {
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

  // Add overlay div to show cropped capture area
  if (video) {
    // Create controls container
    const controls = document.createElement('div');
    controls.id = 'crop-controls';
    controls.style.position = 'absolute';
    controls.style.display = 'flex';
    controls.style.gap = '10px';
    controls.style.padding = '5px';
    controls.style.background = 'rgba(0,0,0,0.7)';
    controls.style.borderRadius = '4px';
    controls.style.zIndex = '1002'; // Highest z-index
    controls.style.pointerEvents = 'auto'; // Allow clicks on controls
    
    // Width control
    const widthControl = document.createElement('div');
    widthControl.innerHTML = `
      <label style="color:white; font-size:12px">Width %:</label>
      <input type="number" min="10" max="100" value="${cropWidthPct*100}" 
             style="width:40px" id="crop-width-input">
    `;
    
    // Height control
    const heightControl = document.createElement('div');
    heightControl.innerHTML = `
      <label style="color:white; font-size:12px">Height %:</label>
      <input type="number" min="10" max="100" value="${cropHeightPct*100}" 
             style="width:40px" id="crop-height-input">
    `;
    
    controls.appendChild(widthControl);
    controls.appendChild(heightControl);
    
    // Create overlay div
    const overlay = document.createElement('div');
    overlay.id = 'capture-overlay';
    overlay.style.position = 'absolute';
    overlay.style.border = '3px solid red';
    overlay.style.borderRadius = '4px';
    overlay.style.boxSizing = 'border-box';
    overlay.style.zIndex = '1001'; // Above video but below controls
    
    // Function to update crop area
    const updateCropArea = () => {
      try {
        const widthInput = document.getElementById('crop-width-input');
        const heightInput = document.getElementById('crop-height-input');
        
        if (!widthInput || !heightInput || !video) return;
        
        const widthPct = Math.min(1, Math.max(0.1, parseInt(widthInput.value)/100));
        const heightPct = Math.min(1, Math.max(0.1, parseInt(heightInput.value)/100));
        
        // Update input values in case they were out of bounds
        widthInput.value = Math.round(widthPct * 100);
        heightInput.value = Math.round(heightPct * 100);
        
        const videoRect = video.getBoundingClientRect();
        const cropWidth = videoRect.width * widthPct;
        const cropHeight = videoRect.height * heightPct;
        const cropX = videoRect.width - cropWidth;
        const cropY = videoRect.height - cropHeight;
        
        overlay.style.width = `${cropWidth}px`;
        overlay.style.height = `${cropHeight}px`;
        overlay.style.left = `${cropX}px`;
        overlay.style.top = `${cropY}px`;
        
        // Update global crop percentages
        cropWidthPct = widthPct;
        cropHeightPct = heightPct;
      } catch (err) {
        console.error('Error updating crop area:', err);
      }
    };
    
    // Get input elements after they're added to DOM
    const widthInput = widthControl.querySelector('input');
    const heightInput = heightControl.querySelector('input');
    
    if (widthInput && heightInput) {
      // Add event listeners to inputs
      widthInput.addEventListener('change', updateCropArea);
      heightInput.addEventListener('change', updateCropArea);
      
      // Initial positioning
      updateCropArea();
    } else {
      console.error('Could not find crop percentage inputs');
    }
    
    // Make video container relative positioned and adjust z-index
    if (getComputedStyle(video.parentElement).position === 'static') {
      video.parentElement.style.position = 'relative';
    }
    video.style.zIndex = '1000'; // Ensure video is below overlay and controls
    
    // Position controls above overlay
    controls.style.bottom = `calc(100% + 5px)`;
    controls.style.left = '0';
    
    // Add elements to DOM
    const container = document.createElement('div');
    container.style.position = 'relative';
    container.appendChild(controls);
    container.appendChild(overlay);
    video.parentElement.appendChild(container);
  }

  captureIntervalId = setInterval(captureFrame, 1000);
  console.log('🟢 Started capturing unique frames every second');
}

async function endCapture() {
  if (captureIntervalId !== null) {
    clearInterval(captureIntervalId);
    captureIntervalId = null;
  }

  // Remove capture overlay and controls
  const container = video?.parentElement?.querySelector('div[style*="position: relative"]');
  if (container) {
    container.remove();
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

// ——————————————————————————————————————————————————————————
// 5) Auto-initiate video polling on script load
// ——————————————————————————————————————————————————————————
pollForVideoAndStartCapture();
