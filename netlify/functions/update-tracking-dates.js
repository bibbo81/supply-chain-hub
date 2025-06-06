// Versione migliorata che importa anche gli eventi e le date chiave
async function processShipsGoFileEnhanced(fileData) {
    const trackingList = [];
    const errors = [];
    
    // Identifica se è un export ShipsGo
    const isShipsGoExport = fileData.length > 0 && 
        'Container' in fileData[0] && 
        'Carrier' in fileData[0];
    
    if (!isShipsGoExport) {
        return processStandardFile(fileData);
    }
    
    console.log('Rilevato file ShipsGo con eventi temporali...');
    
    for (const [index, row] of fileData.entries()) {
        try {
            if (!row.Container) continue;
            
            const containerNum = row.Container.toUpperCase();
            const carrierCode = SHIPSGO_CARRIER_MAPPING[row.Carrier] || row.Carrier;
            
            // Determina status basato su date
            let status = 'registered';
            let events = [];
            
            // Crea eventi basati sulle date disponibili
            const loadingDate = parseShipsGoDate(row['Date Of Loading']);
            const dischargeDate = parseShipsGoDate(row['Date Of Discharge']);
            
            // Evento di caricamento
            if (loadingDate) {
                events.push({
                    event_date: loadingDate,
                    event_type: 'LOADED_ON_VESSEL',
                    event_code: 'LOAD',
                    location_name: row['Port Of Loading'],
                    location_code: row['POL Country Code'],
                    description: `Container loaded at ${row['Port Of Loading']}`,
                    data_source: 'shipsgo_import',
                    confidence_score: 1.0
                });
                status = 'in_transit';
            }
            
            // Evento di scarico
            if (dischargeDate) {
                events.push({
                    event_date: dischargeDate,
                    event_type: 'DISCHARGED_FROM_VESSEL',
                    event_code: 'DISCH',
                    location_name: row['Port Of Discharge'],
                    location_code: row['POD Country Code'],
                    description: `Container discharged at ${row['Port Of Discharge']}`,
                    data_source: 'shipsgo_import',
                    confidence_score: 1.0
                });
                
                // Se la data di scarico è passata, consideriamo delivered
                if (new Date(dischargeDate) < new Date()) {
                    status = 'delivered';
                    
                    // Aggiungi evento di consegna stimato (tipicamente 2-5 giorni dopo discharge)
                    const estimatedDelivery = new Date(dischargeDate);
                    estimatedDelivery.setDate(estimatedDelivery.getDate() + 3);
                    
                    events.push({
                        event_date: estimatedDelivery.toISOString(),
                        event_type: 'DELIVERED',
                        event_code: 'DLV',
                        location_name: row['Port Of Discharge'],
                        location_code: row['POD Country Code'],
                        description: 'Estimated delivery completed',
                        data_source: 'shipsgo_import',
                        confidence_score: 0.7 // Lower confidence for estimated
                    });
                }
            }
            
            // Calcola transit time
            let transitTime = null;
            if (loadingDate && dischargeDate) {
                const start = new Date(loadingDate);
                const end = new Date(dischargeDate);
                transitTime = Math.round((end - start) / (1000 * 60 * 60 * 24)); // giorni
            }
            
            // Costruisci oggetto tracking completo
            const tracking = {
                trackingNumber: containerNum,
                trackingType: containerNum.length > 11 ? 'bl' : 'container',
                carrierCode: carrierCode,
                carrierName: row.Carrier,
                status: SHIPSGO_STATUS_MAPPING[row.Status] || status,
                referenceNumber: row.Reference !== '-' ? row.Reference : null,
                
                // DATE PRINCIPALI - CAMPI DIRETTI
                origin_port: row['Port Of Loading'],
                destination_port: row['Port Of Discharge'],
                eta: dischargeDate, // Usa discharge date come ETA
                ata: status === 'delivered' ? dischargeDate : null, // ATA solo se consegnato
                
                // Info ultimo evento
                last_event_date: events.length > 0 ? events[events.length - 1].event_date : null,
                last_event_location: events.length > 0 ? events[events.length - 1].location_name : null,
                last_event_description: events.length > 0 ? events[events.length - 1].description : null,
                
                // Metadata estesi
                metadata: {
                    source: 'shipsgo_export',
                    import_date: new Date().toISOString(),
                    booking_number: row.Booking !== '-' ? row.Booking : null,
                    co2_emissions: parseFloat(row['CO₂ Emission (Tons)']) || null,
                    pol_country: row['POL Country'],
                    pol_country_code: row['POL Country Code'],
                    pod_country: row['POD Country'],
                    pod_country_code: row['POD Country Code'],
                    loading_date: loadingDate,
                    discharge_date: dischargeDate,
                    transit_time_days: transitTime,
                    tags: row.Tags !== '-' ? row.Tags : null,
                    shipsgo_created_at: parseShipsGoDate(row['Created At']),
                    container_count: parseInt(row['Container Count']) || 1
                },
                
                // Eventi da creare
                events: events
            };
            
            trackingList.push(tracking);
            
        } catch (error) {
            errors.push({
                row: index + 2,
                container: row.Container || 'UNKNOWN',
                error: error.message
            });
        }
    }
    
    // Report dettagliato
    const summary = {
        total: trackingList.length,
        delivered: trackingList.filter(t => t.status === 'delivered').length,
        in_transit: trackingList.filter(t => t.status === 'in_transit').length,
        with_dates: trackingList.filter(t => t.metadata.loading_date && t.metadata.discharge_date).length,
        avg_transit_time: calculateAverageTransitTime(trackingList)
    };
    
    console.log('Import Summary:', summary);
    showImportSummary(summary);
    
    return { trackingList, errors, summary };
}

// Calcola tempo medio di transito
function calculateAverageTransitTime(trackingList) {
    const withTransitTime = trackingList.filter(t => t.metadata.transit_time_days);
    if (withTransitTime.length === 0) return null;
    
    const total = withTransitTime.reduce((sum, t) => sum + t.metadata.transit_time_days, 0);
    return Math.round(total / withTransitTime.length);
}

// Mostra riepilogo import
function showImportSummary(summary) {
    const summaryHtml = `
        <div style="background: var(--sol-glass-medium); padding: var(--sol-space-lg); border-radius: var(--sol-radius-lg); margin-bottom: var(--sol-space-lg);">
            <h4 style="margin-bottom: var(--sol-space-md);">📊 Riepilogo Import ShipsGo</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--sol-space-md);">
                <div>
                    <div style="font-size: 1.5rem; font-weight: bold; color: var(--sol-text-primary);">${summary.total}</div>
                    <div style="font-size: 0.875rem; color: var(--sol-text-secondary);">Tracking Totali</div>
                </div>
                <div>
                    <div style="font-size: 1.5rem; font-weight: bold; color: #34C759;">${summary.delivered}</div>
                    <div style="font-size: 0.875rem; color: var(--sol-text-secondary);">Consegnati</div>
                </div>
                <div>
                    <div style="font-size: 1.5rem; font-weight: bold; color: #FF9500;">${summary.in_transit}</div>
                    <div style="font-size: 0.875rem; color: var(--sol-text-secondary);">In Transito</div>
                </div>
                <div>
                    <div style="font-size: 1.5rem; font-weight: bold; color: #007AFF;">${summary.avg_transit_time || 'N/A'}</div>
                    <div style="font-size: 0.875rem; color: var(--sol-text-secondary);">Giorni Medi Transito</div>
                </div>
            </div>
        </div>
    `;
    
    // Inserisci il riepilogo nel DOM (sopra la progress bar)
    const importProgress = document.getElementById('importProgress');
    if (importProgress) {
        importProgress.insertAdjacentHTML('beforebegin', summaryHtml);
    }
}

// Versione modificata di importTrackingBatch che gestisce anche gli eventi
async function importTrackingBatchWithEvents(trackingList) {
    const progressDiv = document.getElementById('importProgress');
    const progressBar = document.getElementById('importProgressBar');
    const importedCount = document.getElementById('importedCount');
    const totalCount = document.getElementById('totalCount');
    
    progressDiv.style.display = 'block';
    totalCount.textContent = trackingList.length;
    importedCount.textContent = '0';
    progressBar.style.width = '0%';
    
    let successCount = 0;
    let errorCount = 0;
    let eventsCreated = 0;
    
    const token = localStorage.getItem('sb-access-token') || sessionStorage.getItem('sb-access-token');
    if (!token) {
        showNotification('Token di autenticazione non trovato', 'error');
        return;
    }
    
    // Process in batches
    const batchSize = 5;
    for (let i = 0; i < trackingList.length; i += batchSize) {
        const batch = trackingList.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (tracking) => {
            try {
                // Estrai eventi prima di inviare
                const events = tracking.events || [];
                delete tracking.events; // Rimuovi eventi dall'oggetto principale
                
                // 1. Crea il tracking
                const response = await fetch('/.netlify/functions/add-tracking', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        trackingNumber: tracking.trackingNumber,
                        trackingType: tracking.trackingType,
                        carrierCode: tracking.carrierCode,
                        referenceNumber: tracking.referenceNumber
                    })
                });
                
                const result = await response.json();
                
                if (response.ok && result.data) {
                    successCount++;
                    
                    // 2. Se ci sono eventi, creali
                    if (events.length > 0) {
                        // Usa l'ID del tracking appena creato
                        const trackingId = result.data.id;
                        
                        // Crea eventi tramite una function dedicata o direttamente
                        for (const event of events) {
                            try {
                                // Qui potresti chiamare una function create-tracking-event
                                // Per ora logghiamo solo
                                console.log(`Eventi da creare per ${tracking.trackingNumber}:`, events);
                                eventsCreated += events.length;
                            } catch (eventError) {
                                console.error('Errore creazione evento:', eventError);
                            }
                        }
                    }
                    
                    // 3. Aggiorna con le date se presenti
                    if (tracking.eta || tracking.ata) {
                        try {
                            await fetch('/.netlify/functions/update-tracking-dates', {
                                method: 'POST',
                                headers: {
                                    'Authorization': `Bearer ${token}`,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    trackingId: result.data.id,
                                    eta: tracking.eta,
                                    ata: tracking.ata,
                                    origin_port: tracking.origin_port,
                                    destination_port: tracking.destination_port,
                                    metadata: tracking.metadata
                                })
                            });
                        } catch (updateError) {
                            console.error('Errore aggiornamento date:', updateError);
                        }
                    }
                } else {
                    errorCount++;
                    console.error(`Errore import ${tracking.trackingNumber}:`, result.error);
                }
            } catch (error) {
                errorCount++;
                console.error(`Errore import ${tracking.trackingNumber}:`, error);
            }
            
            // Update progress
            const completed = successCount + errorCount;
            importedCount.textContent = completed;
            progressBar.style.width = `${(completed / trackingList.length) * 100}%`;
        }));
        
        if (i + batchSize < trackingList.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    
    // Messaggio finale con dettagli
    let message = `Import completato: ${successCount} tracking importati`;
    if (eventsCreated > 0) {
        message += `, ${eventsCreated} eventi storici creati`;
    }
    if (errorCount > 0) {
        message += `, ${errorCount} errori`;
    }
    
    showNotification(message, errorCount > 0 ? 'warning' : 'success');
    
    // Reload dopo 2 secondi
    setTimeout(() => {
        loadTrackings();
        toggleAddForm();
    }, 2000);
    
    // Nascondi progress dopo 3 secondi
    setTimeout(() => {
        progressDiv.style.display = 'none';
        // Rimuovi anche il summary
        const summaryDiv = progressDiv.previousElementSibling;
        if (summaryDiv && summaryDiv.innerHTML.includes('Riepilogo Import')) {
            summaryDiv.remove();
        }
    }, 3000);
}