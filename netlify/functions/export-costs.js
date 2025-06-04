// netlify/functions/export-costs.js
const { createClient } = require('@supabase/supabase-js');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

exports.handler = async (event, context) => {
    // Enable CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    // Handle OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers,
            body: ''
        };
    }

    // Only allow POST
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        // Get auth token
        const token = event.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'Missing authorization token' })
            };
        }

        // Verify token and get user
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'Invalid token' })
            };
        }

        // Get organization_id from user metadata
        const organizationId = user.user_metadata?.organization_id;
        if (!organizationId) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'No organization associated with user' })
            };
        }

        // Parse request body
        const { format, filters = {}, data } = JSON.parse(event.body);

        if (!format || !['pdf', 'excel', 'csv'].includes(format)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Invalid export format' })
            };
        }

        // If data is provided, use it. Otherwise fetch from database
        let exportData = data;
        
        if (!exportData) {
            // Calculate date range from filters
            const endDate = new Date();
            const startDate = new Date();
            const days = parseInt(filters.period || '30');
            startDate.setDate(startDate.getDate() - days);

            // Build query
            let query = supabase
                .from('shipments')
                .select(`
                    n_oda,
                    cod_art,
                    data_partenza,
                    fornitore,
                    spedizioniere,
                    tipo_spedizione,
                    quantita,
                    costo_trasporto,
                    costo_unitario_trasporto,
                    stato_spedizione
                `)
                .eq('organizzazione_id', organizationId)
                .gte('data_partenza', startDate.toISOString())
                .lte('data_partenza', endDate.toISOString())
                .not('costo_trasporto', 'is', null)
                .order('data_partenza', { ascending: false });

            // Apply filters
            if (filters.tipo_spedizione) {
                query = query.eq('tipo_spedizione', filters.tipo_spedizione);
            }
            if (filters.spedizioniere) {
                query = query.eq('spedizioniere', filters.spedizioniere);
            }
            if (filters.fornitore) {
                query = query.eq('fornitore', filters.fornitore);
            }

            const { data: shipments, error: queryError } = await query;

            if (queryError) {
                throw queryError;
            }

            exportData = {
                shipments: shipments || [],
                filters,
                period: {
                    start: startDate.toISOString(),
                    end: endDate.toISOString()
                }
            };
        }

        // Generate export based on format
        let result;
        let contentType;
        let fileName;

        switch (format) {
            case 'pdf':
                result = await generatePDF(exportData, user);
                contentType = 'application/pdf';
                fileName = `analisi-costi-${new Date().toISOString().split('T')[0]}.pdf`;
                break;
            case 'excel':
                result = await generateExcel(exportData, user);
                contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
                fileName = `analisi-costi-${new Date().toISOString().split('T')[0]}.xlsx`;
                break;
            case 'csv':
                result = generateCSV(exportData);
                contentType = 'text/csv';
                fileName = `analisi-costi-${new Date().toISOString().split('T')[0]}.csv`;
                break;
            default:
                throw new Error('Unsupported format');
        }

        // Return file
        return {
            statusCode: 200,
            headers: {
                ...headers,
                'Content-Type': contentType,
                'Content-Disposition': `attachment; filename="${fileName}"`,
                'Content-Length': result.length
            },
            body: result.toString('base64'),
            isBase64Encoded: true
        };

    } catch (error) {
        console.error('Error in export-costs function:', error);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Export failed', 
                details: error.message 
            })
        };
    }
};

// Generate PDF report
async function generatePDF(data, user) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument();
            const chunks = [];
            
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            
            // Header
            doc.fontSize(20).text('Supply Chain Hub', 50, 50);
            doc.fontSize(16).text('Analisi Costi Trasporto', 50, 80);
            
            // Meta info
            doc.fontSize(10);
            doc.text(`Generato da: ${user.email}`, 50, 120);
            doc.text(`Data: ${new Date().toLocaleDateString('it-IT')}`, 50, 135);
            if (data.period) {
                const start = new Date(data.period.start).toLocaleDateString('it-IT');
                const end = new Date(data.period.end).toLocaleDateString('it-IT');
                doc.text(`Periodo: ${start} - ${end}`, 50, 150);
            }
            
            // Summary
            const totalCost = data.shipments.reduce((sum, s) => sum + (s.costo_trasporto || 0), 0);
            const avgCost = data.shipments.length > 0 ? totalCost / data.shipments.length : 0;
            
            doc.fontSize(14).text('Riepilogo', 50, 180);
            doc.fontSize(10);
            doc.text(`Numero spedizioni: ${data.shipments.length}`, 70, 200);
            doc.text(`Costo totale: €${totalCost.toFixed(2)}`, 70, 215);
            doc.text(`Costo medio: €${avgCost.toFixed(2)}`, 70, 230);
            
            // Top costs table
            doc.fontSize(14).text('Top 10 Costi Maggiori', 50, 260);
            
            // Table headers
            let yPos = 280;
            doc.fontSize(9);
            doc.text('N. ODA', 50, yPos);
            doc.text('Data', 150, yPos);
            doc.text('Fornitore', 220, yPos);
            doc.text('Spedizioniere', 320, yPos);
            doc.text('Costo', 420, yPos);
            
            // Table data
            yPos += 20;
            const topCosts = [...data.shipments]
                .sort((a, b) => b.costo_trasporto - a.costo_trasporto)
                .slice(0, 10);
            
            topCosts.forEach((shipment, index) => {
                if (yPos > 700) {
                    doc.addPage();
                    yPos = 50;
                }
                
                doc.text(shipment.n_oda, 50, yPos);
                doc.text(new Date(shipment.data_partenza).toLocaleDateString('it-IT'), 150, yPos);
                doc.text(shipment.fornitore.substring(0, 20), 220, yPos);
                doc.text(shipment.spedizioniere, 320, yPos);
                doc.text(`€${shipment.costo_trasporto.toFixed(2)}`, 420, yPos);
                
                yPos += 15;
            });
            
            // Footer
            const pageCount = doc.bufferedPageRange().count;
            for (let i = 0; i < pageCount; i++) {
                doc.switchToPage(i);
                doc.fontSize(8);
                doc.text(
                    `Pagina ${i + 1} di ${pageCount}`,
                    50,
                    doc.page.height - 50,
                    { align: 'center', width: doc.page.width - 100 }
                );
            }
            
            doc.end();
            
        } catch (error) {
            reject(error);
        }
    });
}

// Generate Excel report
async function generateExcel(data, user) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = user.email;
    workbook.created = new Date();
    
    // Summary sheet
    const summarySheet = workbook.addWorksheet('Riepilogo');
    
    // Title
    summarySheet.mergeCells('A1:E1');
    summarySheet.getCell('A1').value = 'Supply Chain Hub - Analisi Costi';
    summarySheet.getCell('A1').font = { size: 16, bold: true };
    
    // Meta info
    summarySheet.getCell('A3').value = 'Generato da:';
    summarySheet.getCell('B3').value = user.email;
    summarySheet.getCell('A4').value = 'Data:';
    summarySheet.getCell('B4').value = new Date().toLocaleDateString('it-IT');
    
    // Calculate summary
    const totalCost = data.shipments.reduce((sum, s) => sum + (s.costo_trasporto || 0), 0);
    const avgCost = data.shipments.length > 0 ? totalCost / data.shipments.length : 0;
    
    // KPIs
    summarySheet.getCell('A6').value = 'KPI';
    summarySheet.getCell('B6').value = 'Valore';
    summarySheet.getCell('A6').font = { bold: true };
    summarySheet.getCell('B6').font = { bold: true };
    
    summarySheet.getCell('A7').value = 'Numero Spedizioni';
    summarySheet.getCell('B7').value = data.shipments.length;
    summarySheet.getCell('A8').value = 'Costo Totale';
    summarySheet.getCell('B8').value = totalCost;
    summarySheet.getCell('B8').numFmt = '€#,##0.00';
    summarySheet.getCell('A9').value = 'Costo Medio';
    summarySheet.getCell('B9').value = avgCost;
    summarySheet.getCell('B9').numFmt = '€#,##0.00';
    
    // Details sheet
    const detailsSheet = workbook.addWorksheet('Dettagli');
    
    // Headers
    detailsSheet.columns = [
        { header: 'N. ODA', key: 'n_oda', width: 15 },
        { header: 'Cod. Art.', key: 'cod_art', width: 12 },
        { header: 'Data', key: 'data_partenza', width: 12 },
        { header: 'Fornitore', key: 'fornitore', width: 25 },
        { header: 'Spedizioniere', key: 'spedizioniere', width: 20 },
        { header: 'Tipo', key: 'tipo_spedizione', width: 10 },
        { header: 'Quantità', key: 'quantita', width: 10 },
        { header: 'Costo Trasporto', key: 'costo_trasporto', width: 15 },
        { header: 'Costo/Unità', key: 'costo_unitario_trasporto', width: 12 }
    ];
    
    // Style headers
    detailsSheet.getRow(1).font = { bold: true };
    detailsSheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF007AFF' }
    };
    
    // Add data
    data.shipments.forEach(shipment => {
        detailsSheet.addRow({
            ...shipment,
            data_partenza: new Date(shipment.data_partenza).toLocaleDateString('it-IT')
        });
    });
    
    // Format currency columns
    detailsSheet.getColumn('costo_trasporto').numFmt = '€#,##0.00';
    detailsSheet.getColumn('costo_unitario_trasporto').numFmt = '€#,##0.00';
    
    // By Carrier sheet
    const carrierSheet = workbook.addWorksheet('Per Spedizioniere');
    
    // Aggregate by carrier
    const carrierData = {};
    data.shipments.forEach(s => {
        if (!carrierData[s.spedizioniere]) {
            carrierData[s.spedizioniere] = { count: 0, cost: 0 };
        }
        carrierData[s.spedizioniere].count++;
        carrierData[s.spedizioniere].cost += s.costo_trasporto;
    });
    
    carrierSheet.columns = [
        { header: 'Spedizioniere', key: 'carrier', width: 20 },
        { header: 'Numero Spedizioni', key: 'count', width: 18 },
        { header: 'Costo Totale', key: 'cost', width: 15 }
    ];
    
    carrierSheet.getRow(1).font = { bold: true };
    carrierSheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF007AFF' }
    };
    
    Object.entries(carrierData).forEach(([carrier, data]) => {
        carrierSheet.addRow({
            carrier,
            count: data.count,
            cost: data.cost
        });
    });
    
    carrierSheet.getColumn('cost').numFmt = '€#,##0.00';
    
    // Generate buffer
    return workbook.xlsx.writeBuffer();
}

// Generate CSV
function generateCSV(data) {
    const headers = [
        'N. ODA',
        'Cod. Art.',
        'Data',
        'Fornitore',
        'Spedizioniere',
        'Tipo',
        'Quantità',
        'Costo Trasporto',
        'Costo/Unità'
    ];
    
    const rows = data.shipments.map(s => [
        s.n_oda,
        s.cod_art,
        new Date(s.data_partenza).toLocaleDateString('it-IT'),
        s.fornitore,
        s.spedizioniere,
        s.tipo_spedizione,
        s.quantita,
        s.costo_trasporto,
        s.costo_unitario_trasporto
    ]);
    
    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    return Buffer.from(csvContent, 'utf-8');
}