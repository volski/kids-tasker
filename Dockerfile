# Production Dockerfile for Kids Tasker (Standalone Proxmox Edition)
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies (only production packages)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source code and assets
COPY server.js ./
COPY icons/ ./icons/
COPY tasks.example.json ./

# Create data directory for persistent tasks.json
RUN mkdir -p /app/data

# Environment configuration
ENV NODE_ENV=production \
    PORT=3000 \
    TASKS_FILE=/app/data/tasks.json

# Declare persistent volume for tasks storage
VOLUME ["/app/data"]

# Expose port
EXPOSE 3000

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/tasks || exit 1

# Start server
CMD ["node", "server.js"]
