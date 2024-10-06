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
exports.usepackage = exports.provider = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const lw_1 = require("../../lw");
const parser_1 = require("../../utils/parser");
const logger = lw_1.lw.log('Intelli', 'Package');
exports.provider = { from };
exports.usepackage = {
    parse,
    load,
    getAll,
    getDeps,
    getOpts,
    setDeps,
    setOpts
};
const data = {
    loaded: [],
    suggestions: [],
    packageDeps: Object.create(null),
    packageOptions: Object.create(null)
};
function load(packageName) {
    if (data.loaded.includes(packageName)) {
        return;
    }
    const filePath = resolvePackageFile(packageName);
    if (filePath === undefined) {
        data.loaded.push(packageName);
        return;
    }
    try {
        const packageData = JSON.parse(fs.readFileSync(filePath).toString());
        populatePackageData(packageData);
        setDeps(packageName, packageData.includes);
        setOpts(packageName, packageData.options);
        lw_1.lw.completion.environment.setPackageEnvs(packageName, packageData.envs);
        lw_1.lw.completion.macro.setPackageCmds(packageName, packageData.macros);
        data.loaded.push(packageName);
    }
    catch (e) {
        logger.log(`Cannot parse intellisense file: ${filePath}`);
    }
}
function resolvePackageFile(packageName) {
    const defaultDir = `${lw_1.lw.extensionRoot}/data/packages/`;
    const dirs = vscode.workspace.getConfiguration('latex-workshop').get('intellisense.package.dirs');
    dirs.push(defaultDir);
    for (const dir of dirs) {
        const filePath = path.resolve(dir, `${packageName}.json`);
        if (fs.existsSync(filePath)) {
            return filePath;
        }
    }
    // Many package with names like toppackage-config.sty are just wrappers around
    // the general package toppacke.sty and do not define macros on their own.
    const indexDash = packageName.lastIndexOf('-');
    if (indexDash > -1) {
        const generalPkg = packageName.substring(0, indexDash);
        const filePath = path.resolve(defaultDir, `${generalPkg}.json`);
        if (fs.existsSync(filePath)) {
            return filePath;
        }
    }
    return;
}
function populatePackageData(packageData) {
    Object.entries(packageData.macros).forEach(([key, cmd]) => {
        cmd.macro = key;
        cmd.snippet = cmd.snippet || key;
        cmd.keyvals = packageData.keyvals[cmd.keyvalindex ?? -1];
    });
    Object.entries(packageData.envs).forEach(([key, env]) => {
        env.detail = key;
        env.name = env.name || key;
        env.snippet = env.snippet || '';
        env.keyvals = packageData.keyvals[env.keyvalindex ?? -1];
    });
}
function initialize(defaultPackages) {
    Object.values(defaultPackages).forEach(item => {
        const pack = new vscode.CompletionItem(item.command, vscode.CompletionItemKind.Module);
        pack.detail = item.detail;
        pack.documentation = new vscode.MarkdownString(`[${item.documentation}](${item.documentation})`);
        data.suggestions.push(pack);
    });
}
function from() {
    if (data.suggestions.length === 0) {
        const pkgs = JSON.parse(fs.readFileSync(`${lw_1.lw.extensionRoot}/data/packagenames.json`).toString());
        initialize(pkgs);
    }
    return data.suggestions;
}
function setDeps(packageName, deps) {
    data.packageDeps[packageName] = deps;
}
function setOpts(packageName, options) {
    data.packageOptions[packageName] = options;
}
function getOpts(packageName) {
    return data.packageOptions[packageName] || [];
}
function getDeps(packageName) {
    return data.packageDeps[packageName] || {};
}
function getAll(languageId) {
    const packages = {};
    const config = vscode.workspace.getConfiguration('latex-workshop');
    const excluded = config.get('intellisense.package.exclude');
    if (!excluded.includes('lw-default')) {
        if (['latex', 'latex-expl3'].includes(languageId)) {
            packages['latex-document'] = [];
        }
        if (languageId === 'latex-expl3') {
            packages['expl3'] = [];
        }
    }
    config.get('intellisense.package.extra')
        .filter(packageName => !excluded.includes(packageName))
        .forEach(packageName => packages[packageName] = []);
    lw_1.lw.cache.getIncludedTeX().forEach(tex => {
        const included = lw_1.lw.cache.get(tex)?.elements.package;
        if (included === undefined) {
            return;
        }
        Object.entries(included)
            .filter(([packageName,]) => !excluded.includes(packageName))
            .forEach(([packageName, options]) => packages[packageName] = options);
    });
    while (true) {
        let newPackageInserted = false;
        Object.entries(packages).forEach(([packageName, options]) => Object.keys(getDeps(packageName))
            .filter(includeName => !excluded.includes(includeName))
            .forEach(includeName => {
            const dependOptions = getDeps(packageName)[includeName];
            const hasOption = dependOptions.length === 0
                || options.filter(option => dependOptions.includes(option)).length > 0;
            if (packages[includeName] === undefined && hasOption) {
                packages[includeName] = [];
                newPackageInserted = true;
            }
        }));
        if (!newPackageInserted) {
            break;
        }
    }
    return packages;
}
function parse(cache) {
    if (cache.ast !== undefined) {
        cache.elements.package = parseAst(cache.ast);
    }
    else {
        cache.elements.package = parseContent(cache.content);
    }
}
function parseAst(node) {
    const packages = {};
    if (node.type === 'macro' && ['usepackage', 'documentclass'].includes(node.content)) {
        const options = (0, parser_1.argContentToStr)(node.args?.[0]?.content || [])
            .split(',')
            .map(arg => arg.trim());
        const optionsNoTrue = options
            .filter(option => option.includes('=true'))
            .map(option => option.replace('=true', ''));
        (0, parser_1.argContentToStr)(node.args?.[1]?.content || [])
            .split(',')
            .map(packageName => toPackageObj(packageName.trim(), [...options, ...optionsNoTrue], node))
            .forEach(packageObj => Object.assign(packages, packageObj));
    }
    else if ('content' in node && typeof node.content !== 'string') {
        for (const subNode of node.content) {
            Object.assign(packages, parseAst(subNode));
        }
    }
    return packages;
}
function parseContent(content) {
    const packages = {};
    const pkgReg = /\\(?:usepackage|RequirePackage)(\[[^[\]{}]*\])?{(.*?)}/gs;
    while (true) {
        const result = pkgReg.exec(content);
        if (result === null) {
            break;
        }
        const packageNames = result[2].split(',').map(packageName => packageName.trim());
        const options = (result[1] || '[]').slice(1, -1).replace(/\s*=\s*/g, '=').split(',').map(option => option.trim());
        const optionsNoTrue = options.filter(option => option.includes('=true')).map(option => option.replace('=true', ''));
        packageNames
            .map(packageName => toPackageObj(packageName, [...options, ...optionsNoTrue]))
            .forEach(packageObj => Object.assign(packages, packageObj));
    }
    return packages;
}
function toPackageObj(packageName, options, node) {
    packageName = packageName.trim();
    if (packageName === '') {
        return {};
    }
    let pkgObj = {};
    if (node?.type === 'macro' && node.content === 'documentclass') {
        if (vscode.workspace.getConfiguration('latex-workshop').get('kpsewhich.class.enabled')) {
            const clsPath = lw_1.lw.file.kpsewhich([`${packageName}.cls`]);
            if (clsPath && fs.existsSync(clsPath)) {
                pkgObj = parseContent(fs.readFileSync(clsPath).toString());
            }
        }
        packageName = 'class-' + packageName;
    }
    pkgObj[packageName] = options;
    return pkgObj;
}
//# sourceMappingURL=package.js.map