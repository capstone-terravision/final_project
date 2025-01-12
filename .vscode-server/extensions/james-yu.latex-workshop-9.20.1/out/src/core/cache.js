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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cache = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os_1 = __importDefault(require("os"));
const micromatch_1 = __importDefault(require("micromatch"));
const perf_hooks_1 = require("perf_hooks");
const lw_1 = require("../lw");
const utils = __importStar(require("../utils/utils"));
const inputfilepath_1 = require("../utils/inputfilepath");
const logger = lw_1.lw.log('Cacher');
const caches = new Map();
const promises = new Map();
exports.cache = {
    add,
    get,
    paths,
    promises,
    getIncludedTeX,
    getIncludedBib,
    getFlsChildren,
    wait,
    reset,
    refreshCache,
    refreshCacheAggressive,
    loadFlsFile
};
lw_1.lw.watcher.src.onChange((filePath) => {
    if (canCache(filePath)) {
        void refreshCache(filePath);
    }
});
lw_1.lw.watcher.src.onDelete((filePath) => {
    if (get(filePath) === undefined) {
        caches.delete(filePath);
        logger.log(`Removed ${filePath} .`);
    }
});
lw_1.lw.onDispose({ dispose: () => reset() });
/**
 * Checks if a file path can be cached based on its extension and exclusion
 * criteria.
 *
 * @param {string} filePath - The file path to be checked.
 * @returns {boolean} - True if the file can be cached, false otherwise.
 */
function canCache(filePath) {
    return lw_1.lw.file.hasTeXExt(path.extname(filePath)) && !filePath.includes('expl3-code.tex');
}
/**
 * Checks if a file path is excluded based on user-defined globs in
 * 'latex.watch.files.ignore'.
 *
 * @param {string} filePath - The file path to be checked.
 * @returns {boolean} - True if the file is excluded, false otherwise.
 */
function isExcluded(filePath) {
    const globsToIgnore = vscode.workspace.getConfiguration('latex-workshop').get('latex.watch.files.ignore');
    const format = (str) => (os_1.default.platform() === 'win32' ? str.replace(/\\/g, '/') : str);
    return micromatch_1.default.some(filePath, globsToIgnore, { format });
}
/**
 * Adds a file path to the watcher if it is not excluded.
 *
 * @param {string} filePath - The file path to be added.
 */
function add(filePath) {
    if (isExcluded(filePath)) {
        logger.log(`Ignored ${filePath} .`);
        return;
    }
    if (!lw_1.lw.watcher.src.has(filePath)) {
        logger.log(`Adding ${filePath} .`);
        lw_1.lw.watcher.src.add(filePath);
    }
}
/**
 * Retrieves the cache for a specific file path.
 *
 * @param {string} filePath - The file path to retrieve the cache for.
 * @returns {FileCache | undefined} - The cache for the specified file path, or
 * undefined if not found.
 */
function get(filePath) {
    return caches.get(filePath);
}
/**
 * Retrieves an array of all cached file paths.
 *
 * @returns {string[]} - An array of cached file paths.
 */
function paths() {
    return Array.from(caches.keys());
}
/**
 * Waits for a file to be cached, refreshing if necessary.
 *
 * The function waits for the specified file to be either cached or a promise to
 * be created, with a maximum wait time determined by the 'seconds' parameter.
 * If the file is not cached or no promise is created within the specified time,
 * it forcefully refreshes the cache for the file and returns the corresponding
 * promise.
 *
 * @param {string} filePath - The file path to wait for.
 * @param {number} seconds - The maximum wait time in seconds.
 * @returns {Promise<Promise<void> | undefined>} - A promise resolving when the file is
 * cached, or undefined if an error occurs.
 */
async function wait(filePath, seconds = 2) {
    let waited = 0;
    while (promises.get(filePath) === undefined && get(filePath) === undefined) {
        // Just open vscode, has not cached, wait for a bit?
        await new Promise(resolve => setTimeout(resolve, 100));
        waited++;
        if (waited >= seconds * 10) {
            // Waited for two seconds before starting cache. Really?
            logger.log(`Error loading cache: ${filePath} . Forcing.`);
            await refreshCache(filePath);
            break;
        }
    }
    return promises.get(filePath);
}
/**
 * Resets the watchers and clears all caches.
 */
function reset() {
    lw_1.lw.watcher.src.reset();
    lw_1.lw.watcher.bib.reset();
    // lw.watcher.pdf.reset()
    Object.keys(caches).forEach(filePath => caches.delete(filePath));
}
let cachingFilesCount = 0;
/**
 * Refreshes the cache for a specific file path.
 *
 * The function refreshes the cache for the specified file path. If the file is
 * excluded or cannot be cached, it skips the refresh. After the cache is
 * refreshed, it updates the Abstract Syntax Tree (AST) and various elements in
 * the file cache.
 *
 * The function also utilizes the 'cachingFilesCount' variable, which is a count
 * of the number of files currently being cached. This count is used to
 * determine when all files have been successfully cached. Once the caching
 * process for a file is completed, it decrements the count and checks if it was
 * the last file being cached. If so, it triggers a reconstruction of the
 * structure viewer. This ensures that the structure viewer is updated only
 * after all file caches have been refreshed.
 *
 * @param {string} filePath - The file path to refresh the cache for.
 * @param {string} rootPath - The root path for resolving relative paths.
 * @returns {Promise<Promise<void> | undefined>} - A promise resolving when the cache is
 * refreshed, or undefined if the file is excluded or cannot be cached.
 */
async function refreshCache(filePath, rootPath) {
    if (isExcluded(filePath)) {
        logger.log(`Ignored ${filePath} .`);
        return;
    }
    if (!canCache(filePath)) {
        return;
    }
    logger.log(`Caching ${filePath} .`);
    cachingFilesCount++;
    const openEditor = vscode.workspace.textDocuments.find(document => document.fileName === path.normalize(filePath));
    const content = openEditor?.isDirty ? openEditor.getText() : (lw_1.lw.file.read(filePath) ?? '');
    const fileCache = {
        filePath,
        content,
        contentTrimmed: utils.stripCommentsAndVerbatim(content),
        elements: {},
        children: [],
        bibfiles: new Set(),
        external: {}
    };
    caches.set(filePath, fileCache);
    rootPath = rootPath || lw_1.lw.root.file.path;
    updateChildren(fileCache, rootPath);
    promises.set(filePath, updateAST(fileCache).then(() => {
        updateElements(fileCache);
    }).finally(() => {
        lw_1.lw.lint.label.check();
        cachingFilesCount--;
        promises.delete(filePath);
        lw_1.lw.event.fire(lw_1.lw.event.FileParsed, filePath);
        if (cachingFilesCount === 0) {
            void lw_1.lw.outline.reconstruct();
        }
    }));
    return promises.get(filePath);
}
let updateCompleter;
/**
 * Refreshes the cache aggressively based on user-defined settings.
 *
 * The function checks if aggressive cache updating is enabled in the user's
 * configuration. If enabled, it schedules a delayed refresh of the cache for
 * the specified file path. If the refresh is already scheduled, it cancels the
 * existing timeout and schedules a new one. This helps prevent excessive cache
 * refreshing during rapid file changes.
 *
 * @param {string} filePath - The file path to refresh the cache for.
 */
function refreshCacheAggressive(filePath) {
    if (get(filePath) === undefined) {
        return;
    }
    const configuration = vscode.workspace.getConfiguration('latex-workshop');
    if (configuration.get('intellisense.update.aggressive.enabled')) {
        if (updateCompleter) {
            clearTimeout(updateCompleter);
        }
        updateCompleter = setTimeout(async () => {
            await refreshCache(filePath, lw_1.lw.root.file.path);
            await loadFlsFile(lw_1.lw.root.file.path || filePath);
        }, configuration.get('intellisense.update.delay', 1000));
    }
}
/**
 * Updates the Abstract Syntax Tree (AST) for a given file cache using parser.
 *
 * @param {FileCache} fileCache - The file cache to update the AST for.
 */
async function updateAST(fileCache) {
    logger.log(`Parse LaTeX AST: ${fileCache.filePath} .`);
    fileCache.ast = await lw_1.lw.parser.parse.tex(fileCache.content);
    logger.log(`Parsed LaTeX AST: ${fileCache.filePath} .`);
}
/**
 * Updates the children of a file cache based on input files and external
 * documents.
 *
 * @param {FileCache} fileCache - The file cache to update the children for.
 * @param {string} rootPath - The root path for resolving relative paths.
 */
function updateChildren(fileCache, rootPath) {
    rootPath = rootPath || fileCache.filePath;
    updateChildrenInput(fileCache, rootPath);
    updateChildrenXr(fileCache, rootPath);
    logger.log(`Updated inputs of ${fileCache.filePath} .`);
}
/**
 * Parses input files from the content of a file cache and updates the children
 * array.
 *
 * The function uses a regular expression to find input files in the trimmed
 * content of the specified file cache. It adds each identified input file to
 * the children array, and if the file is not already being watched, it adds it
 * to the watcher and triggers a refresh of its cache.
 *
 * @param {FileCache} fileCache - The file cache to update the input children for.
 * @param {string} rootPath - The root path for resolving relative paths.
 */
function updateChildrenInput(fileCache, rootPath) {
    const inputFileRegExp = new inputfilepath_1.InputFileRegExp();
    while (true) {
        const result = inputFileRegExp.exec(fileCache.contentTrimmed, fileCache.filePath, rootPath);
        if (!result) {
            break;
        }
        if (!fs.existsSync(result.path) || path.relative(result.path, rootPath) === '') {
            continue;
        }
        fileCache.children.push({
            index: result.match.index,
            filePath: result.path
        });
        logger.log(`Input ${result.path} from ${fileCache.filePath} .`);
        if (lw_1.lw.watcher.src.has(result.path)) {
            continue;
        }
        add(result.path);
        void refreshCache(result.path, rootPath);
    }
}
/**
 * Parses external document references from the content of a file cache and
 * updates the children array.
 *
 * The function uses a regular expression to find external document references
 * in the trimmed content of the specified file cache. It resolves the paths of
 * external documents and adds them to the children array. If an external
 * document is not already being watched, it adds it to the watcher and triggers
 * a refresh of its cache.
 *
 * @param {FileCache} fileCache - The file cache to update the external document
 * children for.
 * @param {string} rootPath - The root path for resolving relative paths.
 */
function updateChildrenXr(fileCache, rootPath) {
    const externalDocRegExp = /\\externaldocument(?:\[(.*?)\])?\{(.*?)\}/g;
    while (true) {
        const result = externalDocRegExp.exec(fileCache.contentTrimmed);
        if (!result) {
            break;
        }
        const texDirs = vscode.workspace.getConfiguration('latex-workshop').get('latex.texDirs');
        const externalPath = utils.resolveFile([path.dirname(fileCache.filePath), path.dirname(rootPath), ...texDirs], result[2]);
        if (!externalPath || !fs.existsSync(externalPath) || path.relative(externalPath, rootPath) === '') {
            logger.log(`Failed resolving external ${result[2]} . Tried ${externalPath} ` +
                (externalPath && path.relative(externalPath, rootPath) === '' ? ', which is root.' : '.'));
            continue;
        }
        const rootCache = get(rootPath);
        if (rootCache !== undefined) {
            rootCache.external[externalPath] = result[1] || '';
            logger.log(`External document ${externalPath} from ${fileCache.filePath} .` + (result[1] ? ` Prefix is ${result[1]}` : ''));
        }
        if (lw_1.lw.watcher.src.has(externalPath)) {
            continue;
        }
        add(externalPath);
        void refreshCache(externalPath, externalPath);
    }
}
/**
 * Updates various elements in the file cache after parsing the LaTeX Abstract
 * Syntax Tree (AST).
 *
 * The function updates elements in the specified file cache based on the parsed
 * LaTeX AST. It includes updating citations, packages, references, glossaries,
 * environments, commands, and input graphics paths. Additionally, it updates
 * the bibliography files referenced in the file content and logs the time taken
 * to complete the update.
 *
 * @param {FileCache} fileCache - The file cache to update the elements for.
 */
function updateElements(fileCache) {
    const start = perf_hooks_1.performance.now();
    lw_1.lw.completion.citation.parse(fileCache);
    // Package parsing must be before command and environment.
    lw_1.lw.completion.usepackage.parse(fileCache);
    lw_1.lw.completion.reference.parse(fileCache);
    lw_1.lw.completion.glossary.parse(fileCache);
    lw_1.lw.completion.environment.parse(fileCache);
    lw_1.lw.completion.macro.parse(fileCache);
    lw_1.lw.completion.subsuperscript.parse(fileCache);
    lw_1.lw.completion.input.parseGraphicsPath(fileCache);
    updateBibfiles(fileCache);
    const elapsed = perf_hooks_1.performance.now() - start;
    logger.log(`Updated elements in ${elapsed.toFixed(2)} ms: ${fileCache.filePath} .`);
}
/**
 * Updates bibliography files in the file cache based on the content of the
 * LaTeX file.
 *
 * The function uses regular expressions to find bibliography file references in
 * the content of the specified file cache. It extracts the paths of the
 * bibliography files and adds them to the bibliography files set in the cache.
 * If a bibliography file is not already being watched, it adds it to the
 * bibliography watcher.
 *
 * @param {FileCache} fileCache - The file cache to update the bibliography files
 * for.
 */
function updateBibfiles(fileCache) {
    const bibReg = /(?:\\(?:bibliography|addbibresource)(?:\[[^[\]{}]*\])?){(?:\\subfix{)?([\s\S]+?)(?:\})?}|(?:\\putbib)\[(.+?)\]/gm;
    while (true) {
        const result = bibReg.exec(fileCache.contentTrimmed);
        if (!result) {
            break;
        }
        const bibs = (result[1] ? result[1] : result[2]).split(',').map(bib => bib.trim());
        for (const bib of bibs) {
            const bibPaths = lw_1.lw.file.getBibPath(bib, path.dirname(fileCache.filePath));
            for (const bibPath of bibPaths) {
                if (isExcluded(bibPath)) {
                    continue;
                }
                fileCache.bibfiles.add(bibPath);
                logger.log(`Bib ${bibPath} from ${fileCache.filePath} .`);
                if (!lw_1.lw.watcher.bib.has(bibPath)) {
                    lw_1.lw.watcher.bib.add(bibPath);
                }
            }
        }
    }
}
/**
 * Parses the content of a `.fls` file attached to the given `filePath` and
 * updates caches accordingly.
 *
 * The function parses the content of a `.fls` file associated with the
 * specified `filePath`. It identifies input files and output files, updates the
 * cache's children, and checks for `.aux` files to parse for possible `.bib`
 * files. This function is typically called after a successful build to look for
 * the root file and compute the cachedContent tree.
 *
 * @param {string} filePath - The path of a LaTeX file.
 */
async function loadFlsFile(filePath) {
    const flsPath = lw_1.lw.file.getFlsPath(filePath);
    if (flsPath === undefined) {
        return;
    }
    logger.log(`Parsing .fls ${flsPath} .`);
    const rootDir = path.dirname(filePath);
    const outDir = lw_1.lw.file.getOutDir(filePath);
    const ioFiles = parseFlsContent(fs.readFileSync(flsPath).toString(), rootDir);
    for (const inputFile of ioFiles.input) {
        // Drop files that are also listed as OUTPUT or should be ignored
        if (ioFiles.output.includes(inputFile) ||
            isExcluded(inputFile) ||
            !fs.existsSync(inputFile)) {
            continue;
        }
        if (inputFile === filePath || lw_1.lw.watcher.src.has(inputFile)) {
            // Drop the current rootFile often listed as INPUT
            // Drop any file that is already watched as it is handled by
            // onWatchedFileChange.
            continue;
        }
        const inputExt = path.extname(inputFile);
        if (inputExt === '.tex') {
            if (get(filePath) === undefined) {
                logger.log(`Cache not finished on ${filePath} when parsing fls, try re-cache.`);
                await refreshCache(filePath);
            }
            // It might be possible that `filePath` is excluded from caching.
            const fileCache = get(filePath);
            if (fileCache !== undefined) {
                // Parse tex files as imported subfiles.
                fileCache.children.push({
                    index: Number.MAX_VALUE,
                    filePath: inputFile
                });
                add(inputFile);
                logger.log(`Found ${inputFile} from .fls ${flsPath} , caching.`);
                void refreshCache(inputFile, filePath);
            }
            else {
                logger.log(`Cache not finished on ${filePath} when parsing fls.`);
            }
        }
        else if (!lw_1.lw.watcher.src.has(inputFile) && !['.aux', '.out'].includes(inputExt)) {
            // Watch non-tex files. aux and out are excluded because they are auto-generated during the building process
            add(inputFile);
        }
    }
    for (const outputFile of ioFiles.output) {
        if (path.extname(outputFile) === '.aux' && fs.existsSync(outputFile)) {
            logger.log(`Found .aux ${filePath} from .fls ${flsPath} , parsing.`);
            parseAuxFile(outputFile, path.dirname(outputFile).replace(outDir, rootDir));
            logger.log(`Parsed .aux ${filePath} .`);
        }
    }
    logger.log(`Parsed .fls ${flsPath} .`);
}
/**
 * Parses the content of a `.fls` file and extracts input and output files.
 *
 * The function uses a regular expression to match lines in the `.fls` file
 * indicating input and output files. It then resolves the paths of these files
 * relative to the root directory and returns an object with arrays of input and
 * output files.
 *
 * @param {string} content - The content of the `.fls` file.
 * @param {string} rootDir - The root directory for resolving relative paths.
 * @returns {{input: string[], output: string[]}} - An object containing arrays
 * of input and output files.
 */
function parseFlsContent(content, rootDir) {
    const inputFiles = new Set();
    const outputFiles = new Set();
    const regex = /^(?:(INPUT)\s*(.*))|(?:(OUTPUT)\s*(.*))$/gm;
    // regex groups
    // #1: an INPUT entry --> #2 input file path
    // #3: an OUTPUT entry --> #4: output file path
    while (true) {
        const result = regex.exec(content);
        if (!result) {
            break;
        }
        if (result[1]) {
            const inputFilePath = path.resolve(rootDir, result[2]);
            if (inputFilePath) {
                inputFiles.add(inputFilePath);
            }
        }
        else if (result[3]) {
            const outputFilePath = path.resolve(rootDir, result[4]);
            if (outputFilePath) {
                outputFiles.add(outputFilePath);
            }
        }
    }
    return { input: Array.from(inputFiles), output: Array.from(outputFiles) };
}
/**
 * Parses a `.aux` file to extract bibliography file references and updates the
 * caches.
 *
 * The function reads the content of the specified `.aux` file and uses a
 * regular expression to find bibliography file references. It then updates the
 * cache with the discovered bibliography files.
 *
 * @param {string} filePath - The path of the `.aux` file.
 * @param {string} srcDir - The source directory for resolving relative paths.
 */
function parseAuxFile(filePath, srcDir) {
    const content = fs.readFileSync(filePath).toString();
    const regex = /^\\bibdata{(.*)}$/gm;
    while (true) {
        const result = regex.exec(content);
        if (!result) {
            return;
        }
        const bibs = (result[1] ? result[1] : result[2]).split(',').map((bib) => { return bib.trim(); });
        for (const bib of bibs) {
            const bibPaths = lw_1.lw.file.getBibPath(bib, srcDir);
            for (const bibPath of bibPaths) {
                if (isExcluded(bibPath)) {
                    continue;
                }
                if (lw_1.lw.root.file.path && !get(lw_1.lw.root.file.path)?.bibfiles.has(bibPath)) {
                    get(lw_1.lw.root.file.path)?.bibfiles.add(bibPath);
                    logger.log(`Found .bib ${bibPath} from .aux ${filePath} .`);
                }
                if (!lw_1.lw.watcher.bib.has(bibPath)) {
                    lw_1.lw.watcher.bib.add(bibPath);
                }
            }
        }
    }
}
/**
 * Returns an array of included bibliography files in the specified LaTeX file.
 *
 * The function recursively traverses the included LaTeX files starting from the
 * specified file path (or the root file if undefined) and collects the
 * bibliography files. It avoids duplicates and returns an array of unique
 * included bibliography files.
 *
 * @param {string | undefined} filePath - The path of the LaTeX file. If
 * undefined, traces from the root file.
 * @param {string[]} includedBib - An array to store the included bibliography
 * files (default: []).
 * @returns {string[]} - An array of included bibliography files.
 */
function getIncludedBib(filePath, includedBib = []) {
    filePath = filePath ?? lw_1.lw.root.file.path;
    if (filePath === undefined) {
        return [];
    }
    const fileCache = get(filePath);
    if (fileCache === undefined) {
        return [];
    }
    const checkedTeX = [filePath];
    includedBib.push(...fileCache.bibfiles);
    for (const child of fileCache.children) {
        if (checkedTeX.includes(child.filePath)) {
            // Already parsed
            continue;
        }
        getIncludedBib(child.filePath, includedBib);
    }
    // Make sure to return an array with unique entries
    return Array.from(new Set(includedBib));
}
/**
 * Returns an array of included LaTeX files in the specified LaTeX file.
 *
 * The function recursively traverses the included LaTeX files starting from the
 * specified file path (or the root file if undefined) and collects the LaTeX
 * files. It avoids duplicates and returns an array of unique included LaTeX
 * files. The 'cachedOnly' parameter controls whether to include only cached
 * files or all included files.
 *
 * @param {string | undefined} filePath - The path of the LaTeX file. If
 * undefined, traces from the root file.
 * @param {string[]} includedTeX - An array to store the included LaTeX files
 * (default: []).
 * @param {boolean} cachedOnly - Indicates whether to include only cached files
 * (default: true).
 * @returns {string[]} - An array of included LaTeX files.
 */
function getIncludedTeX(filePath, includedTeX = [], cachedOnly = true) {
    filePath = filePath ?? lw_1.lw.root.file.path;
    if (filePath === undefined) {
        return [];
    }
    const fileCache = get(filePath);
    if (cachedOnly && fileCache === undefined) {
        return [];
    }
    includedTeX.push(filePath);
    if (fileCache === undefined) {
        return [];
    }
    for (const child of fileCache.children) {
        if (includedTeX.includes(child.filePath)) {
            // Already included
            continue;
        }
        getIncludedTeX(child.filePath, includedTeX, cachedOnly);
    }
    return includedTeX;
}
/**
 * Returns an array of input files from the `.fls` file associated with the
 * specified LaTeX file.
 *
 * @param {string} texFile - The path of the LaTeX file.
 * @returns {string[]} - An array of input files from the `.fls` file.
 *
 * The function reads the content of the `.fls` file associated with the
 * specified LaTeX file, parses the input files, and returns an array of
 * included input files. It is used to identify the dependencies of a LaTeX file
 * after a successful build.
 */
function getFlsChildren(texFile) {
    const flsPath = lw_1.lw.file.getFlsPath(texFile);
    if (flsPath === undefined) {
        return [];
    }
    const rootDir = path.dirname(texFile);
    const ioFiles = parseFlsContent(fs.readFileSync(flsPath).toString(), rootDir);
    return ioFiles.input;
}
//# sourceMappingURL=cache.js.map