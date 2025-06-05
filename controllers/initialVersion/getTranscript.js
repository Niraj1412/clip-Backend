const { google } = require('googleapis');
const { YoutubeTranscript } = require('youtube-transcript');
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

const PYTHON_API = process.env.PYTHON_API || 'https://clip-py-backend-production.up.railway.app';
const APPLICATION_URL = process.env.APPLICATION_URL || 'https://clip-backend-production.up.railway.app';

// Configure global settings for Google APIs
google.options({
    http2: true,
    headers: {
        'Referer': APPLICATION_URL,
        'Origin': APPLICATION_URL
    }
});

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${APPLICATION_URL}/api/v1/youtube/oauth2callback`
);

const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
});

axios.defaults.headers.common['Referer'] = APPLICATION_URL;
axios.defaults.headers.common['Origin'] = APPLICATION_URL;

function getAuthUrl() {
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/youtube.force-ssl']
    });
}

async function getVideoDetails(videoId) {
    try {
        const response = await youtube.videos.list({
            part: 'snippet,contentDetails',
            id: videoId
        });

        if (!response.data.items?.length) {
            return { exists: false };
        }

        const video = response.data.items[0];
        return {
            exists: true,
            title: video.snippet.title,
            description: video.snippet.description,
            publishedAt: video.snippet.publishedAt,
            channelId: video.snippet.channelId,
            channelTitle: video.snippet.channelTitle,
            duration: video.contentDetails.duration,
            captionStatus: video.contentDetails.caption || 'unknown'
        };
    } catch (error) {
        console.error("Error fetching video details:", error.message);
        return { error: error.message };
    }
}

async function fetchYoutubeTranscriptDirectly(videoId, lang = 'en') {
    try {
        const transcript = await YoutubeTranscript.fetchTranscript(videoId, {
            lang: lang
        });
        return {
            success: true,
            data: transcript.map(item => ({
                text: item.text,
                start: item.offset / 1000, // Convert ms to seconds
                duration: item.duration / 1000 // Convert ms to seconds
            })),
            source: 'youtube-transcript-api'
        };
    } catch (error) {
        console.error(`YouTube-transcript error (${lang}):`, error.message);
        return {
            success: false,
            error: error.message,
            source: 'youtube-transcript-api'
        };
    }
}

async function fetchFromPythonAPI(videoId) {
    try {
        if (!PYTHON_API) {
            throw new Error('Python API URL not configured');
        }
        const response = await axios.get(`${PYTHON_API}/transcript/${videoId}`);
        return {
            success: true,
            data: response.data?.data || null,
            source: 'python-api'
        };
    } catch (error) {
        console.error('Python API error:', error.message);
        return {
            success: false,
            error: error.message,
            source: 'python-api'
        };
    }
}

const getTranscript = async (req, res) => {
    try {
        const { videoId } = req.params;
        console.log("---->", videoId);

        // Validate input
        if (!videoId) {
            return res.status(400).json({
                message: "Video ID is required",
                status: false
            });
        }

        if (!process.env.YOUTUBE_API_KEY) {
            return res.status(500).json({
                message: "Server configuration error: YouTube API key is missing",
                status: false
            });
        }

        // Get video details first
        const videoDetails = await getVideoDetails(videoId);
        if (!videoDetails.exists) {
            return res.status(404).json({
                message: "Video not found or is not accessible",
                status: false
            });
        }
        
        console.log(`Video found: ${videoDetails.title}`);

        // If we know captions are disabled, return early
        if (videoDetails.captionStatus === 'disabled') {
            return res.status(400).json({
                message: "Transcripts are disabled for this video",
                status: false,
                videoDetails
            });
        }

        // Attempt to fetch transcript using multiple methods
        const methods = [
            { name: 'Python API', fn: () => fetchFromPythonAPI(videoId) },
            { name: 'YouTube Transcript (English)', fn: () => fetchYoutubeTranscriptDirectly(videoId, 'en') },
            { name: 'YouTube Transcript (any language)', fn: () => fetchYoutubeTranscriptDirectly(videoId) }
        ];

        let transcriptResult = null;
        const attempts = [];

        for (const method of methods) {
            console.log(`Trying ${method.name}...`);
            const result = await method.fn();
            attempts.push({
                method: method.name,
                success: result.success,
                source: result.source,
                error: result.error
            });

            if (result.success && result.data) {
                transcriptResult = result;
                break;
            }
        }

        if (!transcriptResult || !transcriptResult.data || transcriptResult.data.length === 0) {
            return res.status(404).json({
                message: "No transcript available for this video using any method",
                status: false,
                videoDetails,
                attempts
            });
        }

        return res.status(200).json({
            message: "Transcript fetched successfully",
            data: transcriptResult.data,
            status: true,
            source: transcriptResult.source,
            totalSegments: transcriptResult.data.length,
            videoDetails,
            attempts
        });

    } catch (error) {
        console.error("Unexpected error:", {
            message: error.message,
            stack: error.stack,
            videoId: req.params.videoId
        });

        return res.status(500).json({
            message: "Failed to fetch transcript",
            error: error.message,
            status: false
        });
    }
};

module.exports = { getTranscript, getAuthUrl, oauth2Client, getVideoDetails };