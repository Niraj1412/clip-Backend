const express = require('express');
const cors = require('cors');
const { connectDB } = require('./db');
const usersRoute = require('./routes/usersRoute');
const clipsRoute = require('./routes/clipsRoute');
const initialVersionRoute = require('./routes/initialVersion');
const mergeRoute = require('./routes/mergeRoute');
const projectRoutes = require('./routes/projectRoutes');
const healthRoute = require('./routes/healthRoute');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 4001;

const payloadLimit = '50mb';

// Configure CORS based on environment
const corsConfig = () => {
    // Check if we should allow all origins (useful for production)
    const allowAllOrigins = process.env.ALLOW_ALL_ORIGINS === 'true' || process.env.NODE_ENV === 'production';
    
    if (allowAllOrigins) {
        console.log('CORS: Allowing requests from all origins (production mode)');
        return {
            origin: true, 
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
            allowedHeaders: ['Content-Type', 'Authorization'],
            credentials: true
        };
    }
    
    // For development, use specific allowed origins
    const allowedOrigins = process.env.ALLOWED_ORIGINS ? 
        process.env.ALLOWED_ORIGINS.split(',') : 
        ['https://clip-frontend-niraj1412s-projects.vercel.app/','https://clip-frontend-three.vercel.app','http://localhost:3000', 'http://127.0.0.1:3000'];
    
    console.log('CORS: Allowing requests from specific origins:', allowedOrigins);
    return {
        origin: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true
    };
};

app.use(cors(corsConfig()));

app.use(express.json({
    limit: payloadLimit,
    extended: true,
    parameterLimit: 50000
}));

app.use(express.urlencoded({ 
    extended: true,
    limit: payloadLimit,
    parameterLimit: 50000
}));

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// Serve static files from the temp directory
app.use('/temp', express.static(path.join(__dirname, 'temp')));

// Add a route to check if a file exists
app.head('/temp/:jobId/merged.mp4', (req, res) => {
    const { jobId } = req.params;
    const filePath = path.join(__dirname, 'temp', jobId, 'merged.mp4');
    
    if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.size > 0) {
            res.setHeader('Content-Length', stats.size);
            res.setHeader('Content-Type', 'video/mp4');
            res.status(200).end();
        } else {
            res.status(404).end();
        }
    } else {
        res.status(404).end();
    }
});

// Routes
app.use('/api/v1/auth', usersRoute);
app.use('/api/clips', clipsRoute);
app.use('/api/v1/youtube', initialVersionRoute);
app.use('/api/merge', mergeRoute);
app.use('/api/projects', projectRoutes);
app.use('/api/v1/health', healthRoute);

if (process.env.NODE_ENV === 'production') {
    console.log('Serving static frontend files in production mode');
    
    // Serve static files from the React build directory
    app.use(express.static(path.join(__dirname, '../frontend/build')));
    
    app.get('*', (req, res) => {
        // Don't serve the React app for API routes or static files
        if (req.url.startsWith('/api/') || req.url.startsWith('/temp/')) {
            return res.status(404).json({ message: 'API endpoint not found' });
        }
        res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
    });
}

// Global error handler
app.use((err, req, res, next) => {
    console.error('Global error handler caught:', err);
    res.status(500).json({
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
    });
});

// Connect to MongoDB and start server
connectDB();

// Start the server - no need for .then as we handle connection errors separately
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});