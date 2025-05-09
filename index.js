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

// Enhanced CORS configuration
const corsConfig = () => {
    const productionOrigins = [
        'https://clip-frontend-three.vercel.app',
        'https://clip-frontend-niraj1412s-projects.vercel.app',
        
    ];
    
    const developmentOrigins = [
        'http://localhost:3000',
        'http://127.0.0.1:3000'
    ];

    const allowedOrigins = process.env.ALLOWED_ORIGINS 
        ? process.env.ALLOWED_ORIGINS.split(',') 
        : [...productionOrigins, ...developmentOrigins];

    console.log('CORS: Allowing requests from:', allowedOrigins);
    
    return {
        origin: function (origin, callback) {
            // Allow requests with no origin (like mobile apps or curl requests)
            if (!origin) return callback(null, true);
            
            if (process.env.ALLOW_ALL_ORIGINS === 'true') {
                return callback(null, true);
            }

            if (allowedOrigins.some(allowed => {
                return origin === allowed || 
                       origin.startsWith(allowed) ||
                       origin.includes(allowed.replace('https://', '').replace('http://', ''));
            })) {
                return callback(null, true);
            }

            const msg = `CORS blocked for origin: ${origin}`;
            console.warn(msg);
            return callback(new Error(msg));
        },
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
        optionsSuccessStatus: 200 // For legacy browser support
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

// Enhanced request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`, {
        headers: req.headers,
        body: req.body
    });
    next();
});

// Ensure temp directory exists
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`Created temp directory at: ${tempDir}`);
}

// Serve static files from the temp directory
app.use('/temp', express.static(tempDir, {
    setHeaders: (res, path) => {
        if (path.endsWith('.mp4')) {
            res.setHeader('Content-Type', 'video/mp4');
        }
    }
}));

// Enhanced route to check if a file exists
app.head('/temp/:jobId/merged.mp4', (req, res) => {
    const { jobId } = req.params;
    const filePath = path.join(tempDir, jobId, 'merged.mp4');
    
    try {
        if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            if (stats.size > 0) {
                res.setHeader('Content-Length', stats.size);
                res.setHeader('Content-Type', 'video/mp4');
                return res.status(200).end();
            }
        }
        res.status(404).end();
    } catch (error) {
        console.error('Error checking file:', error);
        res.status(500).end();
    }
});

// API routes
app.use('/api/v1/auth', usersRoute);
app.use('/api/clips', clipsRoute);
app.use('/api/v1/youtube', initialVersionRoute);
app.use('/api/merge', mergeRoute);
app.use('/api/projects', projectRoutes);
app.use('/api/v1/health', healthRoute);

// Production-specific configuration
if (process.env.NODE_ENV === 'production') {
    console.log('Running in production mode');
    
    // Optional: Redirect root requests to your Vercel frontend
    app.get('/', (req, res) => {
        res.redirect('https://clip-frontend-three.vercel.app');
    });

    // Optional: Health check endpoint for production monitoring
    app.get('/status', (req, res) => {
        res.status(200).json({ 
            status: 'ok',
            timestamp: new Date().toISOString() 
        });
    });
}

// Enhanced global error handler
app.use((err, req, res, next) => {
    console.error('Global error handler caught:', {
        error: err,
        url: req.originalUrl,
        method: req.method,
        headers: req.headers
    });

    // Handle CORS errors
    if (err.message && err.message.includes('CORS blocked')) {
        return res.status(403).json({
            success: false,
            message: 'Forbidden - origin not allowed',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }

    res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// 404 handler (only for API routes)
app.use('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'API endpoint not found'
    });
});

// Connect to MongoDB and start server
const startServer = async () => {
    try {
        await connectDB(); // Make sure connectDB returns a promise or is async
        app.listen(port, () => {
            console.log(`Server running on port ${port}`);
            console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`Allowed Origins: ${process.env.ALLOWED_ORIGINS || 'default'}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
};

startServer();

module.exports = app;