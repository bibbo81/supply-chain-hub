// netlify/functions/update-tracking.js
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ShipsGo configurations
const SHIPSGO_V1_CONFIG = {
  baseUrl: 'https://shipsgo.com/api/v1.2',
  apiKey: process.env.SHIPSGO_V1_API_KEY || '2dc0c6d92ccb59e7d903825c4ebeb521',
  headers: {
    'Authorization': 'Bearer 2dc0c6d92ccb59e7d903825c4ebeb521',
    'Content-Type': 'application/json'
  }
};

const SHIPSGO_V2_CONFIG = {
  baseUrl: 'https://api.shipsgo.com/api/v2',
  token: process.env.SHIPSGO_V2_TOKEN || '505751c2-2745-4d83-b4e7-d35ccddd0628',
  headers: {
    'Authorization': 'Bearer 505751c2-2745-4d83-b4e7-d35ccddd0628',
    'Content-Type': 'application/json'
  }
};

// Status mappings
const STATUS_MAPPINGS = {
  // V1.2 statuses
  'Gate In': 'in_transit',
  'Gate Out': 'in_transit',
  'Loaded': 'in_transit',
  'Discharged': 'in_transit',
  'Delivered': 'delivered',
  'Empty Container Returned': 'delivered',
  
  // V2.0 statuses
  'DEP': 'in_transit',
  'ARR': 'in_transit',
  'DLV': 'delivered',
  'RCS': 'in_transit',
  'RCF': 'in_transit',
  'NFD': 'in_transit'
};

// Event type mappings
const EVENT_TYPE_MAPPINGS = {
  'Gate In': 'GATE_IN',
  'Gate Out': 'GATE_OUT',
  'Loaded': 'LOADED_ON_VESSEL',
  'Discharged': 'DISCHARGED_FROM_VESSEL',
  'Delivered': 'DELIVERED',
  'Empty Container Returned': 'EMPTY_RETURNED',
  'DEP': 'DEPARTED',
  'ARR': 'ARRIVED',
  'DLV': 'DELIVERED',
  'RCS': 'RECEIVED_FROM_SHIPPER',
  'RCF': 'RECEIVED_FROM_FLIGHT'
};

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  retryDelay: 1000,
  backoffMultiplier: 2
};

async function fetchWithRetry(url, options, retries = RETRY_CONFIG.maxRetries) {
  try {
    const response = await fetch(url, options);
    
    // Handle rate limiting
    if (response.status === 429 && retries > 0) {
      const delay = RETRY_CONFIG.retryDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxRetries - retries);
      console.log(`Rate limited, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1);
    }
    
    return response;
  } catch (error) {
    if (retries > 0) {
      const delay = RETRY_CONFIG.retryDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxRetries - retries);
      console.log(`Request failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1);
    }
    throw error;
  }
}

async function fetchV1Updates(tracking) {
  const containerId = tracking.metadata?.shipsgo_container_id;
  if (!containerId) {
    throw new Error('No ShipsGo container ID found');
  }

  const response = await fetchWithRetry(
    `${SHIPSGO_V1_CONFIG.baseUrl}/tracking/${containerId}`,
    {
      method: 'GET',
      headers: SHIPSGO_V1_CONFIG.headers
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ShipsGo V1.2 error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

async function fetchV2Updates(tracking) {
  const trackingId = tracking.metadata?.shipsgo_tracking_id;
  if (!trackingId) {
    throw new Error('No ShipsGo tracking ID found');
  }

  const response = await fetchWithRetry(
    `${SHIPSGO_V2_CONFIG.baseUrl}/trackings/${trackingId}`,
    {
      method: 'GET',
      headers: SHIPSGO_V2_CONFIG.headers
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ShipsGo V2.0 error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

function normalizeV1Data(data, tracking) {
  const events = [];
  const containers = data.containers || [data];
  
  containers.forEach(container => {
    // Process events
    if (container.events && Array.isArray(container.events)) {
      container.events.forEach(event => {
        events.push({
          event_date: new Date(event.date).toISOString(),
          event_type: EVENT_TYPE_MAPPINGS[event.description] || 'OTHER',
          event_code: event.description?.substring(0, 3).toUpperCase(),
          location_name: event.location,
          location_code: event.unlocode,
          description: event.description,
          vessel_name: container.vessel?.name,
          vessel_imo: container.vessel?.imo,
          voyage_number: container.voyage,
          data_source: 'shipsgo_v1',
          confidence_score: 0.95,
          raw_data: event
        });
      });
    }
  });

  // Get latest container info
  const latestContainer = containers[containers.length - 1];
  
  return {
    status: STATUS_MAPPINGS[latestContainer.lastEvent?.description] || 'in_transit',
    eta: latestContainer.eta ? new Date(latestContainer.eta).toISOString() : null,
    ata: latestContainer.ata ? new Date(latestContainer.ata).toISOString() : null,
    vessel_name: latestContainer.vessel?.name,
    vessel_imo: latestContainer.vessel?.imo,
    voyage_number: latestContainer.voyage,
    events: events.sort((a, b) => new Date(b.event_date) - new Date(a.event_date))
  };
}

function normalizeV2Data(data, tracking) {
  const events = [];
  
  // Process tracking events
  if (data.events && Array.isArray(data.events)) {
    data.events.forEach(event => {
      events.push({
        event_date: new Date(event.eventDate).toISOString(),
        event_type: EVENT_TYPE_MAPPINGS[event.eventCode] || 'OTHER',
        event_code: event.eventCode,
        location_name: event.location,
        location_code: event.airport,
        description: event.description || event.eventCode,
        flight_number: event.flightNumber,
        data_source: 'shipsgo_v2',
        confidence_score: 0.95,
        raw_data: event
      });
    });
  }
  
  return {
    status: STATUS_MAPPINGS[data.lastEvent?.eventCode] || 'in_transit',
    eta: data.estimatedDelivery ? new Date(data.estimatedDelivery).toISOString() : null,
    ata: data.actualDelivery ? new Date(data.actualDelivery).toISOString() : null,
    flight_number: data.flightNumber,
    events: events.sort((a, b) => new Date(b.event_date) - new Date(a.event_date))
  };
}

async function checkIfDelayed(tracking, normalizedData) {
  if (normalizedData.eta && normalizedData.status === 'in_transit') {
    const etaDate = new Date(normalizedData.eta);
    const now = new Date();
    
    if (now > etaDate) {
      return 'delayed';
    }
  }
  
  return normalizedData.status;
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
    // Get auth token from header
    const token = event.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Missing authorization token' })
      };
    }

    // Verify user from token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid token' })
      };
    }

    // Get user's organization
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('organizzazione_id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.organizzazione_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'User profile not found' })
      };
    }

    // Parse request body
    const { trackingId } = JSON.parse(event.body);
    
    if (!trackingId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing tracking ID' })
      };
    }

    // Get tracking from database
    const { data: tracking, error: trackingError } = await supabase
      .from('trackings')
      .select('*')
      .eq('id', trackingId)
      .eq('organizzazione_id', profile.organizzazione_id)
      .single();

    if (trackingError || !tracking) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Tracking not found' })
      };
    }

    // Fetch updates based on tracking type
    let shipsgoData;
    let normalizedData;
    
    try {
      if (tracking.tracking_type === 'container' || tracking.tracking_type === 'bl') {
        shipsgoData = await fetchV1Updates(tracking);
        normalizedData = normalizeV1Data(shipsgoData, tracking);
      } else if (tracking.tracking_type === 'awb') {
        shipsgoData = await fetchV2Updates(tracking);
        normalizedData = normalizeV2Data(shipsgoData, tracking);
      } else {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Tracking type not supported for updates' })
        };
      }
    } catch (fetchError) {
      console.error('Failed to fetch updates:', fetchError);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: false,
          error: 'Failed to fetch updates from carrier',
          tracking
        })
      };
    }

    // Check if delayed
    normalizedData.status = await checkIfDelayed(tracking, normalizedData);

    // Get existing events to avoid duplicates
    const { data: existingEvents } = await supabase
      .from('tracking_events')
      .select('event_date, event_type, location_name')
      .eq('tracking_id', trackingId);

    const existingEventKeys = new Set(
      existingEvents?.map(e => `${e.event_date}_${e.event_type}_${e.location_name}`) || []
    );

    // Filter new events
    const newEvents = normalizedData.events.filter(event => {
      const eventKey = `${event.event_date}_${event.event_type}_${event.location_name}`;
      return !existingEventKeys.has(eventKey);
    });

    // Insert new events
    if (newEvents.length > 0) {
      const eventsToInsert = newEvents.map(event => ({
        ...event,
        tracking_id: trackingId
      }));

      const { error: eventsError } = await supabase
        .from('tracking_events')
        .insert(eventsToInsert);

      if (eventsError) {
        console.error('Failed to insert events:', eventsError);
      }
    }

    // Update tracking record
    const latestEvent = normalizedData.events[0];
    const updateData = {
      status: normalizedData.status,
      eta: normalizedData.eta,
      ata: normalizedData.ata,
      vessel_name: normalizedData.vessel_name,
      vessel_imo: normalizedData.vessel_imo,
      voyage_number: normalizedData.voyage_number,
      flight_number: normalizedData.flight_number,
      last_event_date: latestEvent?.event_date,
      last_event_location: latestEvent?.location_name,
      last_event_description: latestEvent?.description,
      metadata: {
        ...tracking.metadata,
        last_update: new Date().toISOString(),
        last_update_by: user.email,
        events_count: (tracking.metadata?.events_count || 0) + newEvents.length
      }
    };

    const { data: updatedTracking, error: updateError } = await supabase
      .from('trackings')
      .update(updateData)
      .eq('id', trackingId)
      .select()
      .single();

    if (updateError) {
      console.error('Failed to update tracking:', updateError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to update tracking' })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        data: updatedTracking,
        newEvents: newEvents.length,
        totalEvents: normalizedData.events.length
      })
    };

  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};