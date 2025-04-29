// test/test_similarity.js
const fs = require('fs');
const path = require('path');
const assert = require('chai').assert;
const {
    createThumbnail,
    averageHash,
    ahashSimilarity,
    calculatePHash,
    calculateSimilarity
} = require('../src/image_utils');

const TEST_FOLDER = path.join(__dirname, 'ImagesTests/AllFrames/TransposableElementsInCancer');
const PHASH_THRESHOLD = 0.95;
const THUMBNAIL_SIZE = 64;

// Helper to extract slide iteration from filename
function getSlideIteration(filename) {
    const match = filename.match(/slide(\d+\.\d+)/);
    return match ? match[1] : null;
}

describe('Slide iteration visual identity', function () {
    this.timeout(20000); // Allow for image loading

    let files, groups, thumbs;

    before(async function () {
        files = fs.readdirSync(TEST_FOLDER)
            .filter(file => /\.(jpg|jpeg|png|webp)$/i.test(file))
            .sort();

        // Group files by slide iteration
        groups = {};
        for (const file of files) {
            const iter = getSlideIteration(file);
            if (iter) {
                if (!groups[iter]) groups[iter] = [];
                groups[iter].push(file);
            }
        }

        // Preload thumbnails for all files
        thumbs = {};
        for (const file of files) {
            thumbs[file] = await createThumbnail(path.join(TEST_FOLDER, file));
        }
    });

    it('should create thumbnails of the correct size', function () {
        for (const thumb of Object.values(thumbs)) {
            assert.strictEqual(thumb.width, THUMBNAIL_SIZE, 'Thumbnail width should be 64');
            assert.strictEqual(thumb.height, THUMBNAIL_SIZE, 'Thumbnail height should be 64');
        }
    });

    it('aHash and pHash should be deterministic', async function () {
        for (const [file, thumb] of Object.entries(thumbs)) {
            const ahash1 = averageHash(thumb, 8);
            const ahash2 = averageHash(thumb, 8);
            assert.deepEqual(ahash1, ahash2, `aHash not deterministic for ${file}`);
            const phash1 = calculatePHash(thumb);
            const phash2 = calculatePHash(thumb);
            assert.deepEqual(Array.from(phash1), Array.from(phash2), `pHash not deterministic for ${file}`);
        }
    });

    it('aHash and pHash should be robust to small changes', async function () {
        // For each image, make a copy with a single pixel changed and check similarity is still high
        for (const [file, thumb] of Object.entries(thumbs)) {
            // Clone the image data and change one pixel
            const altered = new Uint8ClampedArray(thumb.data);
            altered[0] = (altered[0] + 1) % 256; // Change R of first pixel
            const alteredThumb = {
                data: altered,
                width: thumb.width,
                height: thumb.height
            };
            const ahash1 = averageHash(thumb, 8);
            const ahash2 = averageHash(alteredThumb, 8);
            const ahashSim = ahashSimilarity(ahash1, ahash2);
            assert.isAtLeast(ahashSim, 0.95, `aHash not robust to small change for ${file}`);
            const phash1 = calculatePHash(thumb);
            const phash2 = calculatePHash(alteredThumb);
            const phashSim = calculateSimilarity(phash1, phash2);
            assert.isAtLeast(phashSim, 0.95, `pHash not robust to small change for ${file}`);
        }
    });

    it('should detect images with the same slide iteration as visually identical (aHash and pHash)', function () {
        for (const [iter, group] of Object.entries(groups)) {
            if (group.length < 2) continue;
            for (let i = 0; i < group.length; i++) {
                for (let j = i + 1; j < group.length; j++) {
                    const thumb1 = thumbs[group[i]];
                    const thumb2 = thumbs[group[j]];
                    const ahash1 = averageHash(thumb1, 8);
                    const ahash2 = averageHash(thumb2, 8);
                    const ahashSim = ahashSimilarity(ahash1, ahash2);
                    assert.strictEqual(ahashSim, 1, `aHash mismatch for ${group[i]} and ${group[j]} (slide ${iter})`);
                    const phash1 = calculatePHash(thumb1);
                    const phash2 = calculatePHash(thumb2);
                    const phashSim = calculateSimilarity(phash1, phash2);
                    assert.isAbove(phashSim, 0.95, `pHash mismatch for ${group[i]} and ${group[j]} (slide ${iter})`);
                }
            }
        }
    });

    it('should retain images with different slide iteration if pHash similarity < threshold', function () {
        // For each pair of images with different slide iteration, check if pHash similarity < threshold
        const groupKeys = Object.keys(groups);
        for (let i = 0; i < groupKeys.length; i++) {
            for (let j = i + 1; j < groupKeys.length; j++) {
                const groupA = groups[groupKeys[i]];
                const groupB = groups[groupKeys[j]];
                for (const fileA of groupA) {
                    for (const fileB of groupB) {
                        const thumbA = thumbs[fileA];
                        const thumbB = thumbs[fileB];
                        const ahashA = averageHash(thumbA, 8);
                        const ahashB = averageHash(thumbB, 8);
                        const ahashSim = ahashSimilarity(ahashA, ahashB);
                        if (ahashSim === 1) continue; // skip if aHash identical
                        const phashA = calculatePHash(thumbA);
                        const phashB = calculatePHash(thumbB);
                        const phashSim = calculateSimilarity(phashA, phashB);
                        // This is a soft check: at least some pairs should be below threshold
                        assert.isBelow(phashSim, 1, `pHash should not be 1 for different slide iterations: ${fileA} vs ${fileB}`);
                    }
                }
            }
        }
    });

    it('should not have false positives for very different images', function () {
        // Pick two images from different groups (if available)
        const groupKeys = Object.keys(groups);
        if (groupKeys.length < 2) return;
        const groupA = groups[groupKeys[0]];
        const groupB = groups[groupKeys[1]];
        const thumbA = thumbs[groupA[0]];
        const thumbB = thumbs[groupB[0]];
        const ahashA = averageHash(thumbA, 8);
        const ahashB = averageHash(thumbB, 8);
        const ahashSim = ahashSimilarity(ahashA, ahashB);
        assert.isBelow(ahashSim, 1, 'aHash should not be 1 for very different images');
        const phashA = calculatePHash(thumbA);
        const phashB = calculatePHash(thumbB);
        const phashSim = calculateSimilarity(phashA, phashB);
        assert.isBelow(phashSim, 1, 'pHash should not be 1 for very different images');
    });
});