"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insert = exports.getPanels = exports.getClients = exports.create = void 0;
const lw_1 = require("../../lw");
const webviewPanelMap = new Map();
const clientMap = new Map();
function toKey(pdfUri) {
    return pdfUri.toString(true).toLocaleUpperCase();
}
function create(pdfUri) {
    const key = toKey(pdfUri);
    if (!clientMap.has(key)) {
        clientMap.set(key, new Set());
    }
    if (!webviewPanelMap.has(key)) {
        webviewPanelMap.set(key, new Set());
    }
}
exports.create = create;
/**
 * Returns the set of client instances of a PDF file.
 * Returns `undefined` if the viewer have not recieved any request for the PDF file.
 *
 * @param pdfUri The path of a PDF file.
 */
function getClients(pdfUri) {
    if (pdfUri) {
        return clientMap.get(toKey(pdfUri));
    }
    else {
        const clients = new Set();
        clientMap.forEach(clientSet => clientSet.forEach(client => clients.add(client)));
        return clients;
    }
}
exports.getClients = getClients;
function getPanels(pdfUri) {
    return webviewPanelMap.get(toKey(pdfUri));
}
exports.getPanels = getPanels;
function insert(pdfPanel) {
    const pdfUri = pdfPanel.pdfUri;
    lw_1.lw.watcher.pdf.add(pdfUri.fsPath);
    create(pdfUri);
    const panelSet = getPanels(pdfUri);
    if (!panelSet) {
        return;
    }
    panelSet.add(pdfPanel);
    pdfPanel.webviewPanel.onDidDispose(() => {
        panelSet.delete(pdfPanel);
    });
    return pdfPanel;
}
exports.insert = insert;
//# sourceMappingURL=pdfviewermanager.js.map