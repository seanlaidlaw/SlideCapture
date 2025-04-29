const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const phash = require('./phash');
const { performance } = require('perf_hooks');

// Configuration
const TEST_FOLDER = '../ImagesTests/AllFrames/TransposableElementsInCancer';
const OUTPUT_FILE = 'similarity_results.tsv';
const THUMBNAIL_SIZE = 64;

// Helper function to create a fixed-size thumbnail
async function createThumbnail(imagePath) {
    const image = await loadImage(imagePath);
    const canvas = createCanvas(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(
        image,
        0, 0, image.width, image.height,
        0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE
    );
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// aHash helpers (copied from content.js)
function imageDataToCanvas(imageData) {
    const canvas = createCanvas(imageData.width, imageData.height);
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

function averageHash(imageData, size = 8) {
    // Downscale to size x size and grayscale
    const tmpCanvas = createCanvas(size, size);
    const tmpCtx = tmpCanvas.getContext('2d');
    tmpCtx.drawImage(
        imageDataToCanvas(imageData),
        0, 0, imageData.width, imageData.height,
        0, 0, size, size
    );
    const smallData = tmpCtx.getImageData(0, 0, size, size).data;
    let sum = 0;
    const grays = [];
    for (let i = 0; i < smallData.length; i += 4) {
        const gray = (smallData[i] + smallData[i + 1] + smallData[i + 2]) / 3;
        grays.push(gray);
        sum += gray;
    }
    const mean = sum / grays.length;
    // Build hash
    return grays.map(v => v > mean ? 1 : 0);
}

function ahashSimilarity(hash1, hash2) {
    let same = 0;
    for (let i = 0; i < hash1.length; i++) {
        if (hash1[i] === hash2[i]) same++;
    }
    return same / hash1.length;
}

// Calculate perceptual hash using phash library
function calculatePHash(imageData) {
    const pixels = new Uint8Array(imageData.data.length / 4);
    for (let i = 0; i < imageData.data.length; i += 4) {
        pixels[i / 4] = Math.floor((imageData.data[i] + imageData.data[i + 1] + imageData.data[i + 2]) / 3);
    }
    return phash.calculate(pixels, imageData.width, imageData.height);
}

// Calculate similarity between two hashes using phash
function calculateSimilarity(hash1, hash2) {
    return phash.compare(hash1, hash2);
}

async function runTests() {
    const files = fs.readdirSync(TEST_FOLDER)
        .filter(file => /\.(jpg|jpeg|png|webp)$/i.test(file))
        .sort();

    console.log(`Found ${files.length} images to test`);

    // Prepare results array
    const results = [];
    let totalAhashTime = 0;
    let totalPHashTime = 0;
    let comparisonCount = 0;

    // Process each pair of consecutive images
    for (let i = 0; i < files.length - 1; i++) {
        const currentFile = files[i];
        const nextFile = files[i + 1];

        try {
            const currentThumb = await createThumbnail(path.join(TEST_FOLDER, currentFile));
            const nextThumb = await createThumbnail(path.join(TEST_FOLDER, nextFile));

            // aHash comparison
            const ahashStart = performance.now();
            const ahash1 = averageHash(currentThumb, 8);
            const ahash2 = averageHash(nextThumb, 8);
            const ahashSim = ahashSimilarity(ahash1, ahash2);
            const ahashEnd = performance.now();
            totalAhashTime += (ahashEnd - ahashStart);

            let phashSim = null;
            let phashTime = 0;
            if (ahashSim < 1) {
                // Only compute phash if aHash is not a perfect match
                const phashStart = performance.now();
                const phash1 = calculatePHash(currentThumb);
                const phash2 = calculatePHash(nextThumb);
                phashSim = calculateSimilarity(phash1, phash2);
                const phashEnd = performance.now();
                phashTime = phashEnd - phashStart;
                totalPHashTime += phashTime;
            }

            comparisonCount++;

            results.push({
                image1: currentFile,
                image2: nextFile,
                ahashSimilarity: ahashSim.toFixed(4),
                ahashIdentical: ahashSim === 1,
                ahashTime: (ahashEnd - ahashStart).toFixed(4),
                phashSimilarity: phashSim !== null ? phashSim.toFixed(4) : '',
                phashTime: phashSim !== null ? phashTime.toFixed(4) : ''
            });

            console.log(`Compared ${currentFile} vs ${nextFile}: aHashSim=${ahashSim.toFixed(4)}${phashSim !== null ? `, pHashSim=${phashSim.toFixed(4)}` : ''}`);

        } catch (error) {
            console.error(`Error processing ${currentFile} and ${nextFile}:`, error);
        }
    }

    // Write results to TSV file
    const tsvContent = [
        'Image1\tImage2\tAHashSimilarity\tAHashIdentical\tAHashTime_ms\tPHashSimilarity\tPHashTime_ms',
        ...results.map(r =>
            `${r.image1}\t${r.image2}\t${r.ahashSimilarity}\t${r.ahashIdentical}\t${r.ahashTime}\t${r.phashSimilarity}\t${r.phashTime}`
        )
    ].join('\n');

    fs.writeFileSync(OUTPUT_FILE, tsvContent);
    console.log(`Results written to ${OUTPUT_FILE}`);
    console.log(`Average aHash time: ${(totalAhashTime / comparisonCount).toFixed(4)} ms`);
    if (totalPHashTime > 0) {
        console.log(`Average pHash time (when run): ${(totalPHashTime / comparisonCount).toFixed(4)} ms`);
    }
}

// Run the tests
runTests().catch(console.error);
