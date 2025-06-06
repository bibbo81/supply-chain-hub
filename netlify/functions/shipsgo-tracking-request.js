// netlify/functions/shipsgo-tracking-request.js
// Aggiunge un nuovo container a ShipsGo per il tracking

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Funzione per ottenere configurazione ShipsGo V1 dinamica
async function getShipsGoV1Config(userId) {
  // Prima prova dalle env variables
  let apiKey = process.env.SHIPSGO_API_KEY;
  
  // Se non c'è, prendi dal profilo utente
  if (!apiKey && userId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('api_settings')
      .eq('id', userId)
      .single();
      
    if (profile?.api_settings?.shipsgo_v1_key) {
      apiKey = Buffer.from(profile.api_settings.shipsgo_v1_key, 'base64').toString();
    }
  }
  
  // Fallback alla key di default per retrocompatibilità
  if (!apiKey) {
    apiKey = '2dc0c6d92ccb59e7d903825c4ebeb521';
  }
  
  return {
    baseUrl: 'https://shipsgo.com/api/v1.2',
    authCode: apiKey
  };
}

// Mapping dei nostri carrier code a ShipsGo shipping lines
const CARRIER_TO_SHIPSGO = {
  'MAERSK': 'MAEU',
  'MSC': 'MSCU',
  'CMA-CGM': 'CMDU',
  'COSCO': 'COSU',
  'HAPAG-LLOYD': 'HLCU',
  'ONE': 'ONEY',
  'EVERGREEN': 'EGLV',
  'YANG-MING': 'YMLU',
  'ZIM': 'ZIMU',
  'HMM': 'HDMU'
};

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
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

    // Ottieni configurazione dinamica
    const SHIPSGO_API = await getShipsGoV1Config(user.id);

    // Parse request
    const { 
      containerNumber, 
      shippingLine, 
      carrierCode,
      emails = [],
      webhooks = [],
      referenceNo = ''
    } = JSON.parse(event.body);

    if (!containerNumber) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'containerNumber è richiesto' })
      };
    }

    // Determina shipping line
    const shipsgoLine = shippingLine || CARRIER_TO_SHIPSGO[carrierCode] || carrierCode;
    
    if (!shipsgoLine) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'shippingLine o carrierCode richiesto' })
      };
    }

    // Prepara richiesta per ShipsGo
    const trackingRequest = {
      authCode: SHIPSGO_API.authCode,
      containerNumber: containerNumber.toUpperCase(),
      shippingLine: shipsgoLine,
      emails: emails.length > 0 ? emails : [user.email], // Usa email utente se non specificata
      webhooks: webhooks,
      referenceNo: referenceNo || `SCH-${Date.now()}`
    };

    console.log('ShipsGo tracking request:', trackingRequest);

    // Chiama API ShipsGo
    const response = await fetch(`${SHIPSGO_API.baseUrl}/TrackingService/TrackingRequest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(trackingRequest)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('ShipsGo error:', data);
      
      // Gestisci errori comuni
      if (data.message?.includes('already exists')) {
        // Container già tracciato, recupera info
        return {
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            warning: 'Container già registrato in ShipsGo',
            data: {
              containerNumber: containerNumber,
              status: 'already_tracked',
              message: 'Usa get-container-info per recuperare i dettagli'
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

    // Successo - salva nel nostro DB
    const { data: profile } = await supabase
      .from('profiles')
      .select('organizzazione_id')
      .eq('id', user.id)
      .single();

    if (profile?.organizzazione_id) {
      // Crea o aggiorna tracking nel nostro sistema
      const trackingData = {
        organizzazione_id: profile.organizzazione_id,
        tracking_number: containerNumber.toUpperCase(),
        tracking_type: 'container',
        carrier_code: carrierCode || shippingLine,
        carrier_name: getCarrierName(carrierCode || shippingLine),
        status: 'registered',
        reference_number: referenceNo,
        active: true,
        metadata: {
          shipsgo_container_id: data.containerId,
          shipsgo_tracking_id: data.trackingId,
          shipsgo_request_id: data.requestId,
          shipsgo_response: data,
          added_by: user.email,
          added_at: new Date().toISOString()
        }
      };

      const { error: dbError } = await supabase
        .from('trackings')
        .upsert(trackingData, {
          onConflict: 'tracking_number,organizzazione_id'
        });

      if (dbError) {
        console.error('Database error:', dbError);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Container aggiunto al tracking ShipsGo',
        data: {
          containerNumber: containerNumber,
          containerId: data.containerId,
          trackingId: data.trackingId,
          requestId: data.requestId,
          shippingLine: shipsgoLine,
          referenceNo: trackingRequest.referenceNo
        }
      })
    };

  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

function getCarrierName(code) {
  const names = {
    'MAEU': 'MAERSK',
    'MSCU': 'MSC',
    'CMDU': 'CMA CGM',
    'COSU': 'COSCO',
    'HLCU': 'HAPAG-LLOYD',
    'ONEY': 'ONE',
    'EGLV': 'EVERGREEN',
    'YMLU': 'YANG MING',
    'ZIMU': 'ZIM',
    'HDMU': 'HMM'
  };
  return names[code] || code;
}