const cdnConfig = require('../config/cdn');

class CDNService {
  constructor() {
    this.provider = cdnConfig.getProvider();
  }

  async purgeCache(urls) {
    try {
      if (this.provider === 'cloudflare') {
        return await cdnConfig.purgeCache(urls);
      }
      
      console.log(`CDN cache purge not implemented for provider: ${this.provider}`);
      return null;
    } catch (error) {
      console.error('CDN cache purge failed:', error);
      throw error;
    }
  }

  async purgeCacheByTags(tags) {
    try {
      if (this.provider === 'cloudflare') {
        const cloudflareConfig = require('../config/cloudflare');
        const cdnClient = cloudflareConfig.getCDNClient();
        
        if (cdnClient) {
          const response = await cdnClient.post(
            `/zones/${cloudflareConfig.getConfig().zoneId}/purge_cache`,
            {
              tags: Array.isArray(tags) ? tags : [tags]
            }
          );
          
          console.log(`🗑️ CDN cache purged by tags: ${tags}`);
          return response.data;
        }
      }
      
      return null;
    } catch (error) {
      console.error('CDN cache purge by tags failed:', error);
      throw error;
    }
  }

  async purgeEverything() {
    try {
      if (this.provider === 'cloudflare') {
        const cloudflareConfig = require('../config/cloudflare');
        const cdnClient = cloudflareConfig.getCDNClient();
        
        if (cdnClient) {
          const response = await cdnClient.post(
            `/zones/${cloudflareConfig.getConfig().zoneId}/purge_cache`,
            { purge_everything: true }
          );
          
          console.log('🗑️ CDN cache purged everything');
          return response.data;
        }
      }
      
      return null;
    } catch (error) {
      console.error('CDN complete cache purge failed:', error);
      throw error;
    }
  }

  async getAnalytics(startDate, endDate) {
    try {
      return await cdnConfig.getAnalytics(startDate, endDate);
    } catch (error) {
      console.error('CDN analytics fetch failed:', error);
      throw error;
    }
  }

  async setCacheSettings(settings) {
    try {
      if (this.provider === 'cloudflare') {
        const cloudflareConfig = require('../config/cloudflare');
        const cdnClient = cloudflareConfig.getCDNClient();
        
        if (cdnClient) {
          const zoneId = cloudflareConfig.getConfig().zoneId;
          
          // Update various cache settings
          const promises = [];
          
          if (settings.browserCacheTtl !== undefined) {
            promises.push(
              cdnClient.patch(`/zones/${zoneId}/settings/browser_cache_ttl`, {
                value: settings.browserCacheTtl
              })
            );
          }
          
          if (settings.cacheLevel !== undefined) {
            promises.push(
              cdnClient.patch(`/zones/${zoneId}/settings/cache_level`, {
                value: settings.cacheLevel
              })
            );
          }
          
          if (settings.alwaysOnline !== undefined) {
            promises.push(
              cdnClient.patch(`/zones/${zoneId}/settings/always_online`, {
                value: settings.alwaysOnline ? 'on' : 'off'
              })
            );
          }
          
          const results = await Promise.allSettled(promises);
          console.log('📋 CDN cache settings updated');
          return results;
        }
      }
      
      return null;
    } catch (error) {
      console.error('CDN cache settings update failed:', error);
      throw error;
    }
  }

  async optimizations() {
    try {
      if (this.provider === 'cloudflare') {
        const cloudflareConfig = require('../config/cloudflare');
        const cdnClient = cloudflareConfig.getCDNClient();
        
        if (cdnClient) {
          const zoneId = cloudflareConfig.getConfig().zoneId;
          
          // Enable various optimizations
          const optimizations = [
            { setting: 'minify', value: { css: 'on', html: 'on', js: 'on' } },
            { setting: 'rocket_loader', value: 'off' }, // Can break video players
            { setting: 'mirage', value: 'on' },
            { setting: 'polish', value: 'lossless' },
            { setting: 'webp', value: 'on' }
          ];
          
          const promises = optimizations.map(opt => 
            cdnClient.patch(`/zones/${zoneId}/settings/${opt.setting}`, {
              value: opt.value
            }).catch(err => ({ error: err.message, setting: opt.setting }))
          );
          
          const results = await Promise.allSettled(promises);
          console.log('⚡ CDN optimizations applied');
          return results;
        }
      }
      
      return null;
    } catch (error) {
      console.error('CDN optimizations failed:', error);
      throw error;
    }
  }

  getProvider() {
    return this.provider;
  }

  generateCDNUrl(originalUrl, options = {}) {
    if (this.provider === 'cloudflare') {
      const cloudflareConfig = require('../config/cloudflare');
      const customDomain = cloudflareConfig.getConfig().customDomain;
      
      if (customDomain && originalUrl) {
        // Replace original domain with CDN domain
        const urlParts = originalUrl.split('/');
        if (urlParts.length > 3) {
          const path = urlParts.slice(3).join('/');
          let cdnUrl = `https://${customDomain}/${path}`;
          
          // Add optimization parameters
          if (options.width || options.height || options.quality) {
            const params = new URLSearchParams();
            if (options.width) params.set('width', options.width);
            if (options.height) params.set('height', options.height);
            if (options.quality) params.set('quality', options.quality);
            if (options.format) params.set('format', options.format);
            
            cdnUrl += `?${params.toString()}`;
          }
          
          return cdnUrl;
        }
      }
    }
    
    return originalUrl;
  }

  async warmupCache(urls) {
    try {
      const promises = urls.map(async (url) => {
        try {
          const response = await fetch(url, { method: 'HEAD' });
          return { url, status: response.status, warmed: true };
        } catch (error) {
          return { url, status: 'error', warmed: false, error: error.message };
        }
      });
      
      const results = await Promise.allSettled(promises);
      console.log(`🔥 CDN cache warmed for ${urls.length} URLs`);
      return results;
    } catch (error) {
      console.error('CDN cache warmup failed:', error);
      throw error;
    }
  }
}

module.exports = new CDNService();