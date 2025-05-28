// ===== NETLIFY FUNCTION: DASHBOARD STATS API =====
// Fornisce statistiche e KPI per il dashboard
// Endpoint: /.netlify/functions/dashboard-stats

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
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
  console.log('📊 Dashboard Stats API called:', event.httpMethod);

  // Gestisci preflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  if (event.httpMethod !== 'GET') {
    return createResponse(405, { error: 'Method not allowed' });
  }

  try {
    const { type, period, year, month } = event.queryStringParameters || {};

    switch (type) {
      case 'overview':
        return await getOverviewStats();
      case 'monthly':
        return await getMonthlyStats(year, month);
      case 'performance':
        return await getPerformanceStats(period);
      case 'costs':
        return await getCostStats(period);
      default:
        return await getAllStats();
    }

  } catch (error) {
    console.error('❌ Error in dashboard-stats function:', error);
    return createResponse(500, { 
      error: 'Internal server error',
      message: error.message 
    });
  }
};

// ===== OVERVIEW STATS =====
async function getOverviewStats() {
  try {
    console.log('📈 Getting overview stats...');

    // Query principale per statistiche generali
    const { data: overviewData, error: overviewError } = await supabase
      .rpc('get_dashboard_stats');

    if (overviewError) throw overviewError;

    // Statistiche per tipo spedizione
    const { data: typeStats, error: typeError } = await supabase
      .from('shipments')
      .select('tipo_spedizione')
      .not('tipo_spedizione', 'is', null);

    if (typeError) throw typeError;

    // Conta per tipo
    const typeCount = typeStats.reduce((acc, item) => {
      const type = item.tipo_spedizione || 'NON_SPECIFICATO';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});

    // Statistiche recenti (ultimi 30 giorni)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: recentStats, error: recentError } = await supabase
      .from('shipments')
      .select('*')
      .gte('created_at', thirtyDaysAgo.toISOString());

    if (recentError) throw recentError;

    const overview = overviewData[0] || {};
    
    const result = {
      totalShipments: overview.total_shipments || 0,
      inTransit: overview.in_transit || 0,
      delivered: overview.delivered || 0,
      delayed: overview.delayed || 0,
      avgTransitTime: overview.avg_transit_time || 0,
      totalCost: overview.total_cost || 0,
      avgCost: overview.avg_cost || 0,
      
      // Statistiche per tipo
      byType: typeCount,
      
      // Trend ultimi 30 giorni
      recentActivity: {
        newShipments: recentStats.length,
        recentDelivered: recentStats.filter(s => 
          s.stato_spedizione && s.stato_spedizione.toLowerCase().includes('consegnato')
        ).length
      },
      
      // Performance KPIs
      onTimeDeliveryRate: overview.total_shipments > 0 ? 
        ((overview.delivered - overview.delayed) / overview.total_shipments * 100).toFixed(1) : 0,
      
      delayRate: overview.total_shipments > 0 ? 
        (overview.delayed / overview.total_shipments * 100).toFixed(1) : 0
    };

    console.log('✅ Overview stats calculated');
    return createResponse(200, result);

  } catch (error) {
    console.error('❌ Error getting overview stats:', error);
    throw error;
  }
}

// ===== MONTHLY STATS =====
async function getMonthlyStats(year, month) {
  try {
    console.log(`📅 Getting monthly stats for ${year}/${month}...`);

    const currentYear = year || new Date().getFullYear();
    const currentMonth = month || new Date().getMonth() + 1;

    // Usa la vista monthly_kpis se disponibile, altrimenti calcola manualmente
    const { data, error } = await supabase
      .from('shipments')
      .select('*')
      .gte('created_at', `${currentYear}-${currentMonth.toString().padStart(2, '0')}-01`)
      .lt('created_at', `${currentYear}-${(currentMonth + 1).toString().padStart(2, '0')}-01`);

    if (error) throw error;

    // Calcola statistiche mensili
    const monthlyStats = {
      month: currentMonth,
      year: currentYear,
      totalShipments: data.length,
      totalCost: data.reduce((sum, s) => sum + (s.costo_trasporto || 0), 0),
      avgCost: data.length > 0 ? data.reduce((sum, s) => sum + (s.costo_trasporto || 0), 0) / data.length : 0,
      
      byType: data.reduce((acc, s) => {
        const type = s.tipo_spedizione || 'NON_SPECIFICATO';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {}),
      
      delayedShipments: data.filter(s => s.ritardo_giorni > 0).length,
      avgTransitTime: data.length > 0 ? 
        data.reduce((sum, s) => sum + (s.transit_time_giorni || 0), 0) / data.length : 0
    };

    console.log('✅ Monthly stats calculated');
    return createResponse(200, monthlyStats);

  } catch (error) {
    console.error('❌ Error getting monthly stats:', error);
    throw error;
  }
}

// ===== PERFORMANCE STATS =====
async function getPerformanceStats(period = '30d') {
  try {
    console.log(`⚡ Getting performance stats for ${period}...`);

    // Calcola data di inizio basata sul periodo
    const startDate = new Date();
    switch (period) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }

    const { data, error } = await supabase
      .from('shipments')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .not('transit_time_giorni', 'is', null);

    if (error) throw error;

    // Calcola metriche di performance
    const performanceStats = {
      period,
      totalShipments: data.length,
      
      // Tempi di transito
      avgTransitTime: data.length > 0 ? 
        (data.reduce((sum, s) => sum + s.transit_time_giorni, 0) / data.length).toFixed(1) : 0,
      
      minTransitTime: data.length > 0 ? Math.min(...data.map(s => s.transit_time_giorni)) : 0,
      maxTransitTime: data.length > 0 ? Math.max(...data.map(s => s.transit_time_giorni)) : 0,
      
      // Performance per tipo spedizione
      performanceByType: {},
      
      // Distribuzione tempi di transito
      transitTimeDistribution: {
        fast: data.filter(s => s.transit_time_giorni <= 7).length,    // <= 7 giorni
        normal: data.filter(s => s.transit_time_giorni > 7 && s.transit_time_giorni <= 21).length, // 8-21 giorni
        slow: data.filter(s => s.transit_time_giorni > 21 && s.transit_time_giorni <= 45).length,  // 22-45 giorni
        verySlow: data.filter(s => s.transit_time_giorni > 45).length  // > 45 giorni
      },
      
      // Ritardi
      delayedShipments: data.filter(s => s.ritardo_giorni > 0).length,
      avgDelayDays: data.length > 0 ?
        (data.reduce((sum, s) => sum + (s.ritardo_giorni || 0), 0) / data.length).toFixed(1) : 0
    };

    // Calcola performance per tipo spedizione
    const typeGroups = data.reduce((acc, s) => {
      const type = s.tipo_spedizione || 'NON_SPECIFICATO';
      if (!acc[type]) acc[type] = [];
      acc[type].push(s);
      return acc;
    }, {});

    for (const [type, shipments] of Object.entries(typeGroups)) {
      performanceStats.performanceByType[type] = {
        count: shipments.length,
        avgTransitTime: (shipments.reduce((sum, s) => sum + s.transit_time_giorni, 0) / shipments.length).toFixed(1),
        delayedCount: shipments.filter(s => s.ritardo_giorni > 0).length,
        delayRate: ((shipments.filter(s => s.ritardo_giorni > 0).length / shipments.length) * 100).toFixed(1)
      };
    }

    console.log('✅ Performance stats calculated');
    return createResponse(200, performanceStats);

  } catch (error) {
    console.error('❌ Error getting performance stats:', error);
    throw error;
  }
}

// ===== COST STATS =====
async function getCostStats(period = '30d') {
  try {
    console.log(`💰 Getting cost stats for ${period}...`);

    // Calcola data di inizio
    const startDate = new Date();
    switch (period) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }

    const { data, error } = await supabase
      .from('shipments')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .not('costo_trasporto', 'is', null);

    if (error) throw error;

    // Calcola statistiche costi
    const costs = data.map(s => s.costo_trasporto).filter(c => c > 0);
    const totalCost = costs.reduce((sum, c) => sum + c, 0);

    const costStats = {
      period,
      totalCost: totalCost.toFixed(2),
      avgCost: costs.length > 0 ? (totalCost / costs.length).toFixed(2) : 0,
      minCost: costs.length > 0 ? Math.min(...costs).toFixed(2) : 0,
      maxCost: costs.length > 0 ? Math.max(...costs).toFixed(2) : 0,
      
      // Costi per tipo spedizione
      costsByType: {},
      
      // Distribuzione costi
      costDistribution: {
        low: costs.filter(c => c <= 500).length,      // <= 500€
        medium: costs.filter(c => c > 500 && c <= 1500).length, // 501-1500€
        high: costs.filter(c => c > 1500 && c <= 3000).length,  // 1501-3000€
        veryHigh: costs.filter(c => c > 3000).length    // > 3000€
      }
    };

    // Calcola costi per tipo spedizione
    const typeGroups = data.reduce((acc, s) => {
      const type = s.tipo_spedizione || 'NON_SPECIFICATO';
      if (!acc[type]) acc[type] = [];
      acc[type].push(s);
      return acc;
    }, {});

    for (const [type, shipments] of Object.entries(typeGroups)) {
      const typeCosts = shipments.map(s => s.costo_trasporto).filter(c => c > 0);
      const typeTotal = typeCosts.reduce((sum, c) => sum + c, 0);
      
      costStats.costsByType[type] = {
        count: shipments.length,
        totalCost: typeTotal.toFixed(2),
        avgCost: typeCosts.length > 0 ? (typeTotal / typeCosts.length).toFixed(2) : 0,
        percentageOfTotal: totalCost > 0 ? ((typeTotal / totalCost) * 100).toFixed(1) : 0
      };
    }

    console.log('✅ Cost stats calculated');
    return createResponse(200, costStats);

  } catch (error) {
    console.error('❌ Error getting cost stats:', error);
    throw error;
  }
}

// ===== ALL STATS (DASHBOARD COMPLETO) =====
async function getAllStats() {
  try {
    console.log('🔄 Getting all dashboard stats...');

    // Chiama tutte le funzioni in parallelo per performance
    const [overview, monthly, performance, costs] = await Promise.all([
      getOverviewStats().then(r => JSON.parse(r.body)),
      getMonthlyStats().then(r => JSON.parse(r.body)),
      getPerformanceStats().then(r => JSON.parse(r.body)),
      getCostStats().then(r => JSON.parse(r.body))
    ]);

    const allStats = {
      overview,
      monthly,
      performance,
      costs,
      timestamp: new Date().toISOString(),
      refreshedAt: new Date().toLocaleString('it-IT')
    };

    console.log('✅ All stats retrieved');
    return createResponse(200, allStats);

  } catch (error) {
    console.error('❌ Error getting all stats:', error);
    throw error;
  }
}

// ===== UTILITY =====
function createResponse(statusCode, data) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(data, null, 2)
  };
}
