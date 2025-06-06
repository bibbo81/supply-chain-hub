// netlify/functions/providers/dhl.js

class DHLProvider {
  constructor() {
    this.baseUrl = 'https://api-eu.dhl.com/track/shipments';
    this.apiKey = process.env.DHL_API_KEY;
  }

  async track(trackingNumber) {
    try {
      const response = await fetch(`${this.baseUrl}?${new URLSearchParams({
        trackingNumber: trackingNumber,
        service: 'express',
        requesterCountryCode: 'IT',
        originCountryCode: 'IT',
        language: 'en'
      })}`, {
        method: 'GET',
        headers: {
          'DHL-API-Key': this.apiKey,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`DHL API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      return this.normalizeResponse(data);
      
    } catch (error) {
      console.error('DHL tracking error:', error);
      
      // Fallback to public tracking if API fails
      return this.publicTrack(trackingNumber);
    }
  }

  async publicTrack(trackingNumber) {
    // DHL public tracking endpoint (no auth required but limited)
    try {
      const response = await fetch(
        `https://www.dhl.com/shipmentTracking?AWB=${trackingNumber}&countryCode=g0`,
        {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; ParcelTracker/1.0)'
          }
        }
      );

      if (!response.ok) {
        throw new Error('DHL public tracking unavailable');
      }

      const data = await response.json();
      return this.normalizePublicResponse(data);
      
    } catch (error) {
      throw new Error('Unable to track DHL shipment');
    }
  }

  normalizeResponse(dhlData) {
    const shipment = dhlData.shipments?.[0];
    if (!shipment) {
      throw new Error('No shipment found');
    }

    const events = [];
    
    if (shipment.events) {
      shipment.events.forEach(event => {
        events.push({
          event_date: new Date(event.timestamp).toISOString(),
          event_type: this.mapEventType(event.statusCode),
          event_code: event.statusCode,
          location_name: event.location?.address?.addressLocality || '',
          location_code: event.location?.address?.countryCode || '',
          description: event.description || event.status,
          data_source: 'dhl_api',
          confidence_score: 1.0,
          raw_data: event
        });
      });
    }

    const latestEvent = events[0];
    const status = this.mapStatus(shipment.status?.statusCode || latestEvent?.event_code);

    return {
      tracking_number: shipment.id,
      status: status,
      last_event_date: latestEvent?.event_date,
      last_event_location: latestEvent?.location_name,
      last_event_description: latestEvent?.description,
      eta: shipment.estimatedDeliveryDate ? new Date(shipment.estimatedDeliveryDate).toISOString() : null,
      metadata: {
        service_type: shipment.service,
        piece_ids: shipment.pieces?.map(p => p.id),
        origin: shipment.origin?.address?.addressLocality,
        destination: shipment.destination?.address?.addressLocality,
        weight: shipment.totalWeight
      },
      events: events.sort((a, b) => new Date(b.event_date) - new Date(a.event_date))
    };
  }

  normalizePublicResponse(data) {
    // Normalize public tracking data structure
    const tracking = data.results?.[0] || data;
    const events = [];
    
    if (tracking.checkpoints) {
      tracking.checkpoints.forEach(checkpoint => {
        events.push({
          event_date: new Date(checkpoint.date + ' ' + checkpoint.time).toISOString(),
          event_type: this.mapEventType(checkpoint.counter),
          event_code: String(checkpoint.counter),
          location_name: checkpoint.location || '',
          description: checkpoint.description,
          data_source: 'dhl_public',
          confidence_score: 0.8,
          raw_data: checkpoint
        });
      });
    }

    const latestEvent = events[0];
    const isDelivered = tracking.delivery?.status === 'delivered' || 
                       latestEvent?.description?.toLowerCase().includes('delivered');

    return {
      tracking_number: tracking.id || trackingNumber,
      status: isDelivered ? 'delivered' : 'in_transit',
      last_event_date: latestEvent?.event_date,
      last_event_location: latestEvent?.location_name,
      last_event_description: latestEvent?.description,
      eta: tracking.edd ? new Date(tracking.edd).toISOString() : null,
      metadata: {
        service_type: tracking.service?.productName,
        origin: tracking.origin?.value,
        destination: tracking.destination?.value
      },
      events: events.sort((a, b) => new Date(b.event_date) - new Date(a.event_date))
    };
  }

  mapEventType(code) {
    const eventMap = {
      'PU': 'PICKED_UP',
      'PL': 'PROCESSED',
      'DF': 'DEPARTED_FACILITY',
      'AF': 'ARRIVED_FACILITY',
      'OD': 'OUT_FOR_DELIVERY',
      'DD': 'DELIVERED',
      'RT': 'RETURNED',
      'RD': 'RETURN_DELIVERED',
      'OH': 'ON_HOLD',
      'MC': 'MISSED_COLLECTION',
      'CC': 'COLLECTION_COMPLETED'
    };
    
    return eventMap[code] || 'OTHER';
  }

  mapStatus(statusCode) {
    const delivered = ['DD', 'RD', 'OK', 'delivered'];
    const inTransit = ['PU', 'PL', 'DF', 'AF', 'OD', 'transit'];
    
    if (delivered.includes(statusCode)) return 'delivered';
    if (inTransit.includes(statusCode)) return 'in_transit';
    
    return 'registered';
  }
}

module.exports = DHLProvider;