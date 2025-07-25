const storageConfig = require('../config/storage');

class StorageService {
  constructor() {
    this.storage = storageConfig.getService();
    this.provider = storageConfig.getProvider();
    this.config = storageConfig.getStorageConfig();
  }

  async initialize() {
    if (this.storage && typeof this.storage.initialize === 'function') {
      return await this.storage.initialize();
    }
    return true;
  }

  async uploadVideo(fileBuffer, options = {}) {
    try {
      if (!this.storage) {
        throw new Error('Storage service not initialized');
      }

      const result = await this.storage.uploadVideo(fileBuffer, {
        ...options,
        provider: this.provider
      });

      // Add CDN URL if using Cloudflare
      if (this.provider === 'cloudflare') {
        result.cdnUrl = this.generateCDNUrl(result.fileName);
      }

      return result;
    } catch (error) {
      console.error('Storage service upload error:', error);
      throw error;
    }
  }

  async uploadImage(fileBuffer, options = {}) {
    try {
      if (!this.storage) {
        throw new Error('Storage service not initialized');
      }

      const result = await this.storage.uploadImage(fileBuffer, {
        ...options,
        provider: this.provider
      });

      // Add CDN URL if using Cloudflare
      if (this.provider === 'cloudflare') {
        result.cdnUrl = this.generateCDNUrl(result.fileName);
      }

      return result;
    } catch (error) {
      console.error('Storage service image upload error:', error);
      throw error;
    }
  }

  async deleteFile(fileName) {
    try {
      if (!this.storage) {
        throw new Error('Storage service not initialized');
      }

      return await this.storage.deleteFile(fileName);
    } catch (error) {
      console.error('Storage service delete error:', error);
      throw error;
    }
  }

  async getSignedUrl(fileName, options = {}) {
    try {
      if (!this.storage) {
        throw new Error('Storage service not initialized');
      }

      return await this.storage.getSignedUrl(fileName, options);
    } catch (error) {
      console.error('Storage service signed URL error:', error);
      throw error;
    }
  }

  async getFileMetadata(fileName) {
    try {
      if (!this.storage) {
        throw new Error('Storage service not initialized');
      }

      return await this.storage.getFileMetadata(fileName);
    } catch (error) {
      console.error('Storage service metadata error:', error);
      throw error;
    }
  }

  async listFiles(prefix = '', options = {}) {
    try {
      if (!this.storage) {
        throw new Error('Storage service not initialized');
      }

      return await this.storage.listFiles(prefix, options);
    } catch (error) {
      console.error('Storage service list files error:', error);
      throw error;
    }
  }

  generateCDNUrl(fileName) {
    if (this.provider === 'cloudflare') {
      const cloudflareConfig = require('../config/cloudflare');
      return cloudflareConfig.getPublicUrl(fileName);
    } else if (this.provider === 'gcp') {
      return `${this.config.cdnUrl}/${this.config.bucket}/${fileName}`;
    }
    
    return fileName;
  }

  getStreamingUrl(fileName, options = {}) {
    const cdnUrl = this.generateCDNUrl(fileName);
    
    // Add streaming parameters
    const params = new URLSearchParams({
      quality: options.quality || 'auto',
      t: Date.now(),
      platform: options.platform || 'web'
    });

    if (options.startTime) {
      params.set('start', options.startTime);
    }

    return `${cdnUrl}?${params.toString()}`;
  }

  async getStorageStats() {
    try {
      if (!this.storage) {
        throw new Error('Storage service not initialized');
      }

      if (typeof this.storage.getStorageStats === 'function') {
        return await this.storage.getStorageStats();
      }

      return {
        provider: this.provider,
        status: 'Storage stats not available for this provider'
      };
    } catch (error) {
      console.error('Storage service stats error:', error);
      throw error;
    }
  }

  async healthCheck() {
    try {
      if (!this.storage) {
        return { status: 'unhealthy', message: 'Storage service not initialized' };
      }

      if (typeof this.storage.healthCheck === 'function') {
        return await this.storage.healthCheck();
      }

      return { status: 'healthy', message: 'Storage service is running', provider: this.provider };
    } catch (error) {
      return { status: 'unhealthy', message: error.message, provider: this.provider };
    }
  }

  getProvider() {
    return this.provider;
  }

  getConfig() {
    return this.config;
  }
}

module.exports = new StorageService();