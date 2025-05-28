// ===== NETLIFY FUNCTION: IMPORT FILE API =====
// Gestisce l'import di file CSV e Excel
// Endpoint: /.netlify/functions/import-file

const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const Papa = require('papaparse');

// Inizializza client Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Headers CORS
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

// Limite dimensione file (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

exports.handler = async (event, context) => {
  console.log('📂 Import File API called:', event.httpMethod);

  // Gestisci preflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return createResponse(405, { error: 'Method not allowed' });
  }

  try {
    const { fileData, fileType, mapping, fileName } = JSON.parse(event.body);

    // Validazione input
    if (!fileData || !fileType || !mapping) {
      return createResponse(400, { 
        error: 'Parametri mancanti: fileData, fileType, mapping richiesti' 
      });
    }

    console.log(`📥 Processing ${fileType} file: ${fileName || 'unnamed'}`);

    // Controllo dimensione file (approssimativo)
    const fileSizeBytes = (fileData.length * 3) / 4; // base64 to bytes
    if (fileSizeBytes > MAX_FILE_SIZE) {
      return createResponse(413, { 
        error: `File troppo grande. Massimo ${MAX_FILE_SIZE / 1024 / 1024}MB consentiti` 
      });
    }

    // Parse del file
    let parsedData = [];
    
    if (fileType === 'xlsx' || fileType === 'xls') {
      parsedData = await parseExcelFile(fileData);
    } else if (fileType === 'csv') {
      parsedData = await parseCsvFile(fileData);
    } else {
      return createResponse(400, { error: 'Tipo file non supportato. Solo CSV e Excel.' });
    }

    console.log(`📋 Parsed ${parsedData.length} rows from file`);

    if (parsedData.length === 0) {
      return createResponse(400, { error: 'File vuoto o formato non valido' });
    }

    // Validazione mapping
    const mappingValidation = validateMapping(mapping, parsedData[0]);
    if (!mappingValidation.isValid) {
      return createResponse(400, { 
        error: 'Mapping colonne non valido', 
        details: mappingValidation.errors 
      });
    }

    // Trasforma dati usando il mapping
    const transformedData = await transformImportData(parsedData, mapping);
    
    console.log(`🔄 Transformed ${transformedData.validRecords.length} valid records`);

    // Import nel database
    const importResults = await bulkInsertShipments(transformedData.validRecords);

    // Prepara risultati dettagliati
    const results = {
      success: true,
      summary: {
        totalRows: parsedData.length,
        validRows: transformedData.validRecords.length,
        transformErrors: transformedData.errors.length,
        imported: importResults.success.length,
        importErrors: importResults.errors.length
      },
      imported: importResults.success,
      errors: [
        ...transformedData.errors.map(e => ({ type: 'transformation', ...e })),
        ...importResults.errors.map(e => ({ type: 'database', ...e }))
      ]
    };

    console.log(`✅ Import completed: ${results.summary.imported}/${results.summary.totalRows} records imported`);

    return createResponse(200, results);

  } catch (error) {
    console.error('❌ Error in import-file function:', error);
    
    if (error.message.includes('JSON')) {
      return createResponse(400, { error: 'Formato richiesta non valido' });
    }

    return createResponse(500, { 
      error: 'Errore interno del server',
      message: error.message 
    });
  }
};

// ===== PARSER FUNCTIONS =====

// Parse file Excel
async function parseExcelFile(base64Data) {
  try {
    // Decodifica base64
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Leggi workbook
    const workbook = XLSX.read(buffer, { 
      type: 'buffer',
      cellDates: true,
      cellNF: false,
      cellText: false
    });
    
    // Prendi il primo foglio
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Converti in JSON con header dalla prima riga
    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1, // Usa la prima riga come indici
      defval: '', // Valore default per celle vuote
      raw: false // Converti tutto in stringhe
    });
    
    if (jsonData.length < 2) {
      throw new Error('File deve contenere almeno header e una riga dati');
    }

    // Rimuovi righe completamente vuote
    const cleanData = jsonData.filter(row => 
      row.some(cell => cell !== null && cell !== undefined && cell !== '')
    );

    return cleanData;

  } catch (error) {
    console.error('❌ Error parsing Excel file:', error);
    throw new Error(`Errore parsing Excel: ${error.message}`);
  }
}

// Parse file CSV
async function parseCsvFile(base64Data) {
  try {
    // Decodifica base64
    const csvContent = Buffer.from(base64Data, 'base64').toString('utf-8');
    
    return new Promise((resolve, reject) => {
      Papa.parse(csvContent, {
        header: false, // Non usare header automatico
        skipEmptyLines: 'greedy',
        delimiter: '', // Auto-detect
        dynamicTyping: false, // Mantieni tutto come stringhe
        encoding: 'utf-8',
        complete: (results) => {
          if (results.errors.length > 0) {
            console.warn('⚠️ CSV parsing warnings:', results.errors);
          }
          
          if (results.data.length < 2) {
            reject(new Error('File CSV deve contenere almeno header e una riga dati'));
          } else {
            resolve(results.data);
          }
        },
        error: (error) => {
          reject(new Error(`Errore parsing CSV: ${error.message}`));
        }
      });
    });

  } catch (error) {
    console.error('❌ Error parsing CSV file:', error);
    throw new Error(`Errore parsing CSV: ${error.message}`);
  }
}

// ===== VALIDATION & TRANSFORMATION =====

// Valida mapping colonne
function validateMapping(mapping, firstRow) {
  const errors = [];
  const requiredFields = ['rif_spedizione', 'cod_art', 'qty'];
  
  // Controlla campi obbligatori
  for (const field of requiredFields) {
    if (!mapping[field] && mapping[field] !== 0) {
      errors.push(`Campo obbligatorio non mappato: ${field}`);
    }
  }
  
  // Controlla che gli indici siano validi
  const maxIndex = firstRow.length - 1;
  for (const [field, index] of Object.entries(mapping)) {
    if (index !== '' && (index < 0 || index > maxIndex)) {
      errors.push(`Indice colonna non valido per ${field}: ${index}`);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

// Trasforma dati importati
async function transformImportData(rawData, mapping) {
  const validRecords = [];
  const errors = [];
  
  // Skip header row
  const dataRows = rawData.slice(1);
  
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowIndex = i + 2; // +2 perché skippiamo header e gli array sono 0-based
    
    try {
      const record = extractRecordFromRow(row, mapping);
      
      // Validazioni specifiche
      const validation = validateImportRecord(record);
      if (!validation.isValid) {
        errors.push({
          row: rowIndex,
          data: row,
          errors: validation.errors
        });
        continue;
      }
      
      validRecords.push(record);
      
    } catch (error) {
      errors.push({
        row: rowIndex,
        data: row,
        errors: [error.message]
      });
    }
  }
  
  return { validRecords, errors };
}

// Estrae record da riga usando mapping
function extractRecordFromRow(row, mapping) {
  const record = {};
  
  // Estrai campi usando mapping
  for (const [field, index] of Object.entries(mapping)) {
    if (index !== '' && index !== null && index !== undefined) {
      const value = row[parseInt(index)] || '';
      record[field] = value.toString().trim();
    }
  }
  
  // Trasformazioni specifiche
  
  // COD. ART: formato 00000000
  if (record.cod_art) {
    record.cod_art = record.cod_art.replace(/\D/g, '').padStart(8, '0');
  }
  
  // Quantità: converti in numero
  if (record.qty) {
    record.qty = parseFloat(record.qty.replace(',', '.'));
    if (isNaN(record.qty)) {
      throw new Error('Quantità non è un numero valido');
    }
  }
  
  // Anno: converti in numero
  if (record.anno) {
    record.anno = parseInt(record.anno);
    if (isNaN(record.anno)) {
      throw new Error('Anno non è un numero valido');
    }
  }
  
  // Costo trasporto: converti in numero
  if (record.costo_trasporto) {
    record.costo_trasporto = parseFloat(record.costo_trasporto.replace(',', '.'));
    if (isNaN(record.costo_trasporto)) {
      record.costo_trasporto = 0;
    }
  }
  
  // U.M.: default
  if (!record.um) {
    record.um = 'PZ';
  }
  
  return record;
}

// Valida record importato
function validateImportRecord(record) {
  const errors = [];
  
  // Campi obbligatori
  if (!record.rif_spedizione) {
    errors.push('RIF. SPEDIZIONE obbligatorio');
  }
  
  if (!record.cod_art || record.cod_art.length !== 8) {
    errors.push('COD. ART. deve essere 8 cifre');
  }
  
  if (!record.qty || record.qty <= 0) {
    errors.push('Quantità deve essere maggiore di zero');
  }
  
  // Validazioni formato
  if (record.anno && (record.anno < 2020 || record.anno > 2030)) {
    errors.push('Anno deve essere tra 2020 e 2030');
  }
  
  if (record.costo_trasporto && record.costo_trasporto < 0) {
    errors.push('Costo trasporto non può essere negativo');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

// ===== DATABASE OPERATIONS =====

// Insert multipli nel database
async function bulkInsertShipments(records) {
  const success = [];
  const errors = [];
  
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    
    try {
      // Mappa i campi al formato database
      const dbRecord = {
        rif_spedizione: record.rif_spedizione,
        n_oda: record.n_oda || null,
        anno: record.anno || null,
        cod_art: record.cod_art,
        fornitore: record.fornitore || null,
        um: record.um || 'PZ',
        qty: record.qty,
        fattura_fornitore: record.fattura_fornitore || null,
        costo_trasporto: record.costo_trasporto || 0
      };
      
      const { data, error } = await supabase
        .from('shipments')
        .insert([dbRecord])
        .select();
      
      if (error) {
        if (error.code === '23505') { // Unique constraint violation
          errors.push({
            record,
            error: `RIF. SPEDIZIONE '${record.rif_spedizione}' già esistente`
          });
        } else {
          errors.push({
            record,
            error: error.message
          });
        }
      } else {
        success.push(data[0]);
      }
      
    } catch (error) {
      errors.push({
        record,
        error: error.message
      });
    }
  }
  
  return { success, errors };
}

// ===== UTILITY =====

function createResponse(statusCode, data) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(data, null, 2)
  };
}
