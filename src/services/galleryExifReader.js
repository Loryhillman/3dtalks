/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * Gallery EXIF date extraction.
 * Read a photo capture date from EXIF DateTimeOriginal.
 * Fall back to the file modification time when EXIF is unavailable.
 * 
 * Optional dependency: npm install exifr
 */

const fs = require('fs');
const path = require('path');

// Load optional EXIF support; otherwise use file modification times.
let exifr = null;
try {
    exifr = require('exifr');
} catch (e) {
    console.warn('[galleryExifReader] Optional exifr dependency unavailable; using file modification times.');
}

/**
 * Get the capture date for one photo.
 * @param {string} filePath - Full file path.
 * @returns {Promise<Date>} Capture date.
 */
async function getPhotoDate(filePath) {
    try {
        if (exifr) {
            const exifData = await exifr.parse(filePath, ['DateTimeOriginal']);
            if (exifData && exifData.DateTimeOriginal) {
                return new Date(exifData.DateTimeOriginal);
            }
        }
    } catch (err) {
        // EXIF parsing failed; fall back to the file modification time.
    }

    // Fall back to the file modification time.
    try {
        const stat = await fs.promises.stat(filePath);
        return stat.mtime;
    } catch (err) {
        return new Date(); // Last fallback: current time.
    }
}

/**
 * Get capture dates for a batch of photos.
 * @param {Array<{filePath: string}>} files - Photo file records.
 * @returns {Promise<Array<{filePath: string, photoDate: Date}>>}
 */
async function batchGetPhotoDates(files) {
    const results = [];
    for (const file of files) {
        const photoDate = await getPhotoDate(file.filePath);
        results.push({
            ...file,
            photoDate
        });
    }
    return results;
}

module.exports = { getPhotoDate, batchGetPhotoDates };
