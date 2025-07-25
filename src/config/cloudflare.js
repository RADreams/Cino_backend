const { S3Client } = require('@aws-sdk/client-s3');
const axios = require('axios');

class CloudflareConfig {
  constructor() {
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    this.r2AccessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    this.r2SecretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    this.bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
    this.region = process.env.CLOUDFLARE_R2_REGION || 'auto';
    this.zoneId = process.env.CLOUDFLARE_ZONE_ID;
    this.apiToken = process.env.CLOUDFLARE_API_TOKEN;
    this.customDomain = process.env.CLOUDFLARE_CUSTOM_DOMAIN;
    this.publicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL;
    
    this.r2Client = null;
    this.cdnClient = null;
    
    this.initializeR2();
    this.initializeCDN();
  }

  initializeR2() {
    try {
      this.r2Client = new S3Client({
        region: this.region,
        endpoint: `https://${this.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: this.r2AccessKeyId,
          secretAccessKey: this.r2SecretAccessKey,
        },
        forcePathStyle: true,
      });
      
      console.log('☁️ Cloudflare R2 client initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Cloudflare R2 client:', error);
    }
  }

  initializeCDN() {
    if (this.apiToken) {
      this.cdnClient = axios.create({
        baseURL: 'https://api.cloudflare.com/client/v4',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log('🌐 Cloudflare CDN client initialized successfully');
    } else {
      console.warn('⚠️ Cloudflare API token not provided, CDN features disabled');
    }
  }

  getR2Client() {
    return this.r2Client;
  }

  getCDNClient() {
    return this.cdnClient;
  }

  getConfig() {
    return {
      accountId: this.accountId,
      bucketName: this.bucketName,
      region: this.region,
      zoneId: this.zoneId,
      customDomain: this.customDomain,
      publicUrl: this.publicUrl,
      hasApiToken: !!this.apiToken
    };
  }

  // Generate R2 endpoint URL
  getR2Endpoint() {
    return `https://${this.accountId}.r2.cloudflarestorage.com`;
  }

  // Generate public URL for files
  getPublicUrl(filename) {
    if (this.customDomain) {
      return `https://${this.customDomain}/${filename}`;
    } else if (this.publicUrl) {
      return `${this.publicUrl}/${filename}`;
    } else {
      return `https://${this.bucketName}.${this.accountId}.r2.cloudflarestorage.com/${filename}`;
    }
  }

  // Get CDN cache settings
  getCDNSettings() {
    return {
      browserCacheTtl: 31536000,  // 1 year
      edgeCacheTtl: 7776000,      // 90 days
      cacheLevel: 'aggressive',
      alwaysOnline: true,
      minTlsVersion: '1.2',
      automaticHttpsRewrites: true,
      ssl: 'flexible'
    };
  }
}

module.exports = new CloudflareConfig();