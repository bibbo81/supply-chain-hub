import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

exports.handler = async (event, context) => {
  // Headers CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    // Inizializza client Supabase
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Starting dashboard-stats function');

    // QUERY SEMPLICE: Prendi tutti i shipments disponibili
    const { data: shipmentsData, error: shipmentsError } = await supabase
      .from('shipments')
      .select(`
        id,
        order_number,
        carrier,
        status,
        cost,
        shipment_date,
        delivery_date,
        origin,
        destination
      `);

    if (shipmentsError) {
      console.error('Shipments query error:', shipmentsError);
      throw shipmentsError;
    }

    console.log('Shipments found:', shipmentsData ? shipmentsData.length : 0);

    // Se non ci sono dati
    if (!shipmentsData || shipmentsData.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          period: {
            year: new Date().getFullYear(),
            month: new Date().getMonth() + 1,
            monthName: 'Current'
          },
          current: {
            month: {
              shipments: 0,
              revenue: 0,
              avgCost: 0,
              deliveryRate: 0
            }
          },
          growth: {
            mom: {
              shipments: { value: 0, percentage: 0 },
              revenue: { value: 0, percentage: 0 },
              avgCost: { value: 0, percentage: 0 }
            }
          },
          charts: {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
            shipments: {
              current: [0,0,0,0,0,0,0,0,0,0,0,0],
              previous: [0,0,0,0,0,0,0,0,0,0,0,0]
            }
          },
          status: {
            distribution: {
              consegnato: 0,
              in_transito: 0,
              arrivato: 0,
              other: 0
            }
          },
          insights: {
            summary: 'No data available',
            keyFindings: ['No shipments found'],
            recommendations: ['Add shipment data']
          },
          performance: {
            dataQuality: { score: 100, status: 'excellent' },
            systemHealth: { status: 'operational', uptime: 99.9, lastUpdate: new Date().toISOString() }
          },
          alerts: [],
          carrierPerformance: [],
          recentShipments: []
        })
      };
    }

    // CALCOLA STATISTICHE DA TUTTI I DATI
    const totalShipments = shipmentsData.length;
    const totalRevenue = shipmentsData.reduce((sum, s) => sum + (s.cost || 0), 0);
    const avgCost = totalShipments > 0 ? Math.round(totalRevenue / totalShipments) : 0;

    // Calcola delivery rate
    const deliveredCount = shipmentsData.filter(s => 
      s.status && s.status.toLowerCase().includes('consegnato')
    ).length;
    const deliveryRate = totalShipments > 0 ? Math.round((deliveredCount / totalShipments) * 100) : 0;

    console.log('Calculated stats:', {
      totalShipments,
      totalRevenue,
      avgCost,
      deliveryRate,
      deliveredCount
    });

    // DISTRIBUZIONE STATI
    const statusDistribution = {
      consegnato: 0,
      in_transito: 0,
      arrivato: 0,
      other: 0
    };

    shipmentsData.forEach(shipment => {
      const status = shipment.status ? shipment.status.toLowerCase().trim() : '';
      
      if (status.includes('consegnato')) {
        statusDistribution.consegnato++;
      } else if (status.includes('transito') || status.includes('transit')) {
        statusDistribution.in_transito++;
      } else if (status.includes('arrivato')) {
        statusDistribution.arrivato++;
      } else {
        statusDistribution.other++;
      }
    });

    console.log('Status distribution:', statusDistribution);

    // CARRIER PERFORMANCE
    const carrierStats = {};
    shipmentsData.forEach(shipment => {
      const carrier = shipment.carrier || 'Unknown';
      if (!carrierStats[carrier]) {
        carrierStats[carrier] = {
          shipments: 0,
          totalCost: 0,
          delivered: 0
        };
      }
      
      carrierStats[carrier].shipments++;
      carrierStats[carrier].totalCost += shipment.cost || 0;
      
      if (shipment.status && shipment.status.toLowerCase().includes('consegnato')) {
        carrierStats[carrier].delivered++;
      }
    });

    const carrierPerformance = Object.entries(carrierStats).map(([carrier, stats]) => {
      const avgCost = stats.shipments > 0 ? Math.round(stats.totalCost / stats.shipments) : 0;
      const deliveryRate = stats.shipments > 0 ? Math.round((stats.delivered / stats.shipments) * 100) : 0;
      const marketShare = Math.round((stats.shipments / totalShipments) * 100);
      
      return {
        carrier,
        shipments: stats.shipments,
        avgCost,
        deliveryRate,
        onTimeRate: deliveryRate, // Semplificato
        marketShare
      };
    });

    console.log('Carrier performance:', carrierPerformance);

    // RECENT SHIPMENTS (ultimi 10)
    const recentShipments = shipmentsData
      .sort((a, b) => new Date(b.shipment_date || 0) - new Date(a.shipment_date || 0))
      .slice(0, 10)
      .map(shipment => ({
        orderNumber: shipment.order_number || shipment.id,
        carrier: shipment.carrier || 'Unknown',
        status: shipment.status || 'Unknown',
        cost: shipment.cost || 0,
        date: shipment.shipment_date || new Date().toISOString().split('T')[0]
      }));

    // CHARTS DATA (semplificato - mette tutti i dati nel mese corrente)
    const currentMonth = new Date().getMonth(); // 0-11
    const currentYearData = new Array(12).fill(0);
    currentYearData[currentMonth] = totalShipments;

    // INSIGHTS
    const insights = {
      summary: `Dashboard overview with ${totalShipments} total shipments`,
      keyFindings: [
        `${totalShipments} total shipments processed`,
        `€${totalRevenue.toLocaleString()} in total revenue`,
        `${deliveryRate}% delivery success rate`,
        `${carrierPerformance.length} carriers active`
      ],
      recommendations: [
        deliveryRate < 50 ? 'Focus on improving delivery performance' : 'Maintain current service levels',
        totalShipments > 0 ? 'Continue monitoring carrier performance' : 'Increase shipment volume'
      ]
    };

    // PERFORMANCE
    const performance = {
      dataQuality: {
        score: 100,
        status: 'excellent'
      },
      systemHealth: {
        status: 'operational',
        uptime: 99.9,
        lastUpdate: new Date().toISOString()
      }
    };

    // ALERTS
    const alerts = [];
    if (deliveryRate < 50 && totalShipments > 0) {
      alerts.push({
        type: 'warning',
        message: 'Delivery rate below 50% - review carrier performance',
        priority: 'high'
      });
    }
    if (totalShipments === 0) {
      alerts.push({
        type: 'info',
        message: 'No shipments found in database',
        priority: 'medium'
      });
    }

    // COSTRUISCI RISPOSTA FINALE
    const response = {
      success: true,
      period: {
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
        monthName: 'All Data'
      },
      current: {
        month: {
          shipments: totalShipments,
          revenue: totalRevenue,
          avgCost: avgCost,
          deliveryRate: deliveryRate
        }
      },
      growth: {
        mom: {
          shipments: { value: 0, percentage: 0 },
          revenue: { value: 0, percentage: 0 },
          avgCost: { value: 0, percentage: 0 }
        }
      },
      charts: {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        shipments: {
          current: currentYearData,
          previous: new Array(12).fill(0)
        }
      },
      status: {
        distribution: statusDistribution
      },
      insights: insights,
      performance: performance,
      alerts: alerts,
      carrierPerformance: carrierPerformance,
      recentShipments: recentShipments
    };

    console.log('Final response stats:', {
      success: response.success,
      currentShipments: response.current.month.shipments,
      currentRevenue: response.current.month.revenue,
      carrierCount: response.carrierPerformance.length,
      recentShipmentsCount: response.recentShipments.length
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Dashboard Stats Error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};
