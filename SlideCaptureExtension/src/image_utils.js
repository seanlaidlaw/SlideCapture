// src/image_utils.js
const { createCanvas, loadImage } = require('canvas');
const phash = require('./phash');

const THUMBNAIL_SIZE = 64;

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

function imageDataToCanvas(imageData) {
    const canvas = createCanvas(imageData.width, imageData.height);
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

function averageHash(imageData, size = 8) {
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
    return grays.map(v => v > mean ? 1 : 0);
}

function ahashSimilarity(hash1, hash2) {
    let same = 0;
    for (let i = 0; i < hash1.length; i++) {
        if (hash1[i] === hash2[i]) same++;
    }
    return same / hash1.length;
}

function calculatePHash(imageData) {
    const pixels = new Uint8Array(imageData.data.length / 4);
    for (let i = 0; i < imageData.data.length; i += 4) {
        pixels[i / 4] = Math.floor((imageData.data[i] + imageData.data[i + 1] + imageData.data[i + 2]) / 3);
    }
    return phash.calculate(pixels, imageData.width, imageData.height);
}

function calculateSimilarity(hash1, hash2) {
    return phash.compare(hash1, hash2);
}

module.exports = {
    createThumbnail,
    averageHash,
    ahashSimilarity,
    calculatePHash,
    calculateSimilarity
};