const CloudflareService = require('../services/cloudflareService');
const GCPService = require('../services/gcpService');

class StorageConfig {
  constructor() {
    this.provider = process.env.STORAGE_PROVIDER || 'cloudflare';
    this.cdnProvider = process.env.CDN_PROVIDER || 'cloudflare';
    this.service = null;
    
    this.initializeService();
  }

  initializeService() {
    switch (this.provider.toLowerCase()) {
      case 'cloudflare':
        this.service = CloudflareService;
        break;
      case 'gcp':
        this.service = GCPService;
        break;
      default:
        console.warn(`Unknown storage provider: ${this.provider}. Defaulting to Cloudflare.`);
        this.service = CloudflareService;
    }
    
    console.log(`📦 Storage provider initialized: ${this.provider}`);
  }

  getService() {
    return this.service;
  }

  getProvider() {
    return this.provider;
  }

  getCDNProvider() {
    return this.cdnProvider;
  }

  // Switch storage provider at runtime (if needed)
  switchProvider(newProvider) {
    if (newProvider !== this.provider) {
      this.provider = newProvider;
      this.initializeService();
      console.log(`🔄 Switched storage provider to: ${newProvider}`);
    }
  }

  // Get storage configuration based on provider
  getStorageConfig() {
    const baseConfig = {
      provider: this.provider,
      cdnProvider: this.cdnProvider,
      maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 104857600,
      maxImageSize: parseInt(process.env.MAX_IMAGE_SIZE) || 5242880,
      supportedVideoFormats: ['.mp4', '.avi', '.mkv', '.mov'],
      supportedImageFormats: ['.jpg', '.jpeg', '.png', '.webp']
    };

    if (this.provider === 'cloudflare') {
      return {
        ...baseConfig,
        bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
        region: process.env.CLOUDFLARE_R2_REGION,
        publicUrl: process.env.CLOUDFLARE_R2_PUBLIC_URL,
        customDomain: process.env.CLOUDFLARE_CUSTOM_DOMAIN,
        accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID
      };
    } else if (this.provider === 'gcp') {
      return {
        ...baseConfig,
        bucket: process.env.GCP_BUCKET_NAME,
        projectId: process.env.GCP_PROJECT_ID,
        keyFile: process.env.GCP_KEY_FILE,
        cdnUrl: process.env.GCP_CDN_URL
      };
    }

    return baseConfig;
  }
}

module.exports = new StorageConfig();