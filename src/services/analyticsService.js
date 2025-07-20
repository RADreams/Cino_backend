const Analytics = require('../models/Analytics');
const { v4: uuidv4 } = require('uuid');

class AnalyticsService {
  /**
   * Track an event
   */
  async trackEvent(eventData) {
    try {
      const event = {
        eventId: `${eventData.userId}_${Date.now()}_${uuidv4().slice(0, 8)}`,
        ...eventData,
        timestamp: new Date()
      };

      // Validate required fields
      if (!event.userId || !event.eventType || !event.category) {
        console.error('Missing required analytics fields:', event);
        return null;
      }

      // Save to database (async, don't wait)
      setImmediate(async () => {
        try {
          await Analytics.create(event);
        } catch (error) {
          console.error('Failed to save analytics event:', error);
        }
      });

      return event.eventId;
    } catch (error) {
      console.error('Analytics tracking error:', error);
      return null;
    }
  }

  /**
   * Track video events with validation
   */
  async trackVideoEvent(userId, eventType, videoData) {
    const event = {
      userId,
      eventType,
      category: 'video_playback',
      contentId: videoData.contentId,
      episodeId: videoData.episodeId,
      eventData: {
        currentPosition: videoData.currentPosition,
        totalDuration: videoData.totalDuration,
        quality: videoData.quality,
        playbackSpeed: videoData.playbackSpeed || 1
      },
      deviceInfo: videoData.deviceInfo,
      sessionId: videoData.sessionId
    };

    return this.trackEvent(event);
  }

  /**
   * Track user interaction events
   */
  async trackInteractionEvent(userId, eventType, interactionData) {
    const event = {
      userId,
      eventType,
      category: 'user_interaction',
      contentId: interactionData.contentId,
      episodeId: interactionData.episodeId,
      eventData: {
        swipeDirection: interactionData.swipeDirection,
        clickTarget: interactionData.clickTarget,
        navigationMethod: interactionData.navigationMethod,
        previousScreen: interactionData.previousScreen,
        nextScreen: interactionData.nextScreen
      },
      sessionId: interactionData.sessionId
    };

    return this.trackEvent(event);
  }

  /**
   * Track engagement events
   */
  async trackEngagementEvent(userId, eventType, engagementData) {
    const event = {
      userId,
      eventType,
      category: 'engagement',
      contentId: engagementData.contentId,
      episodeId: engagementData.episodeId,
      eventData: {
        likeStatus: engagementData.likeStatus,
        shareMethod: engagementData.shareMethod,
        rating: engagementData.rating
      },
      sessionId: engagementData.sessionId
    };

    return this.trackEvent(event);
  }

  /**
   * Track performance events
   */
  async trackPerformanceEvent(userId, eventType, performanceData) {
    const event = {
      userId,
      eventType,
      category: 'performance',
      eventData: {
        loadTime: performanceData.loadTime,
        bufferDuration: performanceData.bufferDuration,
        errorCode: performanceData.errorCode,
        errorMessage: performanceData.errorMessage
      },
      deviceInfo: performanceData.deviceInfo,
      sessionId: performanceData.sessionId
    };

    return this.trackEvent(event);
  }

  /**
   * Get user engagement metrics
   */
  async getUserEngagementMetrics(userId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return Analytics.aggregate([
      {
        $match: {
          userId,
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$eventType',
          count: { $sum: 1 },
          avgSessionDuration: { $avg: '$sessionDuration' }
        }
      },
      {
        $group: {
          _id: null,
          events: {
            $push: {
              eventType: '$_id',
              count: '$count',
              avgSessionDuration: '$avgSessionDuration'
            }
          },
          totalEvents: { $sum: '$count' }
        }
      }
    ]);
  }

  /**
   * Get content performance metrics
   */
  async getContentPerformanceMetrics(contentId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return Analytics.aggregate([
      {
        $match: {
          contentId,
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$eventType',
          count: { $sum: 1 },
          uniqueUsers: { $addToSet: '$userId' },
          avgCurrentPosition: { $avg: '$eventData.currentPosition' }
        }
      },
      {
        $addFields: {
          uniqueUserCount: { $size: '$uniqueUsers' }
        }
      }
    ]);
  }

  /**
   * Get platform analytics
   */
  async getPlatformAnalytics(days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [dailyStats, deviceStats, eventStats] = await Promise.all([
      // Daily statistics
      Analytics.aggregate([
        {
          $match: {
            timestamp: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
              eventType: '$eventType'
            },
            count: { $sum: 1 },
            uniqueUsers: { $addToSet: '$userId' }
          }
        },
        {
          $group: {
            _id: '$_id.date',
            events: {
              $push: {
                eventType: '$_id.eventType',
                count: '$count',
                uniqueUsers: { $size: '$uniqueUsers' }
              }
            },
            totalEvents: { $sum: '$count' }
          }
        },
        { $sort: { '_id': 1 } }
      ]),

      // Device breakdown
      Analytics.aggregate([
        {
          $match: {
            timestamp: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: '$deviceInfo.platform',
            events: { $sum: 1 },
            uniqueUsers: { $addToSet: '$userId' }
          }
        },
        {
          $addFields: {
            uniqueUserCount: { $size: '$uniqueUsers' }
          }
        }
      ]),

      // Event type breakdown
      Analytics.aggregate([
        {
          $match: {
            timestamp: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: {
              category: '$category',
              eventType: '$eventType'
            },
            count: { $sum: 1 },
            uniqueUsers: { $addToSet: '$userId' }
          }
        },
        {
          $group: {
            _id: '$_id.category',
            events: {
              $push: {
                eventType: '$_id.eventType',
                count: '$count',
                uniqueUsers: { $size: '$uniqueUsers' }
              }
            },
            totalEvents: { $sum: '$count' }
          }
        }
      ])
    ]);

    return {
      dailyStats,
      deviceStats,
      eventStats,
      period: days
    };
  }

  /**
   * Get drop-off analysis for content
   */
  async getDropOffAnalysis(contentId, episodeId = null) {
    const matchCondition = {
      contentId,
      eventType: { $in: ['video_pause', 'video_end', 'swipe_left'] }
    };

    if (episodeId) {
      matchCondition.episodeId = episodeId;
    }

    return Analytics.aggregate([
      { $match: matchCondition },
      {
        $bucket: {
          groupBy: '$eventData.currentPosition',
          boundaries: [0, 30, 60, 120, 300, 600, 1200, 1800, 3600], // seconds
          default: 'long',
          output: {
            dropOffs: { $sum: 1 },
            users: { $addToSet: '$userId' },
            avgPosition: { $avg: '$eventData.currentPosition' }
          }
        }
      },
      {
        $addFields: {
          uniqueUsers: { $size: '$users' }
        }
      }
    ]);
  }

  /**
   * Get user behavior patterns
   */
  async getUserBehaviorPatterns(userId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return Analytics.aggregate([
      {
        $match: {
          userId,
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            hour: { $hour: '$timestamp' },
            dayOfWeek: { $dayOfWeek: '$timestamp' },
            eventType: '$eventType'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: {
            hour: '$_id.hour',
            dayOfWeek: '$_id.dayOfWeek'
          },
          events: {
            $push: {
              eventType: '$_id.eventType',
              count: '$count'
            }
          },
          totalEvents: { $sum: '$count' }
        }
      },
      { $sort: { '_id.dayOfWeek': 1, '_id.hour': 1 } }
    ]);
  }

  /**
   * Get real-time analytics
   */
  async getRealTimeAnalytics() {
    const lastHour = new Date();
    lastHour.setHours(lastHour.getHours() - 1);

    const [currentUsers, recentEvents, topContent] = await Promise.all([
      // Active users in last hour
      Analytics.aggregate([
        {
          $match: {
            timestamp: { $gte: lastHour },
            eventType: { $in: ['video_start', 'app_open', 'content_view'] }
          }
        },
        {
          $group: {
            _id: null,
            activeUsers: { $addToSet: '$userId' }
          }
        },
        {
          $addFields: {
            count: { $size: '$activeUsers' }
          }
        }
      ]),

      // Recent events
      Analytics.aggregate([
        {
          $match: {
            timestamp: { $gte: lastHour }
          }
        },
        {
          $group: {
            _id: '$eventType',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ]),

      // Top content in last hour
      Analytics.aggregate([
        {
          $match: {
            timestamp: { $gte: lastHour },
            eventType: 'video_start',
            contentId: { $exists: true }
          }
        },
        {
          $group: {
            _id: '$contentId',
            views: { $sum: 1 },
            uniqueUsers: { $addToSet: '$userId' }
          }
        },
        {
          $addFields: {
            uniqueUserCount: { $size: '$uniqueUsers' }
          }
        },
        { $sort: { views: -1 } },
        { $limit: 10 }
      ])
    ]);

    return {
      activeUsers: currentUsers[0]?.count || 0,
      recentEvents,
      topContent,
      timestamp: new Date()
    };
  }

  /**
   * Generate analytics report
   */
  async generateReport(options = {}) {
    const {
      startDate,
      endDate,
      userId = null,
      contentId = null,
      reportType = 'overview'
    } = options;

    const matchCondition = {
      timestamp: { $gte: startDate, $lte: endDate }
    };

    if (userId) matchCondition.userId = userId;
    if (contentId) matchCondition.contentId = contentId;

    switch (reportType) {
      case 'engagement':
        return this._generateEngagementReport(matchCondition);
      case 'performance':
        return this._generatePerformanceReport(matchCondition);
      case 'content':
        return this._generateContentReport(matchCondition);
      default:
        return this._generateOverviewReport(matchCondition);
    }
  }

  /**
   * Generate engagement report
   */
  async _generateEngagementReport(matchCondition) {
    return Analytics.aggregate([
      { $match: { ...matchCondition, category: 'engagement' } },
      {
        $group: {
          _id: '$eventType',
          count: { $sum: 1 },
          uniqueUsers: { $addToSet: '$userId' },
          uniqueContent: { $addToSet: '$contentId' }
        }
      },
      {
        $addFields: {
          uniqueUserCount: { $size: '$uniqueUsers' },
          uniqueContentCount: { $size: '$uniqueContent' }
        }
      }
    ]);
  }

  /**
   * Generate performance report
   */
  async _generatePerformanceReport(matchCondition) {
    return Analytics.aggregate([
      { $match: { ...matchCondition, category: 'performance' } },
      {
        $group: {
          _id: '$eventType',
          count: { $sum: 1 },
          avgLoadTime: { $avg: '$eventData.loadTime' },
          avgBufferTime: { $avg: '$eventData.bufferDuration' }
        }
      }
    ]);
  }

  /**
   * Generate content report
   */
  async _generateContentReport(matchCondition) {
    return Analytics.aggregate([
      { $match: { ...matchCondition, contentId: { $exists: true } } },
      {
        $group: {
          _id: '$contentId',
          totalEvents: { $sum: 1 },
          uniqueUsers: { $addToSet: '$userId' },
          videoStarts: {
            $sum: { $cond: [{ $eq: ['$eventType', 'video_start'] }, 1, 0] }
          },
          videoEnds: {
            $sum: { $cond: [{ $eq: ['$eventType', 'video_end'] }, 1, 0] }
          },
          likes: {
            $sum: { $cond: [{ $eq: ['$eventType', 'like'] }, 1, 0] }
          },
          shares: {
            $sum: { $cond: [{ $eq: ['$eventType', 'share'] }, 1, 0] }
          }
        }
      },
      {
        $addFields: {
          uniqueUserCount: { $size: '$uniqueUsers' },
          completionRate: {
            $cond: [
              { $gt: ['$videoStarts', 0] },
              { $multiply: [{ $divide: ['$videoEnds', '$videoStarts'] }, 100] },
              0
            ]
          }
        }
      },
      { $sort: { totalEvents: -1 } }
    ]);
  }

  /**
   * Generate overview report
   */
  async _generateOverviewReport(matchCondition) {
    return Analytics.aggregate([
      { $match: matchCondition },
      {
        $group: {
          _id: null,
          totalEvents: { $sum: 1 },
          uniqueUsers: { $addToSet: '$userId' },
          uniqueContent: { $addToSet: '$contentId' },
          eventsByType: {
            $push: {
              eventType: '$eventType',
              category: '$category'
            }
          }
        }
      },
      {
        $addFields: {
          uniqueUserCount: { $size: '$uniqueUsers' },
          uniqueContentCount: { $size: '$uniqueContent' }
        }
      }
    ]);
  }

  /**
   * Clean up old analytics data
   */
  async cleanupOldData(daysToKeep = 365) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await Analytics.deleteMany({
      timestamp: { $lt: cutoffDate }
    });

    console.log(`Cleaned up ${result.deletedCount} old analytics records`);
    return result.deletedCount;
  }

  /**
   * Batch track events for performance
   */
  async batchTrackEvents(events) {
    try {
      const formattedEvents = events.map(event => ({
        eventId: `${event.userId}_${Date.now()}_${uuidv4().slice(0, 8)}`,
        ...event,
        timestamp: new Date()
      }));

      await Analytics.insertMany(formattedEvents, { ordered: false });
      return formattedEvents.length;
    } catch (error) {
      console.error('Batch analytics tracking error:', error);
      return 0;
    }
  }
}

module.exports = new AnalyticsService();