// netlify/functions/shipments.js
const { createClient } = require('@supabase/supabase-js');

// Inizializza client Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Headers CORS per tutte le risposte
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

// ID organizzazione di default per test
const DEFAULT_ORG_ID = 'bb70d86e-bf38-4a85-adc3-76be46705d52';

// Handler principale della function
exports.handler = async (event, context) => {
  console.log('🚀 Shipments API called:', event.httpMethod, event.path);
  
  // Gestisci preflight CORS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    // Estrai organizzazione_id dal token JWT o usa default
    const organizzazione_id = await getOrganizzazioneId(event);
    console.log('🏢 Organization ID:', organizzazione_id);

    // Router per i diversi metodi HTTP
    switch (event.httpMethod) {
      case 'GET':
        return await handleGet(event, organizzazione_id);
      case 'POST':
        return await handlePost(event, organizzazione_id);
      case 'PUT':
        return await handlePut(event, organizzazione_id);
      case 'DELETE':
        return await handleDelete(event, organizzazione_id);
      default:
        return createResponse(405, { error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('❌ Error in shipments function:', error);
    return createResponse(500, { 
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// ===== Estrai organizzazione_id dal JWT o usa default =====
async function getOrganizzazioneId(event) {
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('⚠️ No auth token found, using default organization');
      return DEFAULT_ORG_ID;
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Verifica il token e ottieni l'utente
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.log('⚠️ Invalid token, using default organization');
      return DEFAULT_ORG_ID;
    }

    // Ottieni organizzazione_id dal profilo
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('organizzazione_id')
      .eq('id', user.id)
      .single();
    
    if (profileError || !profile?.organizzazione_id) {
      console.log('⚠️ No organization ID in profile, using default');
      return DEFAULT_ORG_ID;
    }

    return profile.organizzazione_id;
  } catch (error) {
    console.error('❌ Error extracting organization ID:', error);
    return DEFAULT_ORG_ID;
  }
}

// ===== GET - Ottieni spedizioni =====
async function handleGet(event, organizzazione_id) {
  const params = event.queryStringParameters || {};
  
  try {
    if (params.id) {
      // Ottieni singola spedizione
      const { data, error } = await supabase
        .from('shipments')
        .select('*')
        .eq('id', params.id)
        .eq('organizzazione_id', organizzazione_id)
        .single();

      if (error) throw error;
      
      if (!data) {
        return createResponse(404, { error: 'Shipment not found' });
      }

      return createResponse(200, data);
    } else {
      // Parametri di paginazione
      const page = parseInt(params.page) || 1;
      const limit = parseInt(params.limit) || 10;
      const offset = (page - 1) * limit;
      
      // Costruisci query base
      let query = supabase
        .from('shipments')
        .select('*', { count: 'exact' })
        .eq('organizzazione_id', organizzazione_id);
      
      // Applica filtri
      if (params.status) {
        query = query.eq('stato_spedizione', params.status);
      }
      if (params.carrier) {
        query = query.eq('compagnia', params.carrier);
      }
      if (params.search) {
        query = query.or(`rif_spedizione.ilike.%${params.search}%,fornitore.ilike.%${params.search}%,n_oda.ilike.%${params.search}%`);
      }
      if (params.date_from) {
        query = query.gte('created_at', params.date_from);
      }
      if (params.date_to) {
        query = query.lte('created_at', params.date_to);
      }
      
      // Ordinamento
      const orderBy = params.order_by || 'created_at';
      const orderDirection = params.order_direction === 'asc' ? true : false;
      query = query.order(orderBy, { ascending: orderDirection });
      
      // Paginazione
      query = query.range(offset, offset + limit - 1);
      
      const { data, error, count } = await query;
      
      if (error) {
        console.error('Shipments query error:', error);
        throw error;
      }

      console.log(`✅ Retrieved ${data?.length || 0} shipments for org ${organizzazione_id}`);
      
      const response = {
        data: data || [],
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit)
        }
      };
      
      return createResponse(200, response);
    }
  } catch (error) {
    console.error('❌ Error in GET:', error);
    throw error;
  }
}

// ===== POST - Crea nuova spedizione =====
async function handlePost(event, organizzazione_id) {
  try {
    const shipmentData = JSON.parse(event.body);
    console.log('📦 Creating shipment:', shipmentData.rif_spedizione);

    // Validazione dati obbligatori
    const validation = validateShipmentData(shipmentData);
    if (!validation.isValid) {
      return createResponse(400, { 
        error: 'Invalid data', 
        details: validation.errors 
      });
    }

    // Prepara dati per inserimento con organizzazione_id
    const cleanData = {
      ...cleanShipmentData(shipmentData),
      organizzazione_id: organizzazione_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    // Inserisci nel database
    const { data, error } = await supabase
      .from('shipments')
      .insert([cleanData])
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        return createResponse(409, { 
          error: 'RIF. SPEDIZIONE already exists for this organization',
          code: 'DUPLICATE_REFERENCE'
        });
      }
      throw error;
    }

    console.log('✅ Shipment created:', data.id, 'for org:', organizzazione_id);
    
    return createResponse(201, data);

  } catch (error) {
    console.error('❌ Error in POST:', error);
    
    if (error.message.includes('JSON')) {
      return createResponse(400, { error: 'Invalid JSON format' });
    }
    
    throw error;
  }
}

// ===== PUT - Aggiorna spedizione =====
async function handlePut(event, organizzazione_id) {
  try {
    const shipmentData = JSON.parse(event.body);
    const { id } = shipmentData;

    if (!id) {
      return createResponse(400, { error: 'Shipment ID is required' });
    }

    console.log('📝 Updating shipment:', id);

    // Validazione dati
    const validation = validateShipmentData(shipmentData, true); // isUpdate = true
    if (!validation.isValid) {
      return createResponse(400, { 
        error: 'Invalid data', 
        details: validation.errors 
      });
    }

    // Rimuovi ID dai dati di aggiornamento
    const { id: _, ...updateData } = cleanShipmentData(shipmentData);
    updateData.updated_at = new Date().toISOString();

    // Aggiorna nel database solo per l'organizzazione corrente
    const { data, error } = await supabase
      .from('shipments')
      .update(updateData)
      .eq('id', id)
      .eq('organizzazione_id', organizzazione_id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return createResponse(409, { 
          error: 'RIF. SPEDIZIONE already exists for this organization',
          code: 'DUPLICATE_REFERENCE'
        });
      }
      throw error;
    }

    if (!data) {
      return createResponse(404, { error: 'Shipment not found or not authorized' });
    }

    console.log('✅ Shipment updated:', id, 'for org:', organizzazione_id);

    return createResponse(200, data);

  } catch (error) {
    console.error('❌ Error in PUT:', error);
    
    if (error.message.includes('JSON')) {
      return createResponse(400, { error: 'Invalid JSON format' });
    }
    
    throw error;
  }
}

// ===== DELETE - Elimina spedizione =====
async function handleDelete(event, organizzazione_id) {
  try {
    const { id } = event.queryStringParameters || {};

    if (!id) {
      return createResponse(400, { error: 'Shipment ID is required' });
    }

    console.log('🗑️ Deleting shipment:', id);

    // Prima verifica che la spedizione appartenga all'organizzazione
    const { data: existing, error: checkError } = await supabase
      .from('shipments')
      .select('id, rif_spedizione')
      .eq('id', id)
      .eq('organizzazione_id', organizzazione_id)
      .single();

    if (checkError || !existing) {
      return createResponse(404, { error: 'Shipment not found or not authorized' });
    }

    // Elimina dal database
    const { error } = await supabase
      .from('shipments')
      .delete()
      .eq('id', id)
      .eq('organizzazione_id', organizzazione_id);

    if (error) throw error;

    console.log('✅ Shipment deleted:', id, 'for org:', organizzazione_id);

    return createResponse(200, {
      message: 'Shipment deleted successfully',
      deletedId: id,
      deletedRef: existing.rif_spedizione
    });

  } catch (error) {
    console.error('❌ Error in DELETE:', error);
    throw error;
  }
}

// ===== UTILITY FUNCTIONS =====

// Valida i dati della spedizione
function validateShipmentData(data, isUpdate = false) {
  const errors = [];

  // Campi obbligatori per creazione
  if (!isUpdate) {
    if (!data.rif_spedizione || data.rif_spedizione.trim() === '') {
      errors.push('RIF. SPEDIZIONE is required');
    }
  }

  // Validazioni sempre attive
  if (data.cod_art && !/^[0-9]{8}$/.test(data.cod_art)) {
    errors.push('COD. ART. must be 8 numeric digits');
  }

  if (data.qty !== undefined && data.qty !== null && data.qty <= 0) {
    errors.push('Quantity must be greater than zero');
  }

  if (data.anno && (data.anno < 2020 || data.anno > 2030)) {
    errors.push('Year must be between 2020 and 2030');
  }

  if (data.costo_trasporto && data.costo_trasporto < 0) {
    errors.push('Transport cost cannot be negative');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Pulisce e formatta i dati prima del salvataggio
function cleanShipmentData(data) {
  const cleaned = {};

  // Copia solo i campi validi (usa i nomi italiani del DB)
  const allowedFields = [
    'rif_spedizione', 'n_oda', 'anno', 'cod_art', 'fornitore', 'um', 
    'qty', 'fattura_fornitore', 'costo_trasporto', 'tipo_spedizione', 
    'spedizioniere', 'compagnia', 'stato_spedizione', 'data_partenza', 
    'data_arrivo_effettiva', 'percentuale_dazio', 'descrizione',
    'descrizione_estesa', 'costo_unitario_trasporto', 'transit_time_giorni',
    'ritardo_giorni'
  ];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      cleaned[field] = data[field];
    }
  }

  // Formattazioni specifiche
  if (cleaned.cod_art) {
    // Assicurati che sia formato 00000000
    cleaned.cod_art = cleaned.cod_art.toString().replace(/\D/g, '').padStart(8, '0');
  }

  if (cleaned.rif_spedizione) {
    cleaned.rif_spedizione = cleaned.rif_spedizione.trim();
  }

  if (cleaned.fornitore) {
    cleaned.fornitore = cleaned.fornitore.trim();
  }

  // Converti stringhe vuote in null per i campi numerici
  ['qty', 'anno', 'costo_trasporto', 'percentuale_dazio', 'costo_unitario_trasporto', 'transit_time_giorni', 'ritardo_giorni'].forEach(field => {
    if (cleaned[field] === '' || cleaned[field] === undefined) {
      cleaned[field] = null;
    }
  });

  // Converti stringhe vuote in null per le date
  ['data_partenza', 'data_arrivo_effettiva'].forEach(field => {
    if (cleaned[field] === '') {
      cleaned[field] = null;
    }
  });

  return cleaned;
}

// Crea risposta HTTP standardizzata
function createResponse(statusCode, data) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(data, null, 2)
  };
}