// netlify/functions/providers/fedex.js

class FedExProvider {
  constructor() {
    this.baseUrl = 'https://apis.fedex.com';
    this.clientId = process.env.FEDEX_CLIENT_ID;
    this.clientSecret = process.env.FEDEX_CLIENT_SECRET;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async getAccessToken() {
    // Check if we have a valid token
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const response = await fetch(`${this.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret
        })
      });

      if (!response.ok) {
        throw new Error('Failed to get FedEx access token');
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiry = new Date(Date.now() + (data.expires_in - 60) * 1000);
      
      return this.accessToken;
    } catch (error) {
      console.error('FedEx OAuth error:', error);
      throw error;
    }
  }

  async track(trackingNumber) {
    try {
      const token = await this.getAccessToken();
      
      const response = await fetch(`${this.baseUrl}/track/v1/trackingnumbers`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-locale': 'en_US'
        },
        body: JSON.stringify({
          includeDetailedScans: true,
          trackingInfo: [{
            trackingNumberInfo: {
              trackingNumber: trackingNumber
            }
          }]
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`FedEx API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      return this.normalizeResponse(data);
      
    } catch (error) {
      console.error('FedEx tracking error:', error);
      
      // Fallback to public tracking
      return this.publicTrack(trackingNumber);
    }
  }

  async publicTrack(trackingNumber) {
    // FedEx public tracking (limited info)
    try {
      const response = await fetch(
        `https://www.fedex.com/trackingCal/track`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (compatible; ParcelTracker/1.0)'
          },
          body: new URLSearchParams({
            data: JSON.stringify({
              TrackPackagesRequest: {
                trackingInfoList: [{
                  trackNumberInfo: {
                    trackingNumber: trackingNumber,
                    trackingQualifier: '',
                    trackingCarrier: ''
                  }
                }]
              }
            }),
            action: 'trackpackages',
            format: 'json',
            version: '1'
          })
        }
      );

      if (!response.ok) {
        throw new Error('FedEx public tracking unavailable');
      }

      const data = await response.json();
      return this.normalizePublicResponse(data);
      
    } catch (error) {
      throw new Error('Unable to track FedEx shipment');
    }
  }

  normalizeResponse(fedexData) {
    const trackResult = fedexData.output?.completeTrackResults?.[0]?.trackResults?.[0];
    if (!trackResult) {
      throw new Error('No tracking results found');
    }

    const events = [];
    
    if (trackResult.scanEvents) {
      trackResult.scanEvents.forEach(scan => {
        events.push({
          event_date: new Date(scan.date).toISOString(),
          event_type: this.mapEventType(scan.eventType),
          event_code: scan.eventType,
          location_name: scan.scanLocation?.city || '',
          location_code: scan.scanLocation?.countryCode || '',
          description: scan.eventDescription || scan.derivedStatus,
          data_source: 'fedex_api',
          confidence_score: 1.0,
          raw_data: scan
        });
      });
    }

    const latestStatus = trackResult.latestStatusDetail;
    const status = this.mapStatus(latestStatus?.code);

    return {
      tracking_number: trackResult.trackingNumber,
      status: status,
      last_event_date: latestStatus?.scanDate ? new Date(latestStatus.scanDate).toISOString() : null,
      last_event_location: latestStatus?.scanLocation?.city,
      last_event_description: latestStatus?.description,
      eta: trackResult.estimatedDeliveryDate ? new Date(trackResult.estimatedDeliveryDate).toISOString() : null,
      metadata: {
        service_type: trackResult.serviceDetail?.description,
        packaging: trackResult.packageDetails?.packagingDescription,
        weight: trackResult.packageDetails?.weight,
        dimensions: trackResult.packageDetails?.dimensions,
        shipper_city: trackResult.shipperInformation?.address?.city,
        recipient_city: trackResult.recipientInformation?.address?.city,
        signature: trackResult.deliveryDetails?.receivedByName
      },
      events: events.sort((a, b) => new Date(b.event_date) - new Date(a.event_date))
    };
  }

  normalizePublicResponse(data) {
    const pkg = data.TrackPackagesResponse?.packageList?.[0];
    if (!pkg) {
      throw new Error('No tracking data found');
    }

    const events = [];
    
    if (pkg.scanEventList) {
      pkg.scanEventList.forEach(event => {
        events.push({
          event_date: new Date(event.date + ' ' + event.time).toISOString(),
          event_type: this.mapEventType(event.status),
          event_code: event.statusCD,
          location_name: event.scanLocation || '',
          description: event.status,
          data_source: 'fedex_public',
          confidence_score: 0.8,
          raw_data: event
        });
      });
    }

    const isDelivered = pkg.keyStatus === 'Delivered';
    const latestEvent = events[0];

    return {
      tracking_number: pkg.trackingNbr,
      status: isDelivered ? 'delivered' : 'in_transit',
      last_event_date: latestEvent?.event_date,
      last_event_location: latestEvent?.location_name,
      last_event_description: latestEvent?.description,
      eta: pkg.displayEstDeliveryDt ? new Date(pkg.displayEstDeliveryDt).toISOString() : null,
      metadata: {
        service_type: pkg.serviceDesc,
        weight: pkg.displayTotalWgt,
        shipper_city: pkg.shipperCntryCD,
        recipient_city: pkg.recipientCntryCD
      },
      events: events.sort((a, b) => new Date(b.event_date) - new Date(a.event_date))
    };
  }

  mapEventType(code) {
    const eventMap = {
      'PU': 'PICKED_UP',
      'OC': 'ORIGIN_SCAN',
      'AR': 'ARRIVED',
      'DP': 'DEPARTED',
      'IT': 'IN_TRANSIT',
      'OD': 'OUT_FOR_DELIVERY',
      'DL': 'DELIVERED',
      'DE': 'DELIVERY_EXCEPTION',
      'RS': 'RETURN_TO_SHIPPER',
      'HL': 'HELD',
      'CA': 'CLEARANCE_DELAY',
      'CC': 'CLEARANCE_COMPLETED'
    };
    
    return eventMap[code] || 'OTHER';
  }

  mapStatus(statusCode) {
    const delivered = ['DL', 'Delivered'];
    const inTransit = ['PU', 'OC', 'AR', 'DP', 'IT', 'OD', 'In transit'];
    
    if (delivered.some(code => statusCode?.includes(code))) return 'delivered';
    if (inTransit.some(code => statusCode?.includes(code))) return 'in_transit';
    
    return 'registered';
  }
}

module.exports = FedExProvider;