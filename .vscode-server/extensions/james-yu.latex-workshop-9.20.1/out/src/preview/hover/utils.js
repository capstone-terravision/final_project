"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.svg2DataUrl = exports.addDummyCodeBlock = exports.stripTeX = exports.mathjaxify = exports.getColor = void 0;
const vscode = __importStar(require("vscode"));
const utils_1 = require("../../utils/utils");
function getColor() {
    return vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ? '#000000' : '#ffffff';
}
exports.getColor = getColor;
function mathjaxify(tex, envname, opt = { stripLabel: true }) {
    // remove TeX comments
    let s = (0, utils_1.stripComments)(tex);
    // remove \label{...}
    if (opt.stripLabel) {
        s = s.replace(/\\label\{.*?\}/g, '');
    }
    if (envname.match(/^(aligned|alignedat|array|Bmatrix|bmatrix|cases|CD|gathered|matrix|pmatrix|smallmatrix|split|subarray|Vmatrix|vmatrix)$/)) {
        s = '\\begin{equation}' + s + '\\end{equation}';
    }
    return s;
}
exports.mathjaxify = mathjaxify;
function stripTeX(tex, macros) {
    // First remove math env declaration
    if (tex.startsWith('$$') && tex.endsWith('$$')) {
        tex = tex.slice(2, tex.length - 2);
    }
    else if (tex.startsWith('$') && tex.endsWith('$')) {
        tex = tex.slice(1, tex.length - 1);
    }
    else if (tex.startsWith('\\(') && tex.endsWith('\\)')) {
        tex = tex.slice(2, tex.length - 2);
    }
    else if (tex.startsWith('\\[') && tex.endsWith('\\]')) {
        tex = tex.slice(2, tex.length - 2);
    }
    // Then remove the star variant of new macros
    [...macros.matchAll(/\\newcommand\{(.*?)\}/g)].forEach(match => {
        tex = tex.replaceAll(match[1] + '*', match[1]);
    });
    return tex;
}
exports.stripTeX = stripTeX;
function addDummyCodeBlock(md) {
    // We need a dummy code block in hover to make the width of hover larger.
    const dummyCodeBlock = '```\n```';
    return dummyCodeBlock + '\n' + md + '\n' + dummyCodeBlock;
}
exports.addDummyCodeBlock = addDummyCodeBlock;
function svg2DataUrl(xml) {
    // We have to call encodeURIComponent and unescape because SVG can includes non-ASCII characters.
    // We have to encode them before converting them to base64.
    const svg64 = Buffer.from(unescape(encodeURIComponent(xml)), 'binary').toString('base64');
    const b64Start = 'data:image/svg+xml;base64,';
    return b64Start + svg64;
}
exports.svg2DataUrl = svg2DataUrl;
//# sourceMappingURL=utils.js.map