const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

// Explicitly set FFmpeg paths
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// Verify FFmpeg installation at startup
ffmpeg.getAvailableFormats((err) => {
  if (err) {
    console.error('FFmpeg not found or not working:', err);
    console.error('Thumbnail generation will fail. Please ensure FFmpeg is properly installed');
  } else {
    console.log(`FFmpeg is available at: ${ffmpegPath}`);
    console.log('FFprobe is available at:', ffprobePath);
  }
});

const generateThumbnail = async (videoPath, outputPath) => {
  try {
    // Verify input file exists
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Input video file not found: ${videoPath}`);
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log(`Generating thumbnail for: ${videoPath}`);
    console.log(`Output will be saved to: ${outputPath}`);

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .on('start', (commandLine) => {
          console.log('FFmpeg command:', commandLine);
        })
        .on('progress', (progress) => {
          console.log(`Processing: ${Math.round(progress.percent)}% done`);
        })
        .on('end', () => {
          // Verify thumbnail was created
          if (!fs.existsSync(outputPath)) {
            throw new Error('Thumbnail file was not created');
          }

          const stats = fs.statSync(outputPath);
          if (stats.size === 0) {
            fs.unlinkSync(outputPath); // Clean up empty file
            throw new Error('Thumbnail file is empty (0 bytes)');
          }

          console.log(`Successfully generated thumbnail (${stats.size} bytes): ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error('FFmpeg processing error:', err);
          reject(new Error(`Thumbnail generation failed: ${err.message}`));
        })
        .screenshots({
          count: 1,
          timemarks: ['50%'], // Capture at midpoint by default
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
          size: '640x360', // 16:9 aspect ratio
          quality: 85 // Good quality JPEG
        });
    });
  } catch (error) {
    console.error('Thumbnail generation error:', error);
    throw error;
  }
};

const generateThumbnails = async (videoPath, outputDir, options = {}) => {
  const {
    count = 3,
    interval = 10, // seconds between thumbnails
    size = '320x180',
    quality = 80
  } = options;

  const thumbnails = [];
  const baseName = path.basename(videoPath, path.extname(videoPath));

  try {
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Get video duration to adjust our interval
    const duration = await new Promise((resolve) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          console.warn('Could not determine video duration, using default intervals');
          resolve(null);
        } else {
          resolve(metadata.format.duration);
        }
      });
    });

    const timestamps = [];
    if (duration) {
      // Spread thumbnails evenly based on duration
      const step = duration / (count + 1);
      for (let i = 1; i <= count; i++) {
        timestamps.push(step * i);
      }
    } else {
      // Fallback to fixed intervals
      for (let i = 1; i <= count; i++) {
        timestamps.push(i * interval);
      }
    }

    console.log(`Generating ${count} thumbnails at:`, timestamps.map(t => `${t.toFixed(1)}s`).join(', '));

    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .on('end', () => {
          // Verify all thumbnails were created
          const missing = timestamps.filter((_, i) => {
            const thumbPath = path.join(outputDir, `${baseName}_thumb_${i}.jpg`);
            return !fs.existsSync(thumbPath);
          });

          if (missing.length > 0) {
            reject(new Error(`Failed to generate thumbnails at positions: ${missing.join(', ')}`));
          } else {
            resolve();
          }
        })
        .on('error', reject)
        .screenshots({
          count,
          timemarks: timestamps.map(t => {
            const hours = Math.floor(t / 3600);
            const minutes = Math.floor((t % 3600) / 60);
            const seconds = Math.floor(t % 60);
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.000`;
          }),
          filename: `${baseName}_thumb_%i.jpg`,
          folder: outputDir,
          size,
          quality
        });
    });

    // Collect the generated thumbnails
    for (let i = 0; i < count; i++) {
      const thumbPath = path.join(outputDir, `${baseName}_thumb_${i}.jpg`);
      if (fs.existsSync(thumbPath)) {
        thumbnails.push(thumbPath);
      }
    }

    return thumbnails;
  } catch (error) {
    // Clean up any partial thumbnails
    thumbnails.forEach(thumb => {
      try {
        fs.unlinkSync(thumb);
      } catch (cleanupError) {
        console.error('Error cleaning up thumbnail:', cleanupError);
      }
    });
    throw error;
  }
};

module.exports = {
  generateThumbnail,
  generateThumbnails
};