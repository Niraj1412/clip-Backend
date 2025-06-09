FROM node:22

# Install system dependencies
RUN apt-get update && \
    apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create directory structure for uploads and thumbnails
RUN mkdir -p /tmp/uploads && \
    mkdir -p /tmp/thumbnails

WORKDIR /app

# First copy only package files for better caching
COPY package*.json ./

# Clean install with production-only dependencies
RUN npm ci --omit=optional --ignore-scripts

# Copy the rest of your application
COPY . .

# Create symlinks for consistent paths
RUN ln -s /tmp/uploads /backend/uploads && \
    ln -s /tmp/thumbnails /backend/thumbnails

# Environment variables
ENV UPLOAD_DIR=/tmp/uploads
ENV THUMBNAIL_DIR=/tmp/thumbnails
ENV NODE_ENV=production

EXPOSE 4001
CMD ["npm", "start"]