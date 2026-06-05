FROM node:20-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app

# Backend deps (prod only)
COPY package*.json ./
RUN npm ci --omit=dev

# Frontend deps (includes devDeps needed for Vite build)
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

# Copy all source files
COPY . .

# Build frontend → outputs to /app/public/
RUN cd frontend && npm run build

RUN mkdir -p /app/data
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "src/server.js"]
