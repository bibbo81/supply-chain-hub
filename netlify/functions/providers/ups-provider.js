// netlify/functions/providers/ups.js

class UPSProvider {
  constructor() {
    this.baseUrl = 'https://onlinetools.ups.com/api';
    this.clientId = process.env.UPS_CLIENT_ID;
    this.clientSecret = process.env.UPS_CLIENT_SECRET;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async getAccessToken() {
    // Check if we have a valid token
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      
      const response = await fetch(`${this.baseUrl}/security/v1/oauth/token`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-merchant-id': this.clientId
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to get UPS access token');
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiry = new Date(Date.now() + (data.expires_in - 60) * 1000);
      
      return this.accessToken;
    } catch (error) {
      console.error('UPS OAuth error:', error);
      throw error;
    }
  }

  async track(trackingNumber) {
    try {
      const token = await this.getAccessToken();
      
      const response = await fetch(
        `${this.baseUrl}/track/v1/details/${trackingNumber}?locale=en_US&returnSignature=true`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'transId': Date.now().toString(),
            'transactionSrc': 'supply-chain-hub'
          }
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`UPS API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      return this.normalizeResponse(data);
      
    } catch (error) {
      console.error('UPS tracking error:', error);
      
      // Fallback to public tracking
      return this.publicTrack(trackingNumber);
    }
  }

  async publicTrack(trackingNumber) {
    // UPS public tracking (very limited)
    try {
      const response = await fetch(
        `https://www.ups.com/track/api/Track/GetStatus?loc=en_US`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; ParcelTracker/1.0)'
          },
          body: JSON.stringify({
            Locale: 'en_US',
            TrackingNumber: [trackingNumber]
          })
        }
      );

      if (!response.ok) {
        throw new Error('UPS public tracking unavailable');
      }

      const data = await response.json();
      return this.normalizePublicResponse(data);
      
    } catch (error) {
      throw new Error('Unable to track UPS shipment');
    }
  }

  normalizeResponse(upsData) {
    const shipment = upsData.trackResponse?.shipment?.[0];
    if (!shipment) {
      throw new Error('No shipment found');
    }

    const pkg = shipment.package?.[0];
    const events = [];
    
    if (pkg?.activity) {
      pkg.activity.forEach(activity => {
        const dateTime = this.parseUPSDateTime(activity.date, activity.time);
        
        events.push({
          event_date: dateTime.toISOString(),
          event_type: this.mapEventType(activity.status?.type),
          event_code: activity.status?.code,
          location_name: activity.location?.address?.city || '',
          location_code: activity.location?.address?.country || '',
          description: activity.status?.description,
          data_source: 'ups_api',
          confidence_score: 1.0,
          raw_data: activity
        });
      });
    }

    const currentStatus = pkg?.currentStatus;
    const status = this.mapStatus(currentStatus?.code);
    const latestActivity = pkg?.activity?.[0];

    return {
      tracking_number: pkg?.trackingNumber || trackingNumber,
      status: status,
      last_event_date: latestActivity ? this.parseUPSDateTime(latestActivity.date,