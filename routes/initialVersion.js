const router = require("express").Router();
const { 
    getTranscript, 
    getAuthUrl, 
    oauth2Client,
    getVideoDetails  // Make sure this is imported
} = require("../controllers/initialVersion/getTranscript");
const getVideoIDByPlaylist = require("../controllers/initialVersion/getVideoIDByPlaylist");
const generateClips = require("../controllers/initialVersion/generateClips");
const getDetailsByVideoID = require("../controllers/initialVersion/getDetailsByVideoID");
const { processClip } = require("../controllers/clipsMergeController/apifyMergeClips");
const addFinalVideo = require("../controllers/initialVersion/addfinalVideo");
const getPublishedVideosByUserID = require("../controllers/publishedVideoController/getPublishedVideosByUserID");

// Simple test endpoint to verify connectivity
router.get('/ping', (req, res) => {
    res.status(200).json({ 
        success: true, 
        message: 'Backend server is running',
        timestamp: new Date().toISOString()
    });
});

router.get('/auth', (req, res) => {
    const authUrl = getAuthUrl();
    res.redirect(authUrl);
});

router.get('/oauth2callback', async (req, res) => {
    const { code } = req.query;
    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        res.redirect('https://clip-frontend-three.vercel.app');
    } catch (error) {
        console.error('Error getting OAuth tokens:', error);
        res.status(500).json({ error: 'Failed to authenticate' });
    }
});

router.post("/playlist/:playlistId", getVideoIDByPlaylist);

router.post("/video/:videoId", async (req, res) => {
    try {
        // First get video details to check if transcript is available
        const videoDetails = await getVideoDetails(req.params.videoId);
        
        if (!videoDetails.exists) {
            return res.status(404).json({
                message: "Video not found",
                status: false
            });
        }

        if (videoDetails.captionStatus === 'disabled') {
            return res.status(400).json({
                message: "Transcripts are disabled for this video",
                status: false,
                videoDetails: {
                    title: videoDetails.title,
                    channel: videoDetails.channelTitle,
                    duration: videoDetails.duration
                }
            });
        }
        
        // If captions might be available, proceed to get transcript
        return await getTranscript(req, res);
    } catch (error) {
        console.error("Error in video endpoint:", error);
        return res.status(500).json({
            message: "Failed to process video request",
            error: error.message,
            status: false
        });
    }
});

router.post("/generateClips", generateClips);
router.post("/details/:videoId", getDetailsByVideoID);
router.get("/download", processClip);
router.post("/addFinalVideo", addFinalVideo);
router.get("/getPublishedVideosByUserID/:userId", getPublishedVideosByUserID);

module.exports = router;