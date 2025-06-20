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

// Mapping stati IT -> EN
const STATUS_MAPPING = {
  'CONSEGNATO': 'delivered',
  'IN TRANSITO': 'in_transit',
  'IN PREPARAZIONE': 'pending',
  'RITIRATO': 'picked_up',
  'IN DOGANA': 'customs',
  'ANNULLATO': 'cancelled'
};

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
    const { organizationId, userId } = await getAuthInfo(event);
    console.log('🏢 Organization ID:', organizationId, 'User ID:', userId);

    // Router per i diversi metodi HTTP
    switch (event.httpMethod) {
      case 'GET':
        return await handleGet(event, organizationId);
      case 'POST':
        return await handlePost(event, organizationId, userId);
      case 'PUT':
        return await handlePut(event, organizationId);
      case 'DELETE':
        return await handleDelete(event, organizationId);
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

// ===== Estrai info autenticazione dal JWT =====
async function getAuthInfo(event) {
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('⚠️ No auth token found, using defaults');
      return { organizationId: DEFAULT_ORG_ID, userId: null };
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Verifica il token e ottieni l'utente
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.log('⚠️ Invalid token, using defaults');
      return { organizationId: DEFAULT_ORG_ID, userId: null };
    }

    // Ottieni organizzazione_id dal profilo
    const { data: profile } = await supabase
      .from('profiles')
      .select('organizzazione_id')
      .eq('id', user.id)
      .single();
    
    const organizationId = profile?.organizzazione_id || DEFAULT_ORG_ID;
    
    return { organizationId, userId: user.id };
  } catch (error) {
    console.error('❌ Error extracting auth info:', error);
    return { organizationId: DEFAULT_ORG_ID, userId: null };
  }
}

// ===== GET - Ottieni spedizioni =====
async function handleGet(event, organizzazione_id) {
  const params = event.queryStringParameters || {};
  
  try {
    if (params.id) {
      // Ottieni singola spedizione con tutti i campi
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

      // Aggiungi campo status se manca
      if (!data.status && data.stato_spedizione) {
        data.status = STATUS_MAPPING[data.stato_spedizione.toUpperCase()] || 'pending';
      }

      return createResponse(200, data);
    } else {
      // Lista con filtri e paginazione
      const page = parseInt(params.page) || 1;
      const limit = parseInt(params.limit) || 10;
      const offset = (page - 1) * limit;
      
      // Costruisci query base
      let query = supabase
        .from('shipments')
        .select('*', { count: 'exact' })
        .eq('organizzazione_id', organizzazione_id);
      
      // Filtri avanzati
      if (params.status) {
        // Supporta sia status EN che stato_spedizione IT
        if (Object.values(STATUS_MAPPING).includes(params.status)) {
          query = query.eq('status', params.status);
        } else {
          query = query.eq('stato_spedizione', params.status);
        }
      }
      
      if (params.carrier) {
        query = query.eq('spedizioniere', params.carrier);
      }
      
      if (params.supplier) {
        query = query.eq('fornitore', params.supplier);
      }
      
      if (params.search) {
        // Ricerca su più campi
        query = query.or(`
          rif_spedizione.ilike.%${params.search}%,
          fornitore.ilike.%${params.search}%,
          n_oda.ilike.%${params.search}%,
          cod_art.ilike.%${params.search}%,
          descrizione.ilike.%${params.search}%
        `);
      }
      
      // Filtri data
      if (params.date_from) {
        query = query.gte('created_at', params.date_from);
      }
      if (params.date_to) {
        query = query.lte('created_at', params.date_to);
      }
      
      if (params.departure_from) {
        query = query.gte('data_partenza', params.departure_from);
      }
      if (params.departure_to) {
        query = query.lte('data_partenza', params.departure_to);
      }
      
      // Filtri numerici
      if (params.min_cost) {
        query = query.gte('costo_trasporto', parseFloat(params.min_cost));
      }
      if (params.max_cost) {
        query = query.lte('costo_trasporto', parseFloat(params.max_cost));
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

      // Aggiungi status EN a tutti i record se manca
      const enrichedData = (data || []).map(shipment => {
        if (!shipment.status && shipment.stato_spedizione) {
          shipment.status = STATUS_MAPPING[shipment.stato_spedizione.toUpperCase()] || 'pending';
        }
        return shipment;
      });

      console.log(`✅ Retrieved ${enrichedData.length} shipments for org ${organizzazione_id}`);
      
      const response = {
        data: enrichedData,
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit)
        },
        filters: {
          status: params.status,
          carrier: params.carrier,
          supplier: params.supplier,
          search: params.search
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
async function handlePost(event, organizzazione_id, user_id) {
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

    // Prepara dati per inserimento
    const cleanData = {
      ...cleanShipmentData(shipmentData),
      organizzazione_id: organizzazione_id,
      user_id: user_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Calcola campi derivati
    if (cleanData.data_partenza && cleanData.data_arrivo_effettiva && !cleanData.transit_time_giorni) {
      const departure = new Date(cleanData.data_partenza);
      const arrival = new Date(cleanData.data_arrivo_effettiva);
      cleanData.transit_time_giorni = Math.floor((arrival - departure) / (1000 * 60 * 60 * 24));
    }

    // Calcola valore se manca e abbiamo qty e costo unitario
    if (!cleanData.valore && cleanData.qty && cleanData.costo_unitario_trasporto) {
      cleanData.valore = cleanData.qty * cleanData.costo_unitario_trasporto;
    }
    
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

    // Rimuovi ID e prepara dati aggiornamento
    const { id: _, organizzazione_id: __, ...updateData } = cleanShipmentData(shipmentData);
    updateData.updated_at = new Date().toISOString();

    // Ricalcola campi derivati se necessario
    if (updateData.data_partenza && updateData.data_arrivo_effettiva) {
      const departure = new Date(updateData.data_partenza);
      const arrival = new Date(updateData.data_arrivo_effettiva);
      updateData.transit_time_giorni = Math.floor((arrival - departure) / (1000 * 60 * 60 * 24));
    }

    // Aggiorna nel database
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

  if (data.qty !== undefined && data.qty !== null && data.qty < 0) {
    errors.push('Quantity cannot be negative');
  }

  if (data.anno && (data.anno < 2020 || data.anno > 2030)) {
    errors.push('Year must be between 2020 and 2030');
  }

  if (data.costo_trasporto !== undefined && data.costo_trasporto < 0) {
    errors.push('Transport cost cannot be negative');
  }

  if (data.valore !== undefined && data.valore < 0) {
    errors.push('Value cannot be negative');
  }

  if (data.percentuale_dazio !== undefined) {
    if (data.percentuale_dazio < 0 || data.percentuale_dazio > 100) {
      errors.push('Customs duty must be between 0 and 100');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Pulisce e formatta i dati prima del salvataggio
function cleanShipmentData(data) {
  const cleaned = {};

  // Lista completa di tutti i campi validi
  const allowedFields = [
    'rif_spedizione', 'n_oda', 'anno', 'cod_art', 'fornitore', 'um', 
    'qty', 'fattura_fornitore', 'costo_trasporto', 'tipo_spedizione', 
    'spedizioniere', 'compagnia', 'stato_spedizione', 'data_partenza', 
    'data_arrivo_effettiva', 'percentuale_dazio', 'descrizione',
    'descrizione_estesa', 'costo_unitario_trasporto', 'transit_time_giorni',
    'ritardo_giorni', 'valore', 'status', 'carrier', 'destination', 'notes',
    'tracking_number'
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

  // Trim stringhe
  ['rif_spedizione', 'fornitore', 'spedizioniere', 'compagnia', 'n_oda'].forEach(field => {
    if (cleaned[field] && typeof cleaned[field] === 'string') {
      cleaned[field] = cleaned[field].trim();
    }
  });

  // Mappa stato_spedizione italiano a status inglese
  if (cleaned.stato_spedizione && !cleaned.status) {
    const statoUpper = cleaned.stato_spedizione.toUpperCase();
    cleaned.status = STATUS_MAPPING[statoUpper] || 'pending';
  }

  // Se carrier non è specificato, usa spedizioniere
  if (!cleaned.carrier && cleaned.spedizioniere) {
    cleaned.carrier = cleaned.spedizioniere;
  }

  // Converti stringhe vuote in null per i campi numerici
  ['qty', 'anno', 'costo_trasporto', 'percentuale_dazio', 'costo_unitario_trasporto', 
   'transit_time_giorni', 'ritardo_giorni', 'valore'].forEach(field => {
    if (cleaned[field] === '' || cleaned[field] === undefined) {
      cleaned[field] = null;
    } else if (cleaned[field] !== null) {
      // Converti in numero
      if (field === 'anno' || field === 'transit_time_giorni' || field === 'ritardo_giorni') {
        cleaned[field] = parseInt(cleaned[field]) || null;
      } else {
        cleaned[field] = parseFloat(cleaned[field]) || null;
      }
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