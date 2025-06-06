// netlify/functions/track-parcel.js
const { createClient } = require('@supabase/supabase-js');

// Import providers
const DHLProvider = require('./providers/dhl');
const FedExProvider = require('./providers/fedex');
const UPSProvider = require('./providers/ups');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize providers
const providers = {
  DHL: new DHLProvider(),
  FEDEX: new FedExProvider(),
  UPS: new UPSProvider()
};

// TNT Provider (placeholder for now)
async function trackTNT(trackingNumber) {
  console.log('Tracking TNT:', trackingNumber);
  return {
    success: true,
    data: {
      tracking_number: trackingNumber,
      status: 'in_transit',
      carrier_code: 'TNT',
      carrier_name: 'TNT Express',
      last_event_date: new Date().toISOString(),
      events: []
    }
  };
}

// GLS Provider (placeholder for now)
async function trackGLS(trackingNumber) {
  console.log('Tracking GLS:', trackingNumber);
  return {
    success: true,
    data: {
      tracking_number: trackingNumber,
      status: 'in_transit',
      carrier_code: 'GLS',
      carrier_name: 'GLS',
      last_event_date: new Date().toISOString(),
      events: []
    }
  };
}

exports.handler = async (event, context) => {
  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { trackingNumber, carrier } = JSON.parse(event.body);

    if (!trackingNumber || !carrier) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Missing tracking number or carrier' })
      };
    }

    let result;
    const carrierUpper = carrier.toUpperCase();
    
    // Route to appropriate carrier
    if (providers[carrierUpper]) {
      try {
        const trackingData = await providers[carrierUpper].track(trackingNumber);
        result = {
          success: true,
          data: trackingData
        };
      } catch (error) {
        console.error(`${carrierUpper} tracking error:`, error);
        result = {
          success: false,
          error: error.message
        };
      }
    } else if (carrierUpper === 'TNT') {
      result = await trackTNT(trackingNumber);
    } else if (carrierUpper === 'GLS') {
      result = await trackGLS(trackingNumber);
    } else {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: `Unsupported carrier: ${carrier}` })
      };
    }

    if (!result.success) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: result.error || 'Tracking failed' })
      };
    }

    // Save to database if we have user context
    const token = event.headers.authorization?.replace('Bearer ', '');
    if (token) {
      try {
        const { data: { user } } = await supabase.auth.getUser(token);
        
        if (user) {
          // Get user's organization
          const { data: profile } = await supabase
            .from('profiles')
            .select('organizzazione_id')
            .eq('id', user.id)
            .single();

          if (profile?.organizzazione_id) {
            // Save tracking to database
            const { error: saveError } = await supabase
              .from('trackings')
              .upsert({
                organizzazione_id: profile.organizzazione_id,
                tracking_number: trackingNumber,
                tracking_type: 'parcel',
                carrier_code: carrierUpper,
                carrier_name: carrier,
                status: result.data.status,
                last_event_date: result.data.last_event_date,
                last_event_location: result.data.last_event_location,
                last_event_description: result.data.last_event_description,
                eta: result.data.eta,
                active: true,
                metadata: result.data.metadata || {},
                events: result.data.events || []
              }, {
                onConflict: 'tracking_number,organizzazione_id'
              });

            if (saveError) {
              console.error('Error saving tracking:', saveError);
            }
          }
        }
      } catch (authError) {
        console.error('Auth error:', authError);
        // Continue anyway - tracking still works without saving
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};