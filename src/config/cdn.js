const cloudflareConfig = require('./cloudflare');
const axios = require('axios');

class CDNConfig {
  constructor() {
    this.provider = process.env.CDN_PROVIDER || 'cloudflare';
    this.initializeCDN();
  }

  initializeCDN() {
    switch (this.provider.toLowerCase()) {
      case 'cloudflare':
        this.cdnService = cloudflareConfig;
        break;
      case 'gcp':
        // GCP CDN configuration would go here
        this.cdnService = null;
        break;
      default:
        console.warn(`Unknown CDN provider: ${this.provider}`);
        this.cdnService = null;
    }
  }

  async purgeCache(urls) {
    if (this.provider === 'cloudflare' && this.cdnService.getCDNClient()) {
      try {
        const response = await this.cdnService.getCDNClient().post(
          `/zones/${this.cdnService.getConfig().zoneId}/purge_cache`,
          {
            files: Array.isArray(urls) ? urls : [urls]
          }
        );
        
        console.log(`🗑️ CDN cache purged for ${urls.length || 1} files`);
        return response.data;
      } catch (error) {
        console.error('❌ CDN cache purge failed:', error.response?.data || error.message);
        throw error;
      }
    }
    
    return null;
  }

  async setCacheRules(rules) {
    if (this.provider === 'cloudflare' && this.cdnService.getCDNClient()) {
      try {
        const response = await this.cdnService.getCDNClient().post(
          `/zones/${this.cdnService.getConfig().zoneId}/pagerules`,
          rules
        );
        
        console.log('📋 CDN cache rules updated');
        return response.data;
      } catch (error) {
        console.error('❌ CDN cache rules update failed:', error.response?.data || error.message);
        throw error;
      }
    }
    
    return null;
  }

  async getAnalytics(startDate, endDate) {
    if (this.provider === 'cloudflare' && this.cdnService.getCDNClient()) {
      try {
        const response = await this.cdnService.getCDNClient().get(
          `/zones/${this.cdnService.getConfig().zoneId}/analytics/dashboard`,
          {
            params: {
              since: startDate,
              until: endDate
            }
          }
        );
        
        return response.data;
      } catch (error) {
        console.error('❌ CDN analytics fetch failed:', error.response?.data || error.message);
        throw error;
      }
    }
    
    return null;
  }

  getProvider() {
    return this.provider;
  }
}

module.exports = new CDNConfig();