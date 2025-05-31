// ===== NETLIFY FUNCTION: SHIPMENTS API - VERSIONE MULTI-TENANT =====
// Gestisce tutte le operazioni CRUD per le spedizioni con supporto multi-tenancy
// Endpoint: /.netlify/functions/shipments

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

    // Estrai organizzazione_id dai metadati dell'utente
    const organizzazione_id = user.app_metadata?.organizzazione_id || user.user_metadata?.organizzazione_id;
    
    if (!organizzazione_id) {
      console.log('⚠️ No organization ID in user metadata, using default');
      return DEFAULT_ORG_ID;
    }

    return organizzazione_id;
  } catch (error) {
    console.error('❌ Error extracting organization ID:', error);
    return DEFAULT_ORG_ID;
  }
}

// ===== GET - Ottieni spedizioni =====
async function handleGet(event, organizzazione_id) {
  const { id } = event.queryStringParameters || {};
  
  try {
    if (id) {
      // Ottieni singola spedizione
      const { data, error } = await supabase
        .from('shipments')
        .select('*')
        .eq('id', id)
        .eq('organizzazione_id', organizzazione_id)
        .single();

      if (error) throw error;
      
      if (!data) {
        return createResponse(404, { error: 'Spedizione non trovata' });
      }

      return createResponse(200, transformShipmentData(data));
    } else {
      // Ottieni tutte le spedizioni dell'organizzazione
      const { data, error } = await supabase
        .from('shipments')
        .select('*')
        .eq('organizzazione_id', organizzazione_id)
        .order('created_at', { ascending: false })
        .limit(1000); // Limite per performance

      if (error) throw error;

      const transformedData = data.map(transformShipmentData);
      
      console.log(`✅ Retrieved ${transformedData.length} shipments for org ${organizzazione_id}`);
      
      return createResponse(200, {
        shipments: transformedData,
        total: transformedData.length,
        timestamp: new Date().toISOString()
      });
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
        error: 'Dati non validi', 
        details: validation.errors 
      });
    }

    // Prepara dati per inserimento con organizzazione_id
    const cleanData = {
      ...cleanShipmentData(shipmentData),
      organizzazione_id: organizzazione_id
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
          error: 'RIF. SPEDIZIONE già esistente per questa organizzazione',
          code: 'DUPLICATE_REFERENCE'
        });
      }
      throw error;
    }

    console.log('✅ Shipment created:', data.id, 'for org:', organizzazione_id);
    
    return createResponse(201, {
      message: 'Spedizione creata con successo',
      shipment: transformShipmentData(data)
    });

  } catch (error) {
    console.error('❌ Error in POST:', error);
    
    if (error.message.includes('JSON')) {
      return createResponse(400, { error: 'Formato JSON non valido' });
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
      return createResponse(400, { error: 'ID spedizione richiesto' });
    }

    console.log('📝 Updating shipment:', id);

    // Validazione dati
    const validation = validateShipmentData(shipmentData, true); // isUpdate = true
    if (!validation.isValid) {
      return createResponse(400, { 
        error: 'Dati non validi', 
        details: validation.errors 
      });
    }

    // Rimuovi ID dai dati di aggiornamento
    const { id: _, ...updateData } = cleanShipmentData(shipmentData);

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
          error: 'RIF. SPEDIZIONE già esistente per questa organizzazione',
          code: 'DUPLICATE_REFERENCE'
        });
      }
      throw error;
    }

    if (!data) {
      return createResponse(404, { error: 'Spedizione non trovata o non autorizzato' });
    }

    console.log('✅ Shipment updated:', id, 'for org:', organizzazione_id);

    return createResponse(200, {
      message: 'Spedizione aggiornata con successo',
      shipment: transformShipmentData(data)
    });

  } catch (error) {
    console.error('❌ Error in PUT:', error);
    
    if (error.message.includes('JSON')) {
      return createResponse(400, { error: 'Formato JSON non valido' });
    }
    
    throw error;
  }
}

// ===== DELETE - Elimina spedizione =====
async function handleDelete(event, organizzazione_id) {
  try {
    const { id } = event.queryStringParameters || {};

    if (!id) {
      return createResponse(400, { error: 'ID spedizione richiesto' });
    }

    console.log('🗑️ Deleting shipment:', id);

    // Prima verifica che la spedizione appartenga all'organizzazione
    const { data: existing, error: checkError } = await supabase
      .from('shipments')
      .select('id')
      .eq('id', id)
      .eq('organizzazione_id', organizzazione_id)
      .single();

    if (checkError || !existing) {
      return createResponse(404, { error: 'Spedizione non trovata o non autorizzato' });
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
      message: 'Spedizione eliminata con successo',
      deletedId: id
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
      errors.push('RIF. SPEDIZIONE è obbligatorio');
    }
  }

  // Validazioni sempre attive
  if (data.cod_art && !/^[0-9]{8}$/.test(data.cod_art)) {
    errors.push('COD. ART. deve essere 8 cifre numeriche');
  }

  if (data.qty !== undefined && data.qty !== null && data.qty <= 0) {
    errors.push('Quantità deve essere maggiore di zero');
  }

  if (data.anno && (data.anno < 2020 || data.anno > 2030)) {
    errors.push('Anno deve essere tra 2020 e 2030');
  }

  if (data.costo_trasporto && data.costo_trasporto < 0) {
    errors.push('Costo trasporto non può essere negativo');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Pulisce e formatta i dati prima del salvataggio
function cleanShipmentData(data) {
  const cleaned = {};

  // Copia solo i campi validi
  const allowedFields = [
    'rif_spedizione', 'n_oda', 'anno', 'cod_art', 'fornitore', 'um', 
    'qty', 'fattura_fornitore', 'costo_trasporto', 'tipo_spedizione', 
    'spedizioniere', 'compagnia', 'stato_spedizione', 'data_partenza', 
    'data_arrivo_effettiva', 'percentuale_dazio'
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
  ['qty', 'anno', 'costo_trasporto', 'percentuale_dazio'].forEach(field => {
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

// Trasforma i dati dal database al formato frontend
function transformShipmentData(dbData) {
  return {
    id: dbData.id,
    rifSpedizione: dbData.rif_spedizione,
    nOda: dbData.n_oda,
    anno: dbData.anno,
    codArt: dbData.cod_art,
    descrizione: dbData.descrizione || '',
    descrizioneEstesa: dbData.descrizione_estesa || '',
    fornitore: dbData.fornitore,
    um: dbData.um || 'PZ',
    qty: dbData.qty,
    fatturaFornitore: dbData.fattura_fornitore,
    tipoSpedizione: dbData.tipo_spedizione || '',
    spedizioniere: dbData.spedizioniere || '',
    compagnia: dbData.compagnia || '',
    statoSpedizione: dbData.stato_spedizione || '',
    dataPartenza: dbData.data_partenza || '',
    dataArrivo: dbData.data_arrivo_effettiva || '',
    transitTime: dbData.transit_time_giorni || '',
    ritardo: dbData.ritardo_giorni || 0,
    costoTrasporto: dbData.costo_trasporto || 0,
    costoUnitario: dbData.costo_unitario_trasporto || 0,
    dazio: dbData.percentuale_dazio || 0,
    createdAt: dbData.created_at,
    updatedAt: dbData.updated_at,
    // Aggiungi anche l'ID organizzazione per debug
    organizzazioneId: dbData.organizzazione_id
  };
}

// Crea risposta HTTP standardizzata
function createResponse(statusCode, data) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(data, null, 2)
  };
}
