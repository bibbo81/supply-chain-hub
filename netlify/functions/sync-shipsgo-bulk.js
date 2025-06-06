exports.handler = async (event, context) => {
    const { mode, trackingList } = JSON.parse(event.body);
    
    if (mode === 'auto') {
        // Per AWB - usa ShipsGo V2 List endpoint
        const awbList = await fetchShipsGoAWBList();
        // Import tutti
    }
    
    if (mode === 'batch') {
        // Per Container - processa lista fornita
        for (const containerBatch of chunks(trackingList, 50)) {
            await processContainerBatch(containerBatch);
        }
    }
    
    return {
        statusCode: 200,
        body: JSON.stringify({
            imported: results.length,
            message: "Sync completato!"
        })
    };
};