# ClipSmart AI Backend

This is the backend for ClipSmart AI, a service that allows users to select, trim, and merge video clips from YouTube.

## Setup Instructions

1. Install Node.js and npm if you haven't already.
2. Install dependencies:
   ```bash
   npm install
   ```

3. Install FFmpeg (required for video processing):
   - **Windows**: Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to your PATH
   - **macOS**: `brew install ffmpeg`
   - **Linux**: `sudo apt install ffmpeg`

4. Create a `.env` file in the root directory with the following variables:
   ```
   PORT=4001
   MONGODB_URI=your_mongodb_connection_string
   AWS_ACCESS_KEY_ID=your_aws_access_key
   AWS_SECRET_ACCESS_KEY=your_aws_secret_key
   AWS_REGION=your_aws_region
   AWS_S3_BUCKET_NAME=your_s3_bucket_name
   ```

5. Make sure the following directories exist in the backend folder (create them if they don't):
   ```
   mkdir -p tmp output
   ```

## Required NPM Packages

Install the following npm packages:
```bash
npm install ytdl-core fluent-ffmpeg aws-sdk uuid rimraf mkdirp
```

## API Endpoints

### Clips Management

- **POST /api/clips/generateClip** - Generate a new clip
- **DELETE /api/clips/deleteClip/:id** - Delete a clip by ID
- **GET /api/clips/getClipsByVideoID/:videoID** - Get all clips for a video
- **PUT /api/clips/updateClip/:id** - Update a clip

### Clip Merging

- **POST /api/clips/mergingClips** - Process and merge multiple clips
  - Request body:
    ```json
    {
      "clips": [
        {
          "videoId": "YouTube_Video_ID",
          "startTime": 30,
          "endTime": 60
        },
        // More clips...
      ]
    }
    ```
  - Response:
    ```json
    {
      "success": true,
      "jobId": "uuid",
      "s3Url": "https://s3-url-to-merged-video.mp4",
      "videoPath": "local/path/to/video.mp4",
      "message": "Successfully processed and merged clips"
    }
    ```

## Important Notes

- The system requires FFmpeg to be installed and accessible from the command line
- Temporary files are stored in the `tmp` directory and final outputs in the `output` directory
- Video files can be large, so ensure you have enough disk space
- AWS S3 is used for video storage - make sure your bucket has the appropriate permissions 