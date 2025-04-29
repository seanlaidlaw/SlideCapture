// Perceptual hash implementation
const phash = (function () {
    // DCT implementation
    function dct(matrix) {
        const N = matrix.length;
        const result = new Array(N);

        for (let u = 0; u < N; u++) {
            result[u] = new Array(N);
            for (let v = 0; v < N; v++) {
                let sum = 0;
                for (let i = 0; i < N; i++) {
                    for (let j = 0; j < N; j++) {
                        sum += matrix[i][j] *
                            Math.cos((2 * i + 1) * u * Math.PI / (2 * N)) *
                            Math.cos((2 * j + 1) * v * Math.PI / (2 * N));
                    }
                }
                const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
                const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
                result[u][v] = 0.25 * cu * cv * sum;
            }
        }

        return result;
    }

    // Convert image data to grayscale matrix
    function toGrayscaleMatrix(pixels, width, height) {
        const matrix = new Array(32);
        const scaleX = width / 32;
        const scaleY = height / 32;

        for (let i = 0; i < 32; i++) {
            matrix[i] = new Array(32);
            for (let j = 0; j < 32; j++) {
                let sum = 0;
                let count = 0;

                // Average pixels in the scaled region
                for (let y = Math.floor(i * scaleY); y < Math.floor((i + 1) * scaleY) && y < height; y++) {
                    for (let x = Math.floor(j * scaleX); x < Math.floor((j + 1) * scaleX) && x < width; x++) {
                        sum += pixels[y * width + x];
                        count++;
                    }
                }

                matrix[i][j] = count > 0 ? sum / count : 0;
            }
        }

        return matrix;
    }

    // Calculate perceptual hash
    function calculate(pixels, width, height) {
        // Convert to 32x32 grayscale matrix
        const matrix = toGrayscaleMatrix(pixels, width, height);

        // Apply DCT
        const dctMatrix = dct(matrix);

        // Take top-left 8x8
        const hash = new Uint8Array(64);
        let index = 0;
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                hash[index++] = dctMatrix[i][j] > 0 ? 1 : 0;
            }
        }

        return hash;
    }

    // Compare two hashes
    function compare(hash1, hash2) {
        let same = 0;
        for (let i = 0; i < 64; i++) {
            if (hash1[i] === hash2[i]) same++;
        }
        return same / 64;
    }

    return {
        calculate,
        compare
    };
})();

module.exports = phash; 