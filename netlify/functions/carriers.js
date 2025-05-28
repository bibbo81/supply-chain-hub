// ===== NETLIFY FUNCTION: CARRIERS API =====
// Gestisce CRUD operazioni per spedizionieri
// Endpoint: /.netlify/functions/carriers

const { createClient } = require('@supabase/supabase-js');

// Inizializza client Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Headers CORS
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
  console.log('🚚 Carriers API called:', event.httpMethod);

  // Gestisci preflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    switch (event.httpMethod) {
      case 'GET':
        return await handleGet(event);
      case 'POST':
        return await handlePost(event);
      case 'PUT':
        return await handlePut(event);
      case 'DELETE':
        return await handleDelete(event);
      default:
        return createResponse(405, { error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('❌ Error in carriers function:', error);
    return createResponse(500, { 
      error: 'Internal server error',
      message: error.message 
    });
  }
};

// ===== GET - Ottieni spedizionieri =====
async function handleGet(event) {
  const { id, active_only } = event.queryStringParameters || {};
  
  try {
    if (id) {
      // Ottieni singolo spedizioniere
      const { data, error } = await supabase
        .from('carriers')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      
      if (!data) {
        return createResponse(404, { error: 'Spedizioniere non trovato' });
      }

      return createResponse(200, transformCarrierData(data));
    } else {
      // Ottieni tutti gli spedizionieri
      let query = supabase
        .from('carriers')
        .select('*')
        .order('name');

      // Filtro per solo attivi se richiesto
      if (active_only === 'true') {
        query = query.eq('is_active', true);
      }

      const { data, error } = await query;

      if (error) throw error;

      const transformedData = data.map(transformCarrierData);
      
      console.log(`✅ Retrieved ${transformedData.length} carriers`);
      
      return createResponse(200, {
        carriers: transformedData,
        total: transformedData.length
      });
    }
  } catch (error) {
    console.error('❌ Error in GET carriers:', error);
    throw error;
  }
}

// ===== POST - Crea nuovo spedizioniere =====
async function handlePost(event) {
  try {
    const carrierData = JSON.parse(event.body);
    console.log('🚚 Creating carrier:', carrierData.name);

    // Validazione
    const validation = validateCarrierData(carrierData);
    if (!validation.isValid) {
      return createResponse(400, { 
        error: 'Dati non validi', 
        details: validation.errors 
      });
    }

    // Prepara dati per inserimento
    const cleanData = cleanCarrierData(carrierData);
    
    // Inserisci nel database
    const { data, error } = await supabase
      .from('carriers')
      .insert([cleanData])
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        return createResponse(409, { 
          error: 'Codice spedizioniere già esistente',
          code: 'DUPLICATE_CODE'
        });
      }
      throw error;
    }

    console.log('✅ Carrier created:', data.id);
    
    return createResponse(201, {
      message: 'Spedizioniere creato con successo',
      carrier: transformCarrierData(data)
    });

  } catch (error) {
    console.error('❌ Error in POST carriers:', error);
    
    if (error.message.includes('JSON')) {
      return createResponse(400, { error: 'Formato JSON non valido' });
    }
    
    throw error;
  }
}

// ===== PUT - Aggiorna spedizioniere =====
async function handlePut(event) {
  try {
    const carrierData = JSON.parse(event.body);
    const { id } = carrierData;

    if (!id) {
      return createResponse(400, { error: 'ID spedizioniere richiesto' });
    }

    console.log('📝 Updating carrier:', id);

    // Validazione
    const validation = validateCarrierData(carrierData, true);
    if (!validation.isValid) {
      return createResponse(400, { 
        error: 'Dati non validi', 
        details: validation.errors 
      });
    }

    // Rimuovi ID dai dati di aggiornamento
    const { id: _, ...updateData } = cleanCarrierData(carrierData);

    // Aggiorna nel database
    const { data, error } = await supabase
      .from('carriers')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return createResponse(409, { 
          error: 'Codice spedizioniere già esistente',
          code: 'DUPLICATE_CODE'
        });
      }
      throw error;
    }

    if (!data) {
      return createResponse(404, { error: 'Spedizioniere non trovato' });
    }

    console.log('✅ Carrier updated:', id);

    return createResponse(200, {
      message: 'Spedizioniere aggiornato con successo',
      carrier: transformCarrierData(data)
    });

  } catch (error) {
    console.error('❌ Error in PUT carriers:', error);
    
    if (error.message.includes('JSON')) {
      return createResponse(400, { error: 'Formato JSON non valido' });
    }
    
    throw error;
  }
}

// ===== DELETE - Elimina/Disattiva spedizioniere =====
async function handleDelete(event) {
  try {
    const { id, permanent } = event.queryStringParameters || {};

    if (!id) {
      return createResponse(400, { error: 'ID spedizioniere richiesto' });
    }

    console.log('🗑️ Deleting carrier:', id, permanent ? '(permanent)' : '(soft delete)');

    if (permanent === 'true') {
      // Eliminazione permanente
      const { error } = await supabase
        .from('carriers')
        .delete()
        .eq('id', id);

      if (error) throw error;

      console.log('✅ Carrier permanently deleted:', id);

      return createResponse(200, {
        message: 'Spedizioniere eliminato definitivamente',
        deletedId: id
      });
    } else {
      // Soft delete (disattivazione)
      const { data, error } = await supabase
        .from('carriers')
        .update({ is_active: false })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      if (!data) {
        return createResponse(404, { error: 'Spedizioniere non trovato' });
      }

      console.log('✅ Carrier deactivated:', id);

      return createResponse(200, {
        message: 'Spedizioniere disattivato',
        carrier: transformCarrierData(data)
      });
    }

  } catch (error) {
    console.error('❌ Error in DELETE carriers:', error);
    throw error;
  }
}

// ===== UTILITY FUNCTIONS =====

// Valida i dati dello spedizioniere
function validateCarrierData(data, isUpdate = false) {
  const errors = [];

  // Campi obbligatori
  if (!data.name || data.name.trim() === '') {
    errors.push('Nome spedizioniere è obbligatorio');
  }

  if (!isUpdate && (!data.code || data.code.trim() === '')) {
    errors.push('Codice spedizioniere è obbligatorio');
  }

  // Validazioni formato
  if (data.contact_email && !isValidEmail(data.contact_email)) {
    errors.push('Email non valida');
  }

  if (data.website && !isValidUrl(data.website)) {
    errors.push('URL sito web non valido');
  }

  // Validazione shipping_types
  if (data.shipping_types && !Array.isArray(data.shipping_types)) {
    errors.push('Tipi di spedizione deve essere un array');
  }

  if (data.shipping_types) {
    const allowedTypes = ['MARE', 'AEREA', 'PARCEL', 'ROAD'];
    const invalidTypes = data.shipping_types.filter(type => !allowedTypes.includes(type));
    if (invalidTypes.length > 0) {
      errors.push(`Tipi di spedizione non validi: ${invalidTypes.join(', ')}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Pulisce e formatta i dati prima del salvataggio
function cleanCarrierData(data) {
  const cleaned = {};

  // Campi consentiti
  const allowedFields = [
    'name', 'code', 'shipping_types', 'contact_email', 
    'contact_phone', 'website', 'notes', 'is_active'
  ];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      cleaned[field] = data[field];
    }
  }

  // Formattazioni specifiche
  if (cleaned.name) {
    cleaned.name = cleaned.name.trim();
  }

  if (cleaned.code) {
    cleaned.code = cleaned.code.trim().toUpperCase();
  }

  if (cleaned.contact_email) {
    cleaned.contact_email = cleaned.contact_email.trim().toLowerCase();
  }

  if (cleaned.website) {
    cleaned.website = cleaned.website.trim();
    // Aggiungi https:// se manca il protocollo
    if (!/^https?:\/\//i.test(cleaned.website)) {
      cleaned.website = 'https://' + cleaned.website;
    }
  }

  // Assicurati che shipping_types sia JSON
  if (cleaned.shipping_types && !Array.isArray(cleaned.shipping_types)) {
    cleaned.shipping_types = [];
  }

  // Default per is_active
  if (cleaned.is_active === undefined) {
    cleaned.is_active = true;
  }

  return cleaned;
}

// Trasforma i dati dal database al formato frontend
function transformCarrierData(dbData) {
  return {
    id: dbData.id,
    name: dbData.name,
    code: dbData.code,
    shippingTypes: Array.isArray(dbData.shipping_types) ? dbData.shipping_types : [],
    contactEmail: dbData.contact_email,
    contactPhone: dbData.contact_phone,
    website: dbData.website,
    notes: dbData.notes,
    isActive: dbData.is_active,
    createdAt: dbData.created_at,
    updatedAt: dbData.updated_at
  };
}

// Validatori helper
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function isValidUrl(url) {
  try {
    new URL(url.startsWith('http') ? url : 'https://' + url);
    return true;
  } catch {
    return false;
  }
}

// Crea risposta HTTP standardizzata
function createResponse(statusCode, data) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(data, null, 2)
  };
}
