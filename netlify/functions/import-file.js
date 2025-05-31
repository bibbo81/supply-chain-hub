const { createClient } = require('@supabase/supabase-js');
const Papa = require('papaparse');
const XLSX = require('xlsx');

// Inizializza client Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Headers CORS per tutte le risposte
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

// ID organizzazione di default per test
const DEFAULT_ORG_ID = 'bb70d86e-bf38-4a85-adc3-76be46705d52';

// Mappatura colonne per import
const COLUMN_MAPPING = {
  // Colonne Excel/CSV -> campi database
  'RIF. SPEDIZIONE': 'rif_spedizione',
  'N. ODA': 'n_oda',
  'ANNO': 'anno',
  'COD. ART.': 'cod_art',
  'FORNITORE': 'fornitore',
  'UM': 'um',
  'QTY': 'qty',
  'FATTURA FORNITORE': 'fattura_fornitore',
  'COSTO TRASPORTO': 'costo_trasporto',
  'TIPO SPEDIZIONE': 'tipo_spedizione',
  'SPEDIZIONIERE': 'spedizioniere',
  'COMPAGNIA': 'compagnia',
  'STATO SPEDIZIONE': 'stato_spedizione',
  'DATA PARTENZA': 'data_partenza',
  'DATA ARRIVO': 'data_arrivo_effettiva',
  'PERCENTUALE DAZIO': 'percentuale_dazio'
};

// Handler principale della function
exports.handler = async (event, context) => {
  console.log('📥 Import File API called:', event.httpMethod);
  
  // Gestisci preflight CORS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  // Solo POST è permesso
  if (event.httpMethod !== 'POST') {
    return createResponse(405, { error: 'Method not allowed' });
  }

  try {
    // Estrai organizzazione_id dal token JWT o usa default
    const organizzazione_id = await getOrganizzazioneId(event);
    console.log('🏢 Organization ID:', organizzazione_id);

    // Parse del body
    const { file, filename, type } = JSON.parse(event.body);

    if (!file) {
      return createResponse(400, { error: 'File mancante' });
    }

    // Determina il tipo di file
    const fileType = type || detectFileType(filename);
    console.log('📄 File type:', fileType);

    // Processa il file in base al tipo
    let data;
    if (fileType === 'csv') {
      data = await processCSV(file);
    } else if (fileType === 'excel') {
      data = await processExcel(file);
    } else {
      return createResponse(400, { 
        error: 'Tipo file non supportato. Usa CSV o Excel (.xlsx, .xls)' 
      });
    }

    console.log(`📊 Parsed ${data.length} rows`);

    // Importa i dati nel database
    const result = await importData(data, organizzazione_id);

    return createResponse(200, {
      message: 'Import completato con successo',
      result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error in import-file function:', error);
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

// ===== Rileva tipo file dall'estensione =====
function detectFileType(filename) {
  if (!filename) return null;
  
  const ext = filename.toLowerCase().split('.').pop();
  
  if (ext === 'csv') return 'csv';
  if (['xlsx', 'xls'].includes(ext)) return 'excel';
  
  return null;
}

// ===== Processa file CSV =====
async function processCSV(fileContent) {
  return new Promise((resolve, reject) => {
    // Decodifica base64 se necessario
    const csvString = fileContent.includes('base64,') 
      ? Buffer.from(fileContent.split('base64,')[1], 'base64').toString('utf-8')
      : fileContent;

    Papa.parse(csvString, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          console.error('CSV parsing errors:', results.errors);
        }
        resolve(results.data);
      },
      error: (error) => {
        reject(new Error(`Errore parsing CSV: ${error.message}`));
      }
    });
  });
}

// ===== Processa file Excel =====
async function processExcel(fileContent) {
  try {
    // Decodifica base64
    const buffer = Buffer.from(fileContent.split('base64,')[1], 'base64');
    
    // Leggi il workbook
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    // Prendi il primo sheet
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Converti in JSON
    const data = XLSX.utils.sheet_to_json(worksheet, {
      raw: false, // Formatta date come stringhe
      dateNF: 'yyyy-mm-dd'
    });

    return data;
  } catch (error) {
    throw new Error(`Errore parsing Excel: ${error.message}`);
  }
}

// ===== Importa dati nel database =====
async function importData(data, organizzazione_id) {
  const results = {
    total: data.length,
    imported: 0,
    skipped: 0,
    errors: []
  };

  // Batch size per insert
  const BATCH_SIZE = 100;
  
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE);
    const mappedBatch = [];

    for (const row of batch) {
      try {
        const mappedRow = mapRowToDatabase(row, organizzazione_id);
        
        // Valida riga
        const validation = validateShipmentData(mappedRow);
        if (!validation.isValid) {
          results.skipped++;
          results.errors.push({
            row: i + batch.indexOf(row) + 1,
            errors: validation.errors
          });
          continue;
        }

        mappedBatch.push(mappedRow);
      } catch (error) {
        results.skipped++;
        results.errors.push({
          row: i + batch.indexOf(row) + 1,
          error: error.message
        });
      }
    }

    // Inserisci il batch
    if (mappedBatch.length > 0) {
      const { error } = await supabase
        .from('spedizioni')
        .upsert(mappedBatch, {
          onConflict: 'rif_spedizione,organizzazione_id',
          ignoreDuplicates: false
        });

      if (error) {
        console.error('Batch insert error:', error);
        results.errors.push({
          batch: `${i + 1}-${Math.min(i + BATCH_SIZE, data.length)}`,
          error: error.message
        });
      } else {
        results.imported += mappedBatch.length;
      }
    }
  }

  return results;
}

// ===== Mappa riga Excel/CSV ai campi database =====
function mapRowToDatabase(row, organizzazione_id) {
  const mapped = {
    organizzazione_id: organizzazione_id
  };

  // Mappa le colonne usando il mapping definito
  for (const [excelCol, dbField] of Object.entries(COLUMN_MAPPING)) {
    if (row[excelCol] !== undefined && row[excelCol] !== null && row[excelCol] !== '') {
      mapped[dbField] = row[excelCol];
    }
  }

  // Conversioni specifiche
  if (mapped.cod_art) {
    // Assicurati che sia formato 00000000
    mapped.cod_art = String(mapped.cod_art).replace(/\D/g, '').padStart(8, '0');
  }

  if (mapped.anno) {
    mapped.anno = parseInt(mapped.anno) || null;
  }

  if (mapped.qty) {
    mapped.qty = parseFloat(mapped.qty) || null;
  }

  if (mapped.costo_trasporto) {
    mapped.costo_trasporto = parseFloat(mapped.costo_trasporto) || null;
  }

  if (mapped.percentuale_dazio) {
    mapped.percentuale_dazio = parseFloat(mapped.percentuale_dazio) || null;
  }

  // Formatta date
  if (mapped.data_partenza) {
    mapped.data_partenza = formatDate(mapped.data_partenza);
  }

  if (mapped.data_arrivo_effettiva) {
    mapped.data_arrivo_effettiva = formatDate(mapped.data_arrivo_effettiva);
  }

  return mapped;
}

// ===== Formatta data per PostgreSQL =====
function formatDate(dateValue) {
  if (!dateValue) return null;

  try {
    // Se è già una data valida ISO
    const date = new Date(dateValue);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }

    // Prova formati comuni italiani
    const parts = dateValue.toString().split(/[\/-]/);
    if (parts.length === 3) {
      // Assume DD/MM/YYYY o DD-MM-YYYY
      const day = parseInt(parts[0]);
      const month = parseInt(parts[1]);
      const year = parseInt(parts[2]);
      
      if (year > 1900 && year < 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

// ===== Valida dati spedizione =====
function validateShipmentData(data) {
  const errors = [];

  // Campo obbligatorio
  if (!data.rif_spedizione || data.rif_spedizione.trim() === '') {
    errors.push('RIF. SPEDIZIONE è obbligatorio');
  }

  // Validazioni formato
  if (data.cod_art && !/^[0-9]{8}$/.test(data.cod_art)) {
    errors.push('COD. ART. deve essere 8 cifre numeriche');
  }

  if (data.anno && (data.anno < 2020 || data.anno > 2030)) {
    errors.push('ANNO deve essere tra 2020 e 2030');
  }

  if (data.qty !== null && data.qty !== undefined && data.qty < 0) {
    errors.push('QTY non può essere negativo');
  }

  if (data.costo_trasporto !== null && data.costo_trasporto !== undefined && data.costo_trasporto < 0) {
    errors.push('COSTO TRASPORTO non può essere negativo');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// ===== UTILITY FUNCTIONS =====

// Crea risposta HTTP standardizzata
function createResponse(statusCode, data) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(data, null, 2)
  };
}