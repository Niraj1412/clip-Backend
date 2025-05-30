const { google } = require('googleapis');
const { YoutubeTranscript } = require('youtube-transcript');
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

const PYTHON_API = process.env.PYTHON_API || ''; // Make optional
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

// Set default axios configuration
axios.defaults.headers.common['Referer'] = APPLICATION_URL;
axios.defaults.headers.common['Origin'] = APPLICATION_URL;
axios.defaults.timeout = 10000; // 10 second timeout

function getAuthUrl() {
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/youtube.force-ssl']
    });
}

async function fetchYoutubeTranscriptDirectly(videoId, lang = 'en') {
    try {
        const transcript = await YoutubeTranscript.fetchTranscript(videoId, {
            lang: lang
        });
        return transcript.map(item => ({
            text: item.text,
            start: item.offset / 1000, // Convert ms to seconds
            duration: item.duration / 1000 // Convert ms to seconds
        }));
    } catch (error) {
        console.error(`YouTube-transcript error (${lang}):`, error.message);
        return null;
    }
}

async function fetchFromPythonAPI(videoId) {
    try {
        if (!PYTHON_API) {
            console.log('Python API not configured, skipping...');
            return null;
        }
        
        const response = await axios.get(`${PYTHON_API}/transcript/${videoId}`, {
            timeout: 5000 // 5 second timeout
        });
        
        if (!response.data?.success) {
            throw new Error('Python API returned unsuccessful response');
        }
        
        return response.data.data || null;
    } catch (error) {
        console.error('Python API error:', error.message);
        return null;
    }
}

const getTranscript = async (req, res) => {
    try {
        const { videoId } = req.params;
        console.log("Processing YouTube video:", videoId);

        // Validate input
        if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
            return res.status(400).json({
                message: "Invalid YouTube video ID",
                status: false
            });
        }

        // Verify video exists
        try {
            const videoResponse = await youtube.videos.list({
                part: 'snippet',
                id: videoId,
                fields: 'items(id,snippet(title))'
            });

            if (!videoResponse.data.items?.length) {
                return res.status(404).json({
                    message: "Video not found or is not accessible",
                    status: false
                });
            }
            
            const videoTitle = videoResponse.data.items[0].snippet.title;
            console.log(`Video found: ${videoTitle}`);
        } catch (error) {
            console.error("Error checking video existence:", error.message);
            return res.status(500).json({
                message: "Failed to verify video existence",
                error: error.message,
                status: false
            });
        }

        // Attempt to fetch transcript using multiple methods
        let transcriptList = null;
        const methods = [
            { name: 'YouTube Transcript (English)', fn: () => fetchYoutubeTranscriptDirectly(videoId, 'en') },
            { name: 'YouTube Transcript (any language)', fn: () => fetchYoutubeTranscriptDirectly(videoId) }
        ];

        // Only try Python API if configured
        if (PYTHON_API) {
            methods.unshift({ name: 'Python API', fn: () => fetchFromPythonAPI(videoId) });
        }

        for (const method of methods) {
            console.log(`Trying ${method.name}...`);
            transcriptList = await method.fn();
            if (transcriptList) {
                console.log(`Success with ${method.name}`);
                break;
            }
        }

        if (!transcriptList || transcriptList.length === 0) {
            return res.status(404).json({
                message: "No transcript available for this video. The video might not have captions enabled.",
                status: false,
                availableMethodsTried: methods.map(m => m.name)
            });
        }

        return res.status(200).json({
            message: "Transcript fetched successfully",
            data: transcriptList,
            status: true,
            totalSegments: transcriptList.length
        });

    } catch (error) {
        console.error("Unexpected error:", error);
        return res.status(500).json({
            message: "Internal server error while processing transcript",
            error: error.message,
            status: false
        });
    }
};

module.exports = { getTranscript, getAuthUrl, oauth2Client };