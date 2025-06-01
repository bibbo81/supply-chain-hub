// netlify/functions/test-db-structure.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    console.log('=== TEST DB STRUCTURE ===');
    
    // Test tutte le possibili variabili d'ambiente
    const envTests = {
      'SUPABASE_URL': process.env.SUPABASE_URL,
      'VITE_SUPABASE_URL': process.env.VITE_SUPABASE_URL,
      'SUPABASE_SERVICE_KEY': process.env.SUPABASE_SERVICE_KEY,
      'SUPABASE_SERVICE_ROLE_KEY': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'VITE_SUPABASE_ANON_KEY': process.env.VITE_SUPABASE_ANON_KEY
    };
    
    console.log('Environment variables found:');
    Object.entries(envTests).forEach(([key, value]) => {
      console.log(`${key}: ${value ? 'EXISTS' : 'NOT FOUND'}`);
    });
    
    // Trova URL e Key validi
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Missing Supabase configuration',
          envFound: Object.entries(envTests).reduce((acc, [k, v]) => {
            acc[k] = !!v;
            return acc;
          }, {})
        })
      };
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Test queries per verificare i nomi delle tabelle
    const tableTests = [];
    
    // Test tabelle italiano
    try {
      const { data, error } = await supabase.from('corrieri').select('*').limit(1);
      tableTests.push({ 
        table: 'corrieri', 
        exists: !error, 
        error: error?.message,
        sampleData: data?.[0] ? Object.keys(data[0]) : null
      });
    } catch (e) {
      tableTests.push({ table: 'corrieri', exists: false, error: e.message });
    }
    
    try {
      const { data, error } = await supabase.from('spedizioni').select('*').limit(1);
      tableTests.push({ 
        table: 'spedizioni', 
        exists: !error, 
        error: error?.message,
        sampleData: data?.[0] ? Object.keys(data[0]) : null
      });
    } catch (e) {
      tableTests.push({ table: 'spedizioni', exists: false, error: e.message });
    }
    
    // Test tabelle inglese
    try {
      const { data, error } = await supabase.from('carriers').select('*').limit(1);
      tableTests.push({ 
        table: 'carriers', 
        exists: !error, 
        error: error?.message,
        sampleData: data?.[0] ? Object.keys(data[0]) : null
      });
    } catch (e) {
      tableTests.push({ table: 'carriers', exists: false, error: e.message });
    }
    
    try {
      const { data, error } = await supabase.from('shipments').select('*').limit(1);
      tableTests.push({ 
        table: 'shipments', 
        exists: !error, 
        error: error?.message,
        sampleData: data?.[0] ? Object.keys(data[0]) : null
      });
    } catch (e) {
      tableTests.push({ table: 'shipments', exists: false, error: e.message });
    }
    
    // Test profiles table
    try {
      const { data, error } = await supabase.from('profiles').select('*').limit(1);
      tableTests.push({ 
        table: 'profiles', 
        exists: !error, 
        error: error?.message,
        sampleData: data?.[0] ? Object.keys(data[0]) : null
      });
    } catch (e) {
      tableTests.push({ table: 'profiles', exists: false, error: e.message });
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        environmentVariables: Object.entries(envTests).reduce((acc, [k, v]) => {
          acc[k] = !!v;
          return acc;
        }, {}),
        supabaseConfig: {
          urlFound: !!supabaseUrl,
          keyFound: !!supabaseKey
        },
        tableTests,
        timestamp: new Date().toISOString()
      }, null, 2)
    };
    
  } catch (error) {
    console.error('Test error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: error.message,
        stack: error.stack 
      })
    };
  }
};