const { Storage } = require('@google-cloud/storage');
const { setCache, getCache, deleteCache } = require('../config/redis');
const { generateRandomString } = require('../utils/helpers');

class GCPService {
  constructor() {
    this.storage = null;
    this.bucket = null;
    this.initialized = false;
    this.bucketName = process.env.GCP_BUCKET_NAME;
    this.projectId = process.env.GCP_PROJECT_ID;
  }

  /**
   * Initialize Google Cloud Storage
   */
  async initialize() {
    try {
      if (this.initialized) return true;

      // Initialize Google Cloud Storage
      this.storage = new Storage({
        projectId: this.projectId,
        keyFilename: process.env.GCP_KEY_FILE,
      });

      // Get bucket reference
      this.bucket = this.storage.bucket(this.bucketName);

      // Test connection
      await this.bucket.getMetadata();
      
      this.initialized = true;
      console.log('☁️ Google Cloud Storage initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ GCP initialization failed:', error);
      this.initialized = false;
      return false;
    }
  }

  /**
   * Upload video file to GCP Storage
   */
  async uploadVideo(fileBuffer, options = {}) {
    try {
      await this.ensureInitialized();

      const {
        originalName,
        contentId,
        episodeNumber,
        seasonNumber = 1,
        quality = '720p'
      } = options;

      // Generate unique filename
      const timestamp = Date.now();
      const randomId = generateRandomString(8);
      const extension = originalName ? originalName.split('.').pop() : 'mp4';
      
      const fileName = `videos/${contentId}/${seasonNumber}/${episodeNumber}_${quality}_${timestamp}_${randomId}.${extension}`;

      const file = this.bucket.file(fileName);
      
      const stream = file.createWriteStream({
        metadata: {
          contentType: 'video/mp4',
          metadata: {
            contentId,
            episodeNumber: episodeNumber.toString(),
            seasonNumber: seasonNumber.toString(),
            quality,
            uploadedAt: new Date().toISOString(),
            originalName: originalName || 'unknown'
          }
        },
        resumable: true,
        validation: 'md5'
      });

      return new Promise((resolve, reject) => {
        stream.on('error', (error) => {
          console.error('❌ GCP video upload error:', error);
          reject(error);
        });

        stream.on('finish', async () => {
          try {
            // Make file publicly readable
            await file.makePublic();
            
            const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${fileName}`;
            
            const result = {
              fileName,
              publicUrl,
              size: fileBuffer.length,
              contentType: 'video/mp4',
              uploadedAt: new Date(),
              bucket: this.bucketName,
              path: `videos/${contentId}/${seasonNumber}/`
            };

            console.log(`✅ Video uploaded successfully: ${fileName}`);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        });

        stream.end(fileBuffer);
      });
    } catch (error) {
      console.error('❌ Video upload failed:', error);
      throw error;
    }
  }

  /**
   * Upload thumbnail/image to GCP Storage
   */
  async uploadImage(fileBuffer, options = {}) {
    try {
      await this.ensureInitialized();

      const {
        originalName,
        type = 'thumbnail',
        contentId,
        episodeId,
        width,
        height
      } = options;

      // Generate unique filename
      const timestamp = Date.now();
      const randomId = generateRandomString(6);
      const extension = originalName ? originalName.split('.').pop() : 'jpg';
      
      let fileName;
      if (type === 'thumbnail') {
        fileName = `thumbnails/${contentId}/${episodeId}_${timestamp}_${randomId}.${extension}`;
      } else if (type === 'poster') {
        fileName = `posters/${contentId}_${timestamp}_${randomId}.${extension}`;
      } else {
        fileName = `images/${type}/${timestamp}_${randomId}.${extension}`;
      }

      const file = this.bucket.file(fileName);
      
      const stream = file.createWriteStream({
        metadata: {
          contentType: `image/${extension}`,
          metadata: {
            type,
            contentId: contentId || 'unknown',
            episodeId: episodeId || 'unknown',
            width: width?.toString(),
            height: height?.toString(),
            uploadedAt: new Date().toISOString(),
            originalName: originalName || 'unknown'
          }
        },
        resumable: false,
        validation: 'md5'
      });

      return new Promise((resolve, reject) => {
        stream.on('error', (error) => {
          console.error('❌ GCP image upload error:', error);
          reject(error);
        });

        stream.on('finish', async () => {
          try {
            // Make file publicly readable
            await file.makePublic();
            
            const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${fileName}`;
            
            const result = {
              fileName,
              publicUrl,
              size: fileBuffer.length,
              contentType: `image/${extension}`,
              uploadedAt: new Date(),
              type,
              dimensions: width && height ? { width, height } : null
            };

            console.log(`✅ Image uploaded successfully: ${fileName}`);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        });

        stream.end(fileBuffer);
      });
    } catch (error) {
      console.error('❌ Image upload failed:', error);
      throw error;
    }
  }

  /**
   * Delete file from GCP Storage
   */
  async deleteFile(fileName) {
    try {
      await this.ensureInitialized();

      await this.bucket.file(fileName).delete();
      console.log(`🗑️ File deleted successfully: ${fileName}`);
      
      // Clear any cached URLs
      await deleteCache(`file_url:${fileName}`);
      
      return true;
    } catch (error) {
      if (error.code === 404) {
        console.log(`⚠️ File not found for deletion: ${fileName}`);
        return true; // Consider it successful if file doesn't exist
      }
      
      console.error('❌ GCP file deletion failed:', error);
      return false;
    }
  }

  /**
   * Get signed URL for secure file access
   */
  async getSignedUrl(fileName, options = {}) {
    try {
      await this.ensureInitialized();

      const {
        action = 'read',
        expires = 3600, // 1 hour default
        contentType
      } = options;

      // Check cache first
      const cacheKey = `signed_url:${fileName}:${expires}`;
      let signedUrl = await getCache(cacheKey);

      if (!signedUrl) {
        const file = this.bucket.file(fileName);
        
        const signedUrlOptions = {
          action,
          expires: Date.now() + expires * 1000,
        };

        if (contentType) {
          signedUrlOptions.contentType = contentType;
        }

        const [url] = await file.getSignedUrl(signedUrlOptions);
        signedUrl = url;

        // Cache for 80% of expiry time
        const cacheTime = Math.floor(expires * 0.8);
        await setCache(cacheKey, signedUrl, cacheTime);
      }

      return signedUrl;
    } catch (error) {
      console.error('❌ Failed to generate signed URL:', error);
      return null;
    }
  }

  /**
   * Get file metadata
   */
  async getFileMetadata(fileName) {
    try {
      await this.ensureInitialized();

      // Check cache first
      const cacheKey = `file_metadata:${fileName}`;
      let metadata = await getCache(cacheKey);

      if (!metadata) {
        const file = this.bucket.file(fileName);
        const [fileMetadata] = await file.getMetadata();
        
        metadata = {
          name: fileMetadata.name,
          size: parseInt(fileMetadata.size),
          contentType: fileMetadata.contentType,
          timeCreated: fileMetadata.timeCreated,
          updated: fileMetadata.updated,
          md5Hash: fileMetadata.md5Hash,
          bucket: fileMetadata.bucket,
          customMetadata: fileMetadata.metadata || {}
        };

        // Cache for 1 hour
        await setCache(cacheKey, metadata, 3600);
      }

      return metadata;
    } catch (error) {
      console.error('❌ Failed to get file metadata:', error);
      return null;
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(fileName) {
    try {
      await this.ensureInitialized();

      const file = this.bucket.file(fileName);
      const [exists] = await file.exists();
      return exists;
    } catch (error) {
      console.error('❌ Error checking file existence:', error);
      return false;
    }
  }

  /**
   * List files in a directory
   */
  async listFiles(prefix = '', options = {}) {
    try {
      await this.ensureInitialized();

      const {
        limit = 100,
        delimiter = '/'
      } = options;

      const [files] = await this.bucket.getFiles({
        prefix,
        delimiter,
        maxResults: limit
      });

      return files.map(file => ({
        name: file.name,
        publicUrl: `https://storage.googleapis.com/${this.bucketName}/${file.name}`,
        timeCreated: file.metadata.timeCreated,
        size: parseInt(file.metadata.size),
        contentType: file.metadata.contentType
      }));
    } catch (error) {
      console.error('❌ Error listing files:', error);
      return [];
    }
  }

  /**
   * Get streaming URL for video files
   */
  getStreamingUrl(fileName, options = {}) {
    const {
      quality = 'auto',
      startTime = 0,
      platform = 'web'
    } = options;

    const baseUrl = `https://storage.googleapis.com/${this.bucketName}/${fileName}`;
    
    // Add streaming parameters
    const params = new URLSearchParams({
      quality,
      t: Date.now(), // Cache busting
      platform
    });

    if (startTime > 0) {
      params.set('t', startTime);
    }

    return `${baseUrl}?${params.toString()}`;
  }

  /**
   * Batch upload multiple files
   */
  async batchUpload(files, options = {}) {
    try {
      await this.ensureInitialized();

      const {
        concurrency = 3,
        onProgress,
        onFileComplete
      } = options;

      const results = [];
      const errors = [];

      // Process files in batches
      for (let i = 0; i < files.length; i += concurrency) {
        const batch = files.slice(i, i + concurrency);
        
        const batchPromises = batch.map(async (fileData, index) => {
          try {
            let result;
            
            if (fileData.type === 'video') {
              result = await this.uploadVideo(fileData.buffer, fileData.options);
            } else if (fileData.type === 'image') {
              result = await this.uploadImage(fileData.buffer, fileData.options);
            } else {
              throw new Error(`Unknown file type: ${fileData.type}`);
            }

            results.push({ ...result, originalIndex: i + index });
            
            if (onFileComplete) {
              onFileComplete(result, i + index);
            }

            return result;
          } catch (error) {
            const errorInfo = {
              error: error.message,
              fileIndex: i + index,
              fileName: fileData.options?.originalName || 'unknown'
            };
            
            errors.push(errorInfo);
            return null;
          }
        });

        await Promise.allSettled(batchPromises);

        if (onProgress) {
          onProgress({
            completed: Math.min(i + concurrency, files.length),
            total: files.length,
            percentage: Math.round((Math.min(i + concurrency, files.length) / files.length) * 100)
          });
        }
      }

      return {
        successful: results,
        failed: errors,
        totalFiles: files.length,
        successCount: results.length,
        errorCount: errors.length
      };
    } catch (error) {
      console.error('❌ Batch upload failed:', error);
      throw error;
    }
  }

  /**
   * Copy file within bucket
   */
  async copyFile(sourceFileName, destinationFileName) {
    try {
      await this.ensureInitialized();

      const sourceFile = this.bucket.file(sourceFileName);
      const destinationFile = this.bucket.file(destinationFileName);

      await sourceFile.copy(destinationFile);
      
      console.log(`📋 File copied: ${sourceFileName} → ${destinationFileName}`);
      return true;
    } catch (error) {
      console.error('❌ File copy failed:', error);
      return false;
    }
  }

  /**
   * Move file within bucket
   */
  async moveFile(sourceFileName, destinationFileName) {
    try {
      await this.ensureInitialized();

      const sourceFile = this.bucket.file(sourceFileName);
      const destinationFile = this.bucket.file(destinationFileName);

      await sourceFile.move(destinationFile);
      
      console.log(`📁 File moved: ${sourceFileName} → ${destinationFileName}`);
      return true;
    } catch (error) {
      console.error('❌ File move failed:', error);
      return false;
    }
  }

  /**
   * Get storage usage statistics
   */
  async getStorageStats() {
    try {
      await this.ensureInitialized();

      const [files] = await this.bucket.getFiles();
      
      let totalSize = 0;
      let videoCount = 0;
      let imageCount = 0;
      let otherCount = 0;

      files.forEach(file => {
        const size = parseInt(file.metadata.size) || 0;
        totalSize += size;

        const contentType = file.metadata.contentType || '';
        if (contentType.startsWith('video/')) {
          videoCount++;
        } else if (contentType.startsWith('image/')) {
          imageCount++;
        } else {
          otherCount++;
        }
      });

      return {
        totalFiles: files.length,
        totalSize,
        totalSizeFormatted: this.formatBytes(totalSize),
        breakdown: {
          videos: videoCount,
          images: imageCount,
          others: otherCount
        },
        bucket: this.bucketName
      };
    } catch (error) {
      console.error('❌ Error getting storage stats:', error);
      return null;
    }
  }

  /**
   * Ensure GCP is initialized
   */
  async ensureInitialized() {
    if (!this.initialized) {
      const success = await this.initialize();
      if (!success) {
        throw new Error('Failed to initialize Google Cloud Storage');
      }
    }
  }

  /**
   * Format bytes to human readable format
   */
  formatBytes(bytes, decimals = 2) {
    if (!bytes) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }

  /**
   * Health check for GCP service
   */
  async healthCheck() {
    try {
      await this.ensureInitialized();
      
      // Test basic operations
      const testFileName = `health-check-${Date.now()}.txt`;
      const testContent = Buffer.from('health check test');
      
      // Upload test file
      const file = this.bucket.file(testFileName);
      await file.save(testContent);
      
      // Check if file exists
      const [exists] = await file.exists();
      
      // Delete test file
      await file.delete();
      
      return {
        status: exists ? 'healthy' : 'unhealthy',
        message: exists ? 'GCP Storage is working properly' : 'GCP Storage test failed',
        timestamp: new Date(),
        bucket: this.bucketName
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error.message,
        timestamp: new Date(),
        bucket: this.bucketName
      };
    }
  }
}

// Export singleton instance
module.exports = new GCPService();