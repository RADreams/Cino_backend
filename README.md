# Cino Backend

A scalable backend for an entertainment shorts platform, built with Node.js, Express, MongoDB, Redis, and Google Cloud Platform (GCP).

## Features
- User management (anonymous and registered)
- Content management (movies, series, web-series)
- Episode and watchlist management
- Personalized and trending feeds
- Analytics and engagement tracking
- Admin dashboard APIs (content, analytics, cache, health)
- Scalable caching with Redis (local or Redis Cloud)
- Video and image storage on GCP

## Tech Stack
- Node.js, Express
- MongoDB (local, Atlas, or GCP VM)
- Redis (local or Redis Cloud)
- Google Cloud Storage
- Mongoose, Joi, Multer, JWT, etc.

## Setup Instructions

### 1. Clone the Repository
```sh
git clone <repo-url>
cd Cino_backend
```

### 2. Install Dependencies
```sh
npm install
```

### 3. Environment Variables
Create a `.env` file in the root with the following (example):
```
PORT=3000
MONGODB_URI=mongodb://localhost:27017/cino
REDIS_HOST=localhost
REDIS_PORT=6379
# REDIS_PASSWORD=yourpassword (if needed)
# REDIS_TLS=true (if using Redis Cloud)
JWT_SECRET=your_jwt_secret
GCP_BUCKET_NAME=your-gcp-bucket
GCP_PROJECT_ID=your-gcp-project-id
GCP_KEY_FILE=./cino-466113-f90e3e722bf7.json
MAX_FILE_SIZE=104857600
```

### 4. Start MongoDB and Redis
- **MongoDB:**
  - Local: `mongod`
  - Atlas/Cloud: Use your connection string
- **Redis:**
  - Local: `redis-server`
  - Cloud: Use Redis Cloud credentials and set `REDIS_TLS=true`

### 5. Start the Server
```sh
npm start
# or for development
npm run dev
```

### 6. API Documentation
See [`api_doc.md`](./api_doc.md) for a full list of endpoints, example requests, and responses.

## GCP Setup
- Place your GCP service account key JSON in the project root and set `GCP_KEY_FILE` in `.env`.
- Create a GCP Storage bucket and set `GCP_BUCKET_NAME`.

## Contribution Guidelines
- Fork the repo and create a feature branch.
- Write clear commit messages.
- Ensure code passes linting and tests.
- Submit a pull request with a clear description.

## License
MIT
