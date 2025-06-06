// netlify/functions/track-parcel.js
const { createClient } = require('@supabase/supabase-js');

// Import providers
const DHLProvider = require('./providers/dhl');
const FedExProvider = require('./providers/fedex');
const UPSProvider = require('./providers/ups');

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize providers
const providers = {
  'DHL': new DHLProvider(),
  'FEDEX': new FedExProvider(),
  'UPS': new UPSProvider()
};

// Carrier detection patterns
const CARRIER_PATTERNS = {
  'DHL': [
    /^\d{10}$/,                    // 10 digits
    /^\d{12}$/,                    // 12 digits
    /^JD\d{18}$/,                  // JD + 18 digits
    /^[A-Z]{3}\d{7}$/              // 3 letters + 7 digits
  ],
  'FEDEX': [
    /^\d{12}$/,                    // 12 digits
    /^\d{15}$/,                    // 15 digits
    /^DT\d{12}$/,                  // DT + 12 digits
    /^\d{20}$/                     // 20 digits
  ],
  'UPS': [
    /^1Z[A-Z0-9]{16}$/,           // 1Z + 16 alphanumeric
    /^T\d{10}$/,                   // T + 10 digits
    /^\d{9}$/,                     // 9 digits
    /^\d{26}$/                     // 26 digits
  ]
};

// Detect carrier from tracking number
function detectCarrier(trackingNumber) {
  const cleanNumber = trackingNumber.trim().toUpperCase();
  
  for (const [carrier, patterns] of Object.entries(CARRIER_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(cleanNumber)) {
        return carrier;
      }
    }
  }
  
  return null;
}

// Check cache freshness (6 hours for delivered, 1 hour for in transit)
function isCacheStale(cachedData) {
  if (!cachedData || !cachedData.cached_at) return true;
  
  const cacheAge = Date.now() - new Date(cachedData.cached_at).getTime();
  const maxAge = cachedData.status === 'delivered' ? 6 * 60 * 60 * 1000 : 60 * 60 * 1000;
  
  return cacheAge > maxAge;
}

// Get cached tracking data
async function getCachedTracking(trackingNumber, organizationId) {
  const { data, error } = await supabase
    .from('trackings')
    .select('*, tracking_events(*)')
    .eq('tracking_number', trackingNumber)
    .eq('organizzazione_id', organizationId)
    .eq('tracking_type', 'parcel')
    .single();
    
  if (error || !data) return null;
  
  return {
    ...data,
    cached_at: data.updated_at
  };
}

// Save tracking to database
async function saveTracking(trackingData, organizationId, userId) {
  // Check if exists
  const { data: existing } = await supabase
    .from('trackings')
    .select('id')
    .eq('tracking_number', trackingData.tracking_number)
    .eq('organizzazione_id', organizationId)
    .single();
    
  let trackingId;
  
  if (existing) {
    // Update existing
    const { data: updated, error } = await supabase
      .from('trackings')
      .update({
        status: trackingData.status,
        carrier_name: trackingData.carrier_name,
        last_event_date: trackingData.last_event_date,
        last_event_location: trackingData.last_event_location,
        last_event_description: trackingData.last_event_description,
        eta: trackingData.eta,
        metadata: {
          ...trackingData.metadata,
          last_api_update: new Date().toISOString()
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id)
      .select()
      .single();
      
    if (error) throw error;
    trackingId = existing.id;
  } else {
    // Create new
    const { data: created, error } = await supabase
      .from('trackings')
      .insert({
        organizzazione_id: organizationId,
        tracking_number: trackingData.tracking_number,
        tracking_type: 'parcel',
        carrier_code: trackingData.carrier_code,
        carrier_name: trackingData.carrier_name,
        status: trackingData.status,
        last_event_date: trackingData.last_event_date,
        last_event_location: trackingData.last_event_location,
        last_event_description: trackingData.last_event_description,
        eta: trackingData.eta,
        active: true,
        metadata: {
          ...trackingData.metadata,
          added_by: userId,
          added_at: new Date().toISOString()
        }
      })
      .select()
      .single();
      
    if (error) throw error;
    trackingId = created.id;
  }
  
  // Save events
  if (trackingData.events && trackingData.events.length > 0) {
    // Get existing events to avoid duplicates
    const { data: existingEvents } = await supabase
      .from('tracking_events')
      .select('event_date, event_code, location_name')
      .eq('tracking_id', trackingId);
      
    const existingKeys = new Set(
      existingEvents?.map(e => `${e.event_date}_${e.event_code}_${e.location_name}`) || []
    );
    
    // Filter new events
    const newEvents = trackingData.events.filter(event => {
      const key = `${event.event_date}_${event.event_code}_${event.location_name}`;
      return !existingKeys.has(key);
    });
    
    if (newEvents.length > 0) {
      const eventsToInsert = newEvents.map(event => ({
        ...event,
        tracking_id: trackingId
      }));
      
      await supabase
        .from('tracking_events')
        .insert(eventsToInsert);
    }
  }
  
  return trackingId;
}

exports.handler = async (event, context) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Get auth token
    const token = event.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Missing authorization token' })
      };
    }

    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid token' })
      };
    }

    // Get user's organization
    const { data: profile } = await supabase
      .from('profiles')
      .select('organizzazione_id')
      .eq('id', user.id)
      .single();

    if (!profile?.organizzazione_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'User profile not found' })
      };
    }

    // Parse request
    const { trackingNumber, carrier } = JSON.parse(event.body);
    
    if (!trackingNumber) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Tracking number required' })
      };
    }

    // Detect carrier if not provided
    const detectedCarrier = carrier || detectCarrier(trackingNumber);
    
    if (!detectedCarrier || !providers[detectedCarrier]) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Unable to detect carrier. Please specify DHL, FEDEX, or UPS.' 
        })
      };
    }

    // Check cache first
    const cached = await getCachedTracking(trackingNumber, profile.organizzazione_id);
    
    if (cached && !isCacheStale(cached)) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          data: cached,
          source: 'cache'
        })
      };
    }

    // Fetch from provider
    const provider = providers[detectedCarrier];
    let trackingData;
    
    try {
      trackingData = await provider.track(trackingNumber);
    } catch (providerError) {
      console.error(`Provider ${detectedCarrier} error:`, providerError);
      
      // If we have cached data, return it even if stale
      if (cached) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            data: cached,
            source: 'cache',
            warning: 'Unable to fetch latest updates, showing cached data'
          })
        };
      }
      
      return {
        statusCode: 503,
        body: JSON.stringify({
          error: `${detectedCarrier} service temporarily unavailable`,
          details: providerError.message
        })
      };
    }

    // Add carrier info
    trackingData.carrier_code = detectedCarrier;
    trackingData.carrier_name = detectedCarrier;

    // Save to database
    try {
      const trackingId = await saveTracking(
        trackingData, 
        profile.organizzazione_id,
        user.email
      );
      
      // Get full tracking with events
      const { data: fullTracking } = await supabase
        .from('trackings')
        .select('*, tracking_events(*)')
        .eq('id', trackingId)
        .single();
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          data: fullTracking,
          source: 'api'
        })
      };
      
    } catch (dbError) {
      console.error('Database error:', dbError);
      
      // Return API data even if save failed
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          data: trackingData,
          source: 'api',
          warning: 'Failed to cache data'
        })
      };
    }

  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};