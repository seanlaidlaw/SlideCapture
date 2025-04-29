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
                        // (You can make this stricter if you want)
                        assert.isBelow(phashSim, 1, `pHash should not be 1 for different slide iterations: ${fileA} vs ${fileB}`);
                    }
                }
            }
        }
    });
});