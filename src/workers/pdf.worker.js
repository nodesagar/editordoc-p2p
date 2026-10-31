import { compressPDF, mergePDFs } from '../utils/pdfProcessor';
self.onmessage = async (e) => {
    const { action, id, payload } = e.data;
    try {
        let result;
        switch (action) {
            case 'COMPRESS':
                result = await compressPDF(payload.buffer, payload.quality);
                self.postMessage({ id, status: 'success', result });
                break;
            case 'MERGE':
                result = await mergePDFs(payload.buffers);
                self.postMessage({ id, status: 'success', result });
                break;
            default:
                throw new Error(`Unknown action: ${action}`);
        }
    }
    catch (error) {
        self.postMessage({ id, status: 'error', error: error?.message || 'Worker error' });
    }
};
