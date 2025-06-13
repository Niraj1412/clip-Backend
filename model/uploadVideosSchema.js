const mongoose = require('mongoose');

if (mongoose.models.UploadedVideo) {
  module.exports = mongoose.models.UploadedVideo;
} else {
  const transcriptSegmentSchema = new mongoose.Schema({
    id: { type: String, default: () => `segment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` },
    text: { type: String, required: true },
    start: { type: Number, required: true, min: 0 }, // Seconds
    end: { type: Number, required: true, min: 0 }, // Seconds
    duration: { type: Number, min: 0 }, // Seconds
    confidence: Number,
    words: [{ text: String, start: Number, end: Number }],
  });

  const transcriptSchema = new mongoose.Schema({
    text: String,
    segments: [transcriptSegmentSchema],
    language: { type: String, default: 'en' },
  });

  const videoSchema = new mongoose.Schema({
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    videoUrl: {
      type: String,
      required: true,
    },
    source: {
      type: String,
      enum: ['youtube', 'upload'],
      required: true,
    }, // Added
    fileSize: {
      type: Number,
    },
    mimeType: {
      type: String,
    },
    thumbnailUrl: {
      type: String,
      default: '/default-thumbnail.jpg',
    },
    thumbnails: [
      {
        url: String,
        width: Number,
        height: Number,
        time: String,
      },
    ],
    status: {
      type: String,
      enum: ['uploading', 'uploaded', 'processing', 'processed', 'failed'],
      default: 'uploading',
    },
    transcript: transcriptSchema,
    processingError: {
      type: String,
    },
    duration: {
      type: Number,
      default: 0,
      get: v => Number((v || 0).toFixed(3)), // Seconds
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    processingCompletedAt: {
      type: Date,
    },
  });

  // Add index for better query performance
  videoSchema.index({ userId: 1 });
  videoSchema.index({ status: 1 });
  videoSchema.index({ createdAt: -1 });

  // Pre-save hook to validate transcript timestamps
  videoSchema.pre('save', function (next) {
    if (this.transcript?.segments?.length) {
      this.transcript.segments.forEach((segment, index) => {
        // Convert milliseconds to seconds if needed
        if (segment.start > 1000) {
          segment.start /= 1000;
        }
        if (segment.end > 1000) {
          segment.end /= 1000;
        }

        // Ensure end > start
        if (segment.end <= segment.start) {
          segment.end = segment.start + 1;
        }

        // Set duration
        segment.duration = Number((segment.end - segment.start).toFixed(3));

        // Clamp to video duration
        if (this.duration && segment.end > this.duration) {
          segment.end = this.duration;
          segment.duration = Number((segment.end - segment.start).toFixed(3));
        }
      });
    }
    next();
  });

  module.exports = mongoose.model('UploadedVideo', videoSchema);
}