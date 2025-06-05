// netlify/functions/add-tracking.js
const { createClient } = require('@supabase/supabase-js');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));


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

// Tracking type detection patterns
const TRACKING_PATTERNS = {
  container: /^[A-Z]{4}\d{7}$/,
  bl: /^[A-Z]{4}\d{8,12}$/,
  awb: /^\d{3}-\d{8}$/,
  parcel: /^[A-Z0-9]{10,30}$/
};

// Carrier mappings
const CARRIER_MAPPINGS = {
  'MSC': { shipsgo: 'MSC', scac: 'MSCU' },
  'MAERSK': { shipsgo: 'MAERSK', scac: 'MAEU' },
  'CMA-CGM': { shipsgo: 'CMA CGM', scac: 'CMDU' },
  'COSCO': { shipsgo: 'COSCO', scac: 'COSU' },
  'HAPAG-LLOYD': { shipsgo: 'HAPAG-LLOYD', scac: 'HLCU' },
  'ONE': { shipsgo: 'ONE', scac: 'ONEY' },
  'EVERGREEN': { shipsgo: 'EVERGREEN', scac: 'EGLV' },
  'YANG-MING': { shipsgo: 'YANG MING', scac: 'YMLU' },
  'ZIM': { shipsgo: 'ZIM', scac: 'ZIMU' },
  'HMM': { shipsgo: 'HMM', scac: 'HDMU' }
};

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
    const { 
      trackingNumber, 
      trackingType, 
      carrierCode, 
      referenceNumber 
    } = JSON.parse(event.body);

    // Validate required fields
    if (!trackingNumber || !trackingType || !carrierCode) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // Auto-detect type if not provided
    let detectedType = trackingType;
    if (!detectedType) {
      for (const [type, pattern] of Object.entries(TRACKING_PATTERNS)) {
        if (pattern.test(trackingNumber.toUpperCase())) {
          detectedType = type;
          break;
        }
      }
    }

    // Prepare tracking data
    const trackingData = {
      organizzazione_id: profile.organizzazione_id,
      tracking_number: trackingNumber.toUpperCase(),
      tracking_type: detectedType,
      carrier_code: carrierCode,
      carrier_name: CARRIER_MAPPINGS[carrierCode]?.shipsgo || carrierCode,
      reference_number: referenceNumber,
      status: 'registered',
      active: true,
      metadata: {
        added_by: user.email,
        added_at: new Date().toISOString()
      }
    };

    // Check if tracking already exists
    const { data: existing } = await supabase
      .from('trackings')
      .select('id')
      .eq('tracking_number', trackingData.tracking_number)
      .eq('organizzazione_id', profile.organizzazione_id)
      .single();

    if (existing) {
      return {
        statusCode: 409,
        body: JSON.stringify({ error: 'Tracking number already exists' })
      };
    }

    // Add to ShipsGo based on type
    let shipsgoResponse = null;
    let shipsgoError = null;

    if (detectedType === 'container' || detectedType === 'bl') {
      // Use ShipsGo V1.2 for maritime
      try {
        const response = await fetch(`${SHIPSGO_V1_CONFIG.baseUrl}/tracking`, {
          method: 'POST',
          headers: SHIPSGO_V1_CONFIG.headers,
          body: JSON.stringify({
            containerNumber: trackingNumber,
            shippingLine: CARRIER_MAPPINGS[carrierCode]?.scac || carrierCode
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('ShipsGo V1.2 error:', errorText);
          shipsgoError = `ShipsGo error: ${response.status}`;
        } else {
          shipsgoResponse = await response.json();
          trackingData.metadata.shipsgo_container_id = shipsgoResponse.containerId;
        }
      } catch (error) {
        console.error('ShipsGo V1.2 request failed:', error);
        shipsgoError = error.message;
      }
    } else if (detectedType === 'awb') {
      // Use ShipsGo V2.0 for air cargo
      try {
        const response = await fetch(`${SHIPSGO_V2_CONFIG.baseUrl}/trackings`, {
          method: 'POST',
          headers: SHIPSGO_V2_CONFIG.headers,
          body: JSON.stringify({
            awbNumber: trackingNumber,
            airline: carrierCode
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('ShipsGo V2.0 error:', errorText);
          shipsgoError = `ShipsGo error: ${response.status}`;
        } else {
          shipsgoResponse = await response.json();
          trackingData.metadata.shipsgo_tracking_id = shipsgoResponse.id;
        }
      } catch (error) {
        console.error('ShipsGo V2.0 request failed:', error);
        shipsgoError = error.message;
      }
    }

    // Save to database regardless of ShipsGo result
    const { data: savedTracking, error: dbError } = await supabase
      .from('trackings')
      .insert([trackingData])
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to save tracking' })
      };
    }

    // Create initial event
    await supabase
      .from('tracking_events')
      .insert([{
        tracking_id: savedTracking.id,
        event_date: new Date().toISOString(),
        event_type: 'REGISTERED',
        event_code: 'REG',
        location_name: 'System',
        description: 'Tracking registered in system',
        data_source: 'system',
        confidence_score: 1.0,
        raw_data: { user: user.email, shipsgo_error: shipsgoError }
      }]);

    // Return success with warning if ShipsGo failed
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        data: savedTracking,
        warning: shipsgoError ? 'Tracking saved but ShipsGo registration failed' : null
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