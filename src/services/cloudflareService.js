const { 
  PutObjectCommand, 
  GetObjectCommand, 
  DeleteObjectCommand, 
  ListObjectsV2Command,
  HeadObjectCommand 
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const cloudflareConfig = require('../config/cloudflare');
const { generateRandomString } = require('../utils/helpers');

class CloudflareService {
  constructor() {
    this.client = null;
    this.config = null;
    this.initialized = false;
  }

  async initialize() {
    try {
      this.client = cloudflareConfig.getR2Client();
      this.config = cloudflareConfig.getConfig();
      
      if (!this.client) {
        throw new Error('Cloudflare R2 client not initialized');
      }

      // Test connection
      await this.client.send(new ListObjectsV2Command({
        Bucket: this.config.bucketName,
        MaxKeys: 1
      }));

      this.initialized = true;
      console.log('☁️ Cloudflare R2 service initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Cloudflare R2 initialization failed:', error);
      this.initialized = false;
      return false;
    }
  }

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

      const command = new PutObjectCommand({
        Bucket: this.config.bucketName,
        Key: fileName,
        Body: fileBuffer,
        ContentType: 'video/mp4',
        Metadata: {
          contentId: contentId || 'unknown',
          episodeNumber: episodeNumber?.toString() || '0',
          seasonNumber: seasonNumber?.toString() || '1',
          quality: quality || '720p',
          uploadedAt: new Date().toISOString(),
          originalName: originalName || 'unknown'
        }
      });

      await this.client.send(command);

      // Generate public URLs
      const publicUrl = cloudflareConfig.getPublicUrl(fileName);
      const cdnUrl = this.config.customDomain 
        ? `https://${this.config.customDomain}/${fileName}`
        : publicUrl;

      const result = {
        fileName,
        publicUrl,
        cdnUrl,
        size: fileBuffer.length,
        contentType: 'video/mp4',
        uploadedAt: new Date(),
        bucket: this.config.bucketName,
        provider: 'cloudflare',
        path: `videos/${contentId}/${seasonNumber}/`
      };

      console.log(`✅ Video uploaded to Cloudflare R2: ${fileName}`);
      return result;
    } catch (error) {
      console.error('❌ Cloudflare R2 video upload failed:', error);
      throw error;
    }
  }

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

      const command = new PutObjectCommand({
        Bucket: this.config.bucketName,
        Key: fileName,
        Body: fileBuffer,
        ContentType: `image/${extension}`,
        Metadata: {
          type: type || 'thumbnail',
          contentId: contentId || 'unknown',
          episodeId: episodeId || 'unknown',
          width: width?.toString() || '',
          height: height?.toString() || '',
          uploadedAt: new Date().toISOString(),
          originalName: originalName || 'unknown'
        }
      });

      await this.client.send(command);

      // Generate public URLs
      const publicUrl = cloudflareConfig.getPublicUrl(fileName);
      const cdnUrl = this.config.customDomain 
        ? `https://${this.config.customDomain}/${fileName}`
        : publicUrl;

      const result = {
        fileName,
        publicUrl,
        cdnUrl,
        size: fileBuffer.length,
        contentType: `image/${extension}`,
        uploadedAt: new Date(),
        provider: 'cloudflare',
        type,
        dimensions: width && height ? { width, height } : null
      };

      console.log(`✅ Image uploaded to Cloudflare R2: ${fileName}`);
      return result;
    } catch (error) {
      console.error('❌ Cloudflare R2 image upload failed:', error);
      throw error;
    }
  }

  async deleteFile(fileName) {
    try {
      await this.ensureInitialized();

      const command = new DeleteObjectCommand({
        Bucket: this.config.bucketName,
        Key: fileName
      });

      await this.client.send(command);
      console.log(`🗑️ File deleted from Cloudflare R2: ${fileName}`);
      
      return true;
    } catch (error) {
      if (error.name === 'NoSuchKey') {
        console.log(`⚠️ File not found for deletion: ${fileName}`);
        return true;
      }
      
      console.error('❌ Cloudflare R2 file deletion failed:', error);
      return false;
    }
  }

  async getSignedUrl(fileName, options = {}) {
    try {
      await this.ensureInitialized();

      const {
        expiresIn = 3600,
        responseContentType
      } = options;

      const command = new GetObjectCommand({
        Bucket: this.config.bucketName,
        Key: fileName,
        ...(responseContentType && { ResponseContentType: responseContentType })
      });

      const signedUrl = await getSignedUrl(this.client, command, { 
        expiresIn 
      });

      return signedUrl;
    } catch (error) {
      console.error('❌ Failed to generate Cloudflare R2 signed URL:', error);
      return null;
    }
  }

  async getFileMetadata(fileName) {
    try {
      await this.ensureInitialized();

      const command = new HeadObjectCommand({
        Bucket: this.config.bucketName,
        Key: fileName
      });

      const response = await this.client.send(command);
      
      return {
        name: fileName,
        size: response.ContentLength,
        contentType: response.ContentType,
        lastModified: response.LastModified,
        etag: response.ETag,
        metadata: response.Metadata || {},
        provider: 'cloudflare'
      };
    } catch (error) {
      console.error('❌ Failed to get Cloudflare R2 file metadata:', error);
      return null;
    }
  }

  async listFiles(prefix = '', options = {}) {
    try {
      await this.ensureInitialized();

      const {
        limit = 100,
        continuationToken
      } = options;

      const command = new ListObjectsV2Command({
        Bucket: this.config.bucketName,
        Prefix: prefix,
        MaxKeys: limit,
        ...(continuationToken && { ContinuationToken: continuationToken })
      });

      const response = await this.client.send(command);
      
      const files = (response.Contents || []).map(file => ({
        name: file.Key,
        publicUrl: cloudflareConfig.getPublicUrl(file.Key),
        cdnUrl: this.config.customDomain 
          ? `https://${this.config.customDomain}/${file.Key}`
          : cloudflareConfig.getPublicUrl(file.Key),
        lastModified: file.LastModified,
        size: file.Size,
        etag: file.ETag
      }));

      return {
        files,
        isTruncated: response.IsTruncated,
        nextContinuationToken: response.NextContinuationToken,
        totalCount: files.length
      };
    } catch (error) {
      console.error('❌ Error listing Cloudflare R2 files:', error);
      return { files: [], isTruncated: false, totalCount: 0 };
    }
  }

  async getStorageStats() {
    try {
      await this.ensureInitialized();

      const listCommand = new ListObjectsV2Command({
        Bucket: this.config.bucketName
      });

      let totalSize = 0;
      let totalFiles = 0;
      let videoCount = 0;
      let imageCount = 0;
      let otherCount = 0;
      let isTruncated = true;
      let continuationToken = undefined;

      while (isTruncated) {
        if (continuationToken) {
          listCommand.input.ContinuationToken = continuationToken;
        }

        const response = await this.client.send(listCommand);
        const files = response.Contents || [];

        files.forEach(file => {
          totalSize += file.Size || 0;
          totalFiles++;

          const fileName = file.Key.toLowerCase();
          if (fileName.includes('/videos/') || fileName.endsWith('.mp4') || fileName.endsWith('.avi')) {
            videoCount++;
          } else if (fileName.includes('/images/') || fileName.includes('/thumbnails/') || fileName.includes('/posters/')) {
            imageCount++;
          } else {
            otherCount++;
          }
        });

        isTruncated = response.IsTruncated || false;
        continuationToken = response.NextContinuationToken;
      }

      return {
        provider: 'cloudflare',
        bucket: this.config.bucketName,
        totalFiles,
        totalSize,
        totalSizeFormatted: this.formatBytes(totalSize),
        breakdown: {
          videos: videoCount,
          images: imageCount,
          others: otherCount
        },
        customDomain: this.config.customDomain,
        hasCustomDomain: !!this.config.customDomain
      };
    } catch (error) {
      console.error('❌ Error getting Cloudflare R2 storage stats:', error);
      return null;
    }
  }

  formatBytes(bytes, decimals = 2) {
    if (!bytes) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }

  async healthCheck() {
    try {
      await this.ensureInitialized();
      
      // Test basic operations
      const testFileName = `health-check-${Date.now()}.txt`;
      const testContent = Buffer.from('health check test');
      
      // Upload test file
      const putCommand = new PutObjectCommand({
        Bucket: this.config.bucketName,
        Key: testFileName,
        Body: testContent,
        ContentType: 'text/plain'
      });
      
      await this.client.send(putCommand);
      
      // Check if file exists
      const headCommand = new HeadObjectCommand({
        Bucket: this.config.bucketName,
        Key: testFileName
      });
      
      await this.client.send(headCommand);
      
      // Delete test file
      const deleteCommand = new DeleteObjectCommand({
        Bucket: this.config.bucketName,
        Key: testFileName
      });
      
      await this.client.send(deleteCommand);
      
      return {
        status: 'healthy',
        message: 'Cloudflare R2 is working properly',
        timestamp: new Date(),
        provider: 'cloudflare',
        bucket: this.config.bucketName,
        customDomain: this.config.customDomain
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error.message,
        timestamp: new Date(),
        provider: 'cloudflare',
        bucket: this.config.bucketName
      };
    }
  }

  async ensureInitialized() {
    if (!this.initialized) {
      const success = await this.initialize();
      if (!success) {
        throw new Error('Failed to initialize Cloudflare R2 service');
      }
    }
  }
}

module.exports = new CloudflareService();