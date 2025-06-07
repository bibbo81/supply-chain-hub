// netlify/functions/shipsgo-air-tracking.js
// Crea e cancella tracking AWB con ShipsGo v2

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Funzione per ottenere configurazione ShipsGo V2 dinamica
async function getShipsGoV2Config(userId) {
  // Prima prova dalle env variables
  let authToken = process.env.SHIPSGO_V2_TOKEN;
  
  // Se non c'è, prendi dal profilo utente
  if (!authToken && userId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('api_settings')
      .eq('id', userId)
      .single();
      
    if (profile?.api_settings?.shipsgo_v2_token) {
      authToken = Buffer.from(profile.api_settings.shipsgo_v2_token, 'base64').toString();
    }
  }
  
  // Fallback al token di default per retrocompatibilità
  if (!authToken) {
    authToken = '505751c2-2745-4d83-b4e7-d35ccddd0628';
  }
  
  return {
    baseUrl: 'https://api.shipsgo.com/v2',
    authToken: authToken
  };
}

// Mapping airline codes
const AIRLINE_CODES = {
  'FEDEX': 'FX',
  'FX': 'FX',
  'UPS': '5X',
  '5X': '5X',
  'DHL': 'D0',
  'CARGOLUX': 'CV',
  'CV': 'CV',
  'CATHAY': 'CX',
  'CX': 'CX',
  'EMIRATES': 'EK',
  'EK': 'EK',
  'LUFTHANSA': 'LH',
  'LH': 'LH',
  'KOREAN': 'KE',
  'KE': 'KE',
  'SINGAPORE': 'SQ',
  'SQ': 'SQ'
};

exports.handler = async (event, context) => {
  // Supporta POST (create) e DELETE
  if (!['POST', 'DELETE'].includes(event.httpMethod)) {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Verifica autenticazione
    const token = event.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Missing authorization token' })
      };
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid token' })
      };
    }

    // Get user organization
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

    // Handle POST (create)
    if (event.httpMethod === 'POST') {
      return handleCreateAirShipment(event.body, user, profile.organizzazione_id);
    }

    // Handle DELETE
    if (event.httpMethod === 'DELETE') {
      return handleDeleteAirShipment(event.body, user, profile.organizzazione_id);
    }

  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// CREATE AIR SHIPMENT
async function handleCreateAirShipment(body, user, organizationId) {
  const {
    awbNumber,
    airlineCode,
    carrierCode,
    referenceNumber,
    pieces = 1,
    weight,
    originAirport,
    destinationAirport,
    emails = [],
    webhooks = []
  } = JSON.parse(body);

  if (!awbNumber || (!airlineCode && !carrierCode)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'awbNumber e airlineCode/carrierCode sono richiesti' })
    };
  }

  // Ottieni configurazione dinamica
  const SHIPSGO_V2_API = await getShipsGoV2Config(user.id);

  // Determina airline code
  const airline = airlineCode || AIRLINE_CODES[carrierCode] || carrierCode;

  // Prepara richiesta ShipsGo
  const shipmentData = {
    awb_number: awbNumber,
    airline_code: airline,
    reference_number: referenceNumber || `SCH-${Date.now()}`,
    pieces: pieces,
    weight: weight,
    weight_unit: 'KG',
    origin_airport: originAirport,
    destination_airport: destinationAirport,
    notification_emails: emails.length > 0 ? emails : [user.email],
    webhook_urls: webhooks
  };

  console.log('Creating air shipment:', shipmentData);

  try {
    // Chiama ShipsGo API
    const response = await fetch(`${SHIPSGO_V2_API.baseUrl}/air/shipments`, {
      method: 'POST',
      headers: {
        'X-Shipsgo-User-Token': SHIPSGO_V2_API.authToken, // ✅ CORRETTO
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(shipmentData)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('ShipsGo v2 error:', data);
      
      // Gestisci errori comuni
      if (data.message?.includes('already exists')) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            warning: 'AWB già registrato in ShipsGo',
            data: {
              awb_number: awbNumber,
              status: 'already_tracked'
            }
          })
        };
      }
      
      return {
        statusCode: response.status,
        body: JSON.stringify({ 
          error: 'ShipsGo API error',
          details: data 
        })
      };
    }

    // Salva nel nostro DB
    const trackingData = {
      organizzazione_id: organizationId,
      tracking_number: awbNumber,
      tracking_type: 'awb',
      carrier_code: carrierCode || airline,
      carrier_name: getAirlineName(airline),
      status: 'registered',
      reference_number: referenceNumber,
      origin_port: originAirport,
      destination_port: destinationAirport,
      active: true,
      metadata: {
        shipsgo_shipment_id: data.data?.id,
        shipsgo_tracking_id: data.data?.tracking_id,
        airline_code: airline,
        pieces: pieces,
        weight: weight,
        added_by: user.email,
        added_at: new Date().toISOString()
      }
    };

    const { data: savedTracking, error: dbError } = await supabase
      .from('trackings')
      .upsert(trackingData, {
        onConflict: 'tracking_number,organizzazione_id'
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'AWB aggiunto al tracking ShipsGo',
        data: {
          tracking_id: savedTracking?.id,
          awb_number: awbNumber,
          shipment_id: data.data?.id,
          airline_code: airline,
          status: 'tracking_active'
        }
      })
    };

  } catch (error) {
    console.error('Create air shipment error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
}

// DELETE AIR SHIPMENT
async function handleDeleteAirShipment(body, user, organizationId) {
  const { shipmentId, awbNumber } = JSON.parse(body);

  if (!shipmentId && !awbNumber) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'shipmentId o awbNumber richiesto' })
    };
  }

  // Ottieni configurazione dinamica
  const SHIPSGO_V2_API = await getShipsGoV2Config(user.id);

  try {
    // Se abbiamo solo AWB, dobbiamo prima recuperare lo shipment ID
    let shipsgoShipmentId = shipmentId;
    
    if (!shipsgoShipmentId && awbNumber) {
      // Cerca nel nostro DB
      const { data: tracking } = await supabase
        .from('trackings')
        .select('metadata')
        .eq('tracking_number', awbNumber)
        .eq('organizzazione_id', organizationId)
        .single();
        
      shipsgoShipmentId = tracking?.metadata?.shipsgo_shipment_id;
    }

    if (!shipsgoShipmentId) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Shipment non trovato' })
      };
    }

    // Chiama ShipsGo DELETE API
    const response = await fetch(`${SHIPSGO_V2_API.baseUrl}/air/shipments/${shipsgoShipmentId}`, {
      method: 'DELETE',
      headers: {
        'X-Shipsgo-User-Token': SHIPSGO_V2_API.authToken, // ✅ CORRETTO
        'Accept': 'application/json'
      }
    });

    if (!response.ok && response.status !== 404) {
      const data = await response.json();
      console.error('ShipsGo delete error:', data);
      
      return {
        statusCode: response.status,
        body: JSON.stringify({ 
          error: 'ShipsGo API error',
          details: data 
        })
      };
    }

    // Soft delete nel nostro DB
    const { error: dbError } = await supabase
      .from('trackings')
      .update({
        active: false,
        status: 'deleted',
        metadata: supabase.sql`metadata || jsonb_build_object('deleted_at', '${new Date().toISOString()}', 'deleted_by', '${user.email}', 'shipsgo_deleted', true)`
      })
      .eq('tracking_number', awbNumber)
      .eq('organizzazione_id', organizationId);

    if (dbError) {
      console.error('Database soft delete error:', dbError);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'AWB rimosso dal tracking',
        data: {
          awb_number: awbNumber,
          shipment_id: shipsgoShipmentId,
          status: 'deleted'
        }
      })
    };

  } catch (error) {
    console.error('Delete air shipment error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
}

// Helper: get airline name
function getAirlineName(code) {
  const names = {
    'FX': 'FedEx',
    '5X': 'UPS Airlines',
    'D0': 'DHL Aviation',
    'CV': 'Cargolux',
    'CX': 'Cathay Pacific Cargo',
    'EK': 'Emirates SkyCargo',
    'LH': 'Lufthansa Cargo',
    'KE': 'Korean Air Cargo',
    'SQ': 'Singapore Airlines Cargo'
  };
  return names[code] || code;
}
