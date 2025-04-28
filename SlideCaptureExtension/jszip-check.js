// Check if JSZip is loaded
function checkJSZip() {
    if (typeof JSZip === 'undefined') {
        document.getElementById('error').textContent = 'Error: JSZip library failed to load. Please reload the extension.';
        document.getElementById('downloadFrames').disabled = true;
    } else {
        console.log('JSZip loaded successfully');
    }
}

// Run check when window loads
window.addEventListener('load', checkJSZip); 